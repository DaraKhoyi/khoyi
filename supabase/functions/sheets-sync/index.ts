// sheets-sync — pull the brokerage commission Google Sheet into brokerage_transactions.
//
// Runs daily (cron) OR on-demand from Broker Settings. Reads the sheet configured in
// public.commission_sheet_config using the Google account that carries drive.readonly,
// parses each mapped tab (Paid 2026 / Paid 2025 / …) and UPSERTS keyed on (year, trans_id)
// so edits to a PAST row reconcile — nothing is appended blindly, nothing is duplicated.
//
// Rules (locked in with Dara):
//   • Column A = Trans ID (numeric, stable key, starts at 1 each year).
//   • Any row whose Trans ID OR Agent Name begins with "exclude" is skipped.
//   • Columns are mapped by HEADER NAME, not position (the ROG/TC/Referral columns
//     sit in a different order between years).
//   • The FULL row is stored as raw_row jsonb so no column is ever lost.
//   • Agent names resolve to agent_id via public.resolve_agent_id() (self-healing).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { requireServiceOr } from "../_shared/guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function freshGoogleToken(supabase: any, account: any): Promise<string> {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) return account.access_token;
  if (!account.refresh_token) throw new Error("No refresh_token — reconnect the Google account.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const t = await r.json();
  const newExp = new Date(now + ((t.expires_in || 3600) - 60) * 1000).toISOString();
  await supabase.from("email_accounts").update({ access_token: t.access_token, token_expires_at: newExp }).eq("id", account.id);
  return t.access_token;
}

// --- value coercion --------------------------------------------------------
function toNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}
// Google Sheets returns dates as strings (formatted) — normalize common shapes to YYYY-MM-DD.
// "2.10" typed in a DATE-formatted cell arrives as the number 2.1: the trailing
// zero — the difference between 10 Feb and 1 Feb — is gone. When the decimal has
// one digit, both readings are possible; a commission is paid ON OR AFTER it is
// received, so take the earliest reading on/after the received date (3 days'
// grace for a received date typed a little late). 20 paid dates depended on this.
function paidFromSerialCell(v: any, year: number, receivedIso: string | null): string | null {
  if (!(v instanceof Date) || isNaN(v.getTime()) || v.getUTCFullYear() >= 1901) return null;
  const n = Math.round(((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000) * 100) / 100;
  const m = String(n).match(/^(\d{1,2})\.(\d{1,2})$/);
  if (!m) return null;
  const mo = parseInt(m[1], 10);
  const days = m[2].length === 1 ? [parseInt(m[2], 10), parseInt(m[2], 10) * 10] : [parseInt(m[2], 10)];
  const iso = (d: number) => `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const valid = days.filter((d) => d >= 1 && d <= 31 && mo >= 1 && mo <= 12 && isRealDay(iso(d))).map(iso);
  if (!valid.length) return null;
  if (valid.length === 1 || !receivedIso) return valid[0];
  const floor = new Date(receivedIso + "T00:00:00Z").getTime() - 3 * 86400000;
  const after = valid.filter((d) => new Date(d + "T00:00:00Z").getTime() >= floor).sort();
  return after[0] || valid[valid.length - 1];
}

// A real calendar day, or nothing. "9.31" / "9/31" passed the 1..31 range checks and
// reached Postgres as 2026-09-31, which rejects the whole upsert ("date/time field
// value out of range", Oct 9 sheets-sync run). JS Date silently rolls 31 Sep over to
// 1 Oct, so it cannot be the check either: rebuild the day and compare its parts.
function isRealDay(iso: string | null): boolean {
  const m = iso && iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

function toDate(v: any, fallbackYear?: number): string | null {
  const out = toDateRaw(v, fallbackYear);
  return out && isRealDay(out) ? out : null;
}

function toDateRaw(v: any, fallbackYear?: number): string | null {
  if (!v) return null;
  // A real date cell arrives as a Date once cellDates is on. Use its parts
  // directly — going through toISOString() would shift the day across the
  // timezone boundary for anything before 00:00 UTC.
  if (v instanceof Date && !isNaN(v.getTime()) && v.getUTCFullYear() < 1901) {
    // A MONTH.DAY NUMBER IN A DATE-FORMATTED CELL. The paid-date column is typed
    // "2.25" (25 Feb), "9.1" (1 Sep). Around 22 Sep the column was formatted as a
    // DATE, so the workbook now hands back serial 2.25 as 1 Jan 1900 06:00, which
    // the year check below rejected: 106 paid dates were blanked by the 27 Sep
    // re-import (restored from archive.brokerage_transactions_pre_resync_20260927).
    // Recover the number exactly as typed and parse it as the text form below.
    const serial = (v.getTime() - Date.UTC(1899, 11, 30)) / 86400000;
    v = String(Math.round(serial * 100) / 100);
  } else if (v instanceof Date && !isNaN(v.getTime())) {
    // A real date cell can still be a typo: the sheet holds received dates in
    // the year 20226 and the year 205. Keep nothing rather than a year that
    // throws every date comparison built on it.
    if (fallbackYear && Math.abs(v.getFullYear() - fallbackYear) > 1) return null;
    const y = v.getFullYear(), mo = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  let s = String(v).trim();
  // Deliberate blanks, not unreadable dates.
  if (/^(-+|n\/?a|none|0|tbd|\?)$/i.test(s)) return null;
  // "3/15 Dara" — a date with a note after it. Keep the date.
  const lead = s.match(/^(\d{1,2}[\/.\-]\d{1,2}(?:[\/.\-]\d{2,4})?)\s+\D/);
  if (lead) s = lead[1];
  // "12/30" — the sheet holds some dates as text with no year at all. It belongs
  // to the tab it was read from.
  // "9.9", "8.31", "12-30" — the paid-date column is typed as MONTH.DAY with a
  // dot. Only the slash form was recognised, so "9.9" fell through to
  // new Date("9.9"), which V8 reads as 9 Sep 2001: 149 sales stored as paid in
  // 2001, silently dropping out of every trailing-12-month GCI and every
  // last-close date. Any of / . - now takes the tab's year.
  const md = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-]?$/);   // also "9/9/" — a trailing slash with no year
  if (md && fallbackYear) {
    const mo = parseInt(md[1], 10), d = parseInt(md[2], 10);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${fallbackYear}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    return null;
  }
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    let [_, a, b, y] = m;
    if (y.length === 2) y = "20" + y;
    // The sheet mixes M/D/Y and D/M/Y — "13/08/2025" produced 2025-13-08 and
    // Postgres rejected it as month 13. If the first number cannot be a month,
    // the pair is the other way round. Ambiguous dates (both <= 12) stay M/D/Y,
    // which is what the rest of the sheet uses.
    let mo = a, d = b;
    if (parseInt(a, 10) > 12 && parseInt(b, 10) <= 12) { mo = b; d = a; }
    if (parseInt(mo, 10) > 12 || parseInt(d, 10) > 31) return null;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  // LAST RESORT, AND IT MAY NOT INVENT A YEAR. new Date() fills a missing year
  // with 2001 and turned "7.10"-style junk into the year 710. A date more than a
  // year away from the tab it came from is not a date we understood: store
  // nothing rather than a wrong number that looks right.
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  const y = dt.getUTCFullYear();
  if (y < 2000 || (fallbackYear && Math.abs(y - fallbackYear) > 1)) return null;
  return dt.toISOString().slice(0, 10);
}
function txt(v: any): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
function isExclude(v: any): boolean {
  return typeof v === "string" && v.trim().toLowerCase().startsWith("exclude");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // pg_cron (service), or the owner / a broker admin pressing "Refresh" in Accounting (_shared/guard.ts).
  { const g = await requireServiceOr(req, cors, { staff: true }); if (g.res) return g.res; }
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));

    // 1) resolve the config (explicit id, or the active one)
    let cfgQ = supabase.from("commission_sheet_config").select("*").eq("is_active", true).order("updated_at", { ascending: false }).limit(1);
    if (body.config_id) cfgQ = supabase.from("commission_sheet_config").select("*").eq("id", body.config_id).limit(1);
    const { data: cfgs } = await cfgQ;
    const cfg = cfgs?.[0];
    if (!cfg) return new Response(JSON.stringify({ ok: false, error: "No active commission sheet configured." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

    // 2) the Google account that can read Drive/Sheets
    const { data: accts } = await supabase.from("email_accounts").select("*").eq("user_id", cfg.user_id).eq("is_active", true);
    const acct = (accts || []).find((a: any) => (a.scopes || []).some((s: string) => s.includes("drive")));
    if (!acct) return new Response(JSON.stringify({ ok: false, error: "No Google account with Drive access — reconnect Google." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    const token = await freshGoogleToken(supabase, acct);

    const tabMap: Array<{ tab: string; year: number }> = Array.isArray(cfg.tab_map) ? cfg.tab_map : [];
    const summary: any[] = [];

    // Read the workbook through DRIVE, once, instead of the Sheets API per tab.
    //
    // Two reasons the Sheets API cannot do this job. It is not enabled on this
    // Cloud project (403), and the GOLD report is an UPLOADED .xlsx rather than
    // a native Google Sheet — the Sheets API does not read those at all, and
    // Drive's /export refuses them too (403). Uploaded files come down with
    // alt=media; native sheets need /export. Try the upload path first and fall
    // back, so the same config works for either kind of file.
    let wb: any;
    {
      const asUpload = `https://www.googleapis.com/drive/v3/files/${cfg.spreadsheet_id}?alt=media`;
      const asNative = `https://www.googleapis.com/drive/v3/files/${cfg.spreadsheet_id}/export` +
        `?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`;
      let r = await fetch(asUpload, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
      if (!r.ok) r = await fetch(asNative, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
      if (!r.ok) {
        return new Response(JSON.stringify({ ok: false, error: `Could not read the sheet from Drive (${r.status}).` }),
          { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      }
      // Parse ONLY the tabs we import, densely. The 06:00 run of 28 Sep died with
      // 546 (the function's CPU/memory limit) parsing every tab of the workbook;
      // the same run by hand minutes later fit. Leave headroom, not luck.
      wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: "array", cellDates: true, dense: true,
        sheets: tabMap.map((t) => t.tab), cellStyles: false, cellHTML: false, cellFormula: false });
    }

    for (const { tab, year } of tabMap) {
      // 3) pull the whole tab out of the workbook we already have
      const ws = wb.Sheets[tab];
      if (!ws) { summary.push({ tab, year, error: `tab not found (present: ${Object.keys(wb.Sheets).join(", ")})` }); continue; }
      // raw:false gives FORMATTED values — the same thing the Sheets API returned
      // with dateTimeRenderOption=FORMATTED_STRING, which is what the parser
      // below expects. With raw:true a date arrives as the Excel serial 46267
      // and Postgres reads that as the year 46267: "time zone displacement out
      // of range". Numbers still coerce fine downstream.
      // raw:true + cellDates:true gives real Date objects for date cells and leaves
      // text cells as text. raw:false was worse than the serial problem it fixed:
      // it applies the CELL FORMAT, and cells formatted "mm/dd" came out as
      // "12/30" with the year stripped, which silently moved dates to the wrong
      // year. The year is not recoverable from the formatted string; it is from
      // the Date object.
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }) as any[][];
      if (rows.length < 2) { summary.push({ tab, year, rows: 0 }); continue; }

      // header name -> column index. FIND the header row; do not assume row 1.
      // On ~22 Sep a note row ("Every date in this entire tab is a date in
      // Calendar Year 2026") was added above the headers in both tabs, and every
      // daily import after it read 0 of ~2,700 rows while reporting ok.
      const hRow = Math.max(0, rows.slice(0, 15).findIndex((r) => (r || []).some((c) => String(c ?? "").trim().toLowerCase() === "trans id")));
      const header = (rows[hRow] || []).map((h) => String(h ?? "").trim());
      const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
      const iTid = idx("Trans ID"), iAgent = idx("Agent Name");
      const col = (r: any[], name: string) => { const i = idx(name); return i >= 0 ? r[i] : null; };
      // CLIENT IDENTITY (27 Sep). The Gold Report carried no client at all, so no
      // closing could ever be tied back to the lead, contact or AI spend behind it
      // (business_outcomes() reports this as the blocker). Any of these headers is
      // picked up when present; a field is only written when its column EXISTS,
      // so a sheet without them never blanks names that came from elsewhere.
      const firstCol = (names: string[]) => names.map((n) => idx(n)).find((i) => i >= 0) ?? -1;
      const iClient = firstCol(["Client", "Client Name", "Customer", "Customer Name"]);
      const iBuyer = firstCol(["Buyer", "Buyer Name", "Buyer(s)"]);
      const iSeller = firstCol(["Seller", "Seller Name", "Seller(s)"]);
      const iEmail = firstCol(["Client Email", "Buyer Email", "Seller Email", "Email"]);
      // WHERE THE CLIENT CAME FROM (28 Sep), as the agent knows it: "Open house",
      // "Sphere", "Zillow", "Referral from…". Read when the column exists; it is
      // the strongest evidence closing_attribution() has, because most agents'
      // leads never pass through PrismOS at all.
      const iSource = firstCol(["Lead Source", "Source", "Client Source", "Lead Source (how they found you)", "How Found"]);

      const records: any[] = [];
      // WHY ROWS WERE SKIPPED. From 22 Sep every daily run imported 0 rows and
      // reported ok — five days of commissions silently missing. A sync that
      // imports nothing must say why (27 Sep).
      const skipped = { excluded: 0, no_trans_id: 0, blank: 0 };
      for (let ri = hRow + 1; ri < rows.length; ri++) {
        const r = rows[ri];
        const tid = iTid >= 0 ? r[iTid] : null;
        const agent = iAgent >= 0 ? r[iAgent] : null;
        if (isExclude(tid) || isExclude(agent)) { skipped.excluded++; continue; }
        if (typeof tid !== "number" && !(typeof tid === "string" && /^\d+$/.test(tid.trim()))) { skipped.no_trans_id++; continue; }
        const transId = typeof tid === "number" ? Math.trunc(tid) : parseInt(tid, 10);

        // full raw row keyed by header name (nothing lost)
        const raw: Record<string, any> = {};
        header.forEach((h, ci) => { if (h) raw[h] = r[ci] ?? null; });

        const gs = toNum(col(r, "Gross Sale"));
        const gc = toNum(col(r, "Gross Commission Received"));
        // A BLANK ROW IS NOT A FEE. The sheet pre-numbers Trans IDs on rows nobody
        // has filled in yet; with no agent, no address and no money on them they
        // were imported as closed "fee" transactions — three of them this morning.
        const toAgent = toNum(col(r, "Amount to Pay Agent"));
        if (!txt(agent) && !txt(col(r, "Street Number and Name")) && !gs && !gc && !toAgent) { skipped.blank++; continue; }
        const kind = gs && gs > 0 ? "sale" : (gc && gc > 0 ? "commission" : "fee");
        // SAME KEYS ON EVERY ROW of a tab: PostgREST rejects a bulk upsert whose
        // objects have different key sets, so a key is present (possibly null)
        // exactly when its column exists — never only on the rows that have a value.
        const client: Record<string, any> = {};
        // "Buy"/"List" in this sheet mark the SIDE; an X in Buy means the client bought.
        const isBuy = !!txt(col(r, "Buy")), isList = !!txt(col(r, "List"));
        const clientName = iClient >= 0 ? (txt(r[iClient]) || null) : null;
        if (iBuyer >= 0 || iClient >= 0) client.buyer_name = (iBuyer >= 0 ? txt(r[iBuyer]) : null) || (!isList || isBuy ? clientName : null) || null;
        if (iSeller >= 0 || iClient >= 0) client.seller_name = (iSeller >= 0 ? txt(r[iSeller]) : null) || (isList && !isBuy ? clientName : null) || null;
        if (iEmail >= 0) client.client_email = (txt(r[iEmail]) || "").toLowerCase() || null;
        if (iSource >= 0) client.lead_source = txt(r[iSource]) || null;
        records.push({
          ...client,
          year, trans_id: transId, agent_name_raw: txt(agent) || "(unnamed)", source_tab: tab, source_row: ri + 1,
          address: txt(col(r, "Street Number and Name")), buy_side: !!txt(col(r, "Buy")), list_side: !!txt(col(r, "List")),
          gross_sale: gs, gross_commission: gc, date_received: toDate(col(r, "Date Rcvd"), year),
          amount_to_agent: toNum(col(r, "Amount to Pay Agent")), kind,
          lender: txt(col(r, "Lender")), office_fee: toNum(col(r, "Gross Office Fee") ?? col(r, "Office Fee Share")),
          referral_1: toNum(col(r, "Referral (1)")), rog_corp_cost: toNum(col(r, "ROG Corp. Cost")),
          tc_payment: toNum(col(r, "TC payment")),
          date_paid: (() => {
            const rawPaid = col(r, "Date Paid (ALEX)");
            const rcv = toDate(col(r, "Date Rcvd"), year);
            return paidFromSerialCell(rawPaid, year, rcv) ?? toDate(rawPaid, year);
          })(),
          notes: txt(col(r, "Notes include who referals are paid to")), title_agent: txt(col(r, "Title Agent")),
          raw_row: raw,
        });
        // December deal, January cheque: a year-less paid date that lands well
        // before the money was received belongs to the following year.
        const last = records[records.length - 1];
        // Only when the received date is itself believable — a received date
        // typed as 20226 pushed one paid date into 2027.
        if (last.date_paid && last.date_received &&
            Math.abs(new Date(last.date_received).getUTCFullYear() - year) <= 1 &&
            new Date(last.date_paid).getTime() < new Date(last.date_received).getTime() - 14 * 86400000) {
          const d = new Date(last.date_paid + "T00:00:00Z"); d.setUTCFullYear(d.getUTCFullYear() + 1);
          // Never into the FUTURE. "Paid 3/30, received 4/28" (Paid 2026, row 201)
          // became 30 Mar 2027 — a payment eleven months from now. A paid date
          // before the received date that is not a December/January wrap is a
          // typing error for a person to fix, not something to guess (27 Sep).
          if (d.getTime() <= Date.now() + 30 * 86400000) last.date_paid = d.toISOString().slice(0, 10);
        }
      }

      // 4) resolve agents in bulk, then upsert
      for (const rec of records) {
        const { data: aid } = await supabase.rpc("resolve_agent_id", { p_name: rec.agent_name_raw });
        rec.agent_id = aid || null;
      }
      // A Trans ID can appear twice in the sheet — 279 does in Paid 2026 — and
      // Postgres refuses an upsert that would touch the same row twice
      // ("ON CONFLICT DO UPDATE command cannot affect row a second time"). One
      // duplicated line was failing the ENTIRE year. Keep the last occurrence,
      // which is the lower row and the later edit, and report the collision
      // rather than hiding it.
      const seen = new Map<string, any>();
      const collisions: number[] = [];
      for (const r of records) {
        const k = `${r.year}:${r.trans_id}`;
        if (seen.has(k)) collisions.push(r.trans_id);
        seen.set(k, r);
      }
      const deduped = [...seen.values()];
      if (collisions.length) summary.push({ tab, year, note: `duplicate Trans IDs in the sheet: ${[...new Set(collisions)].join(", ")}` });

      // upsert keyed on (year, trans_id)
      const { error: upErr } = await supabase.from("brokerage_transactions").upsert(
        deduped.map((r) => ({ ...r, imported_at: new Date().toISOString() })),
        { onConflict: "year,trans_id" },
      );
      if (upErr) { summary.push({ tab, year, error: upErr.message }); continue; }

      const sales = records.filter((r) => r.kind === "sale").length;
      const volume = records.filter((r) => r.kind === "sale").reduce((s, r) => s + (r.gross_sale || 0), 0);
      const diag: Record<string, unknown> = {};
      if (!records.length) {
        diag.rows_in_tab = rows.length - 1 - hRow;
        diag.header_row_number = hRow + 1;
        diag.skipped = skipped;
        diag.header_row = header.filter(Boolean).slice(0, 14);
        diag.trans_id_column_found = iTid >= 0;
        diag.first_row_sample = (rows[hRow + 1] || []).slice(0, 6).map((v) => v instanceof Date ? v.toISOString().slice(0, 10) : v);
      }
      summary.push({ tab, year, transactions: records.length, sales, volume: Math.round(volume), ...diag });
    }

    await supabase.from("commission_sheet_config").update({ last_synced_at: new Date().toISOString(), last_sync_result: summary }).eq("id", cfg.id);
    // Closings post themselves: once the sheet is read, the brokerage's books
    // are brought up to it (2026-10-07b_closings.sql). Rows that do not add up
    // are held there for a person. A failure here never fails the sheet read.
    let closings: unknown = null;
    try {
      const r = await supabase.rpc("closings_sync_all");
      closings = r.error ? { error: r.error.message } : r.data;
    } catch (e) { closings = { error: String(e) }; }
    return new Response(JSON.stringify({ ok: true, spreadsheet_id: cfg.spreadsheet_id, summary, closings }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
