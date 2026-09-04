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
function toDate(v: any, fallbackYear?: number): string | null {
  if (!v) return null;
  // A real date cell arrives as a Date once cellDates is on. Use its parts
  // directly — going through toISOString() would shift the day across the
  // timezone boundary for anything before 00:00 UTC.
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear(), mo = String(v.getMonth() + 1).padStart(2, "0"), d = String(v.getDate()).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }
  const s = String(v).trim();
  // "12/30" — the sheet holds some dates as text with no year at all. It belongs
  // to the tab it was read from.
  const md = s.match(/^(\d{1,2})\/(\d{1,2})$/);
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
  const dt = new Date(s);
  return isNaN(dt.getTime()) ? null : dt.toISOString().slice(0, 10);
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
      wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: "array", cellDates: true });
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

      // header name -> column index
      const header = rows[0].map((h) => String(h ?? "").trim());
      const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
      const iTid = idx("Trans ID"), iAgent = idx("Agent Name");
      const col = (r: any[], name: string) => { const i = idx(name); return i >= 0 ? r[i] : null; };

      const records: any[] = [];
      for (let ri = 1; ri < rows.length; ri++) {
        const r = rows[ri];
        const tid = iTid >= 0 ? r[iTid] : null;
        const agent = iAgent >= 0 ? r[iAgent] : null;
        if (isExclude(tid) || isExclude(agent)) continue;
        if (typeof tid !== "number" && !(typeof tid === "string" && /^\d+$/.test(tid.trim()))) continue;
        const transId = typeof tid === "number" ? Math.trunc(tid) : parseInt(tid, 10);

        // full raw row keyed by header name (nothing lost)
        const raw: Record<string, any> = {};
        header.forEach((h, ci) => { if (h) raw[h] = r[ci] ?? null; });

        const gs = toNum(col(r, "Gross Sale"));
        const gc = toNum(col(r, "Gross Commission Received"));
        const kind = gs && gs > 0 ? "sale" : (gc && gc > 0 ? "commission" : "fee");
        records.push({
          year, trans_id: transId, agent_name_raw: txt(agent) || "(unnamed)", source_tab: tab, source_row: ri + 1,
          address: txt(col(r, "Street Number and Name")), buy_side: !!txt(col(r, "Buy")), list_side: !!txt(col(r, "List")),
          gross_sale: gs, gross_commission: gc, date_received: toDate(col(r, "Date Rcvd"), year),
          amount_to_agent: toNum(col(r, "Amount to Pay Agent")), kind,
          lender: txt(col(r, "Lender")), office_fee: toNum(col(r, "Gross Office Fee") ?? col(r, "Office Fee Share")),
          referral_1: toNum(col(r, "Referral (1)")), rog_corp_cost: toNum(col(r, "ROG Corp. Cost")),
          tc_payment: toNum(col(r, "TC payment")), date_paid: toDate(col(r, "Date Paid (ALEX)"), year),
          notes: txt(col(r, "Notes include who referals are paid to")), title_agent: txt(col(r, "Title Agent")),
          raw_row: raw,
        });
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
      summary.push({ tab, year, transactions: records.length, sales, volume: Math.round(volume) });
    }

    await supabase.from("commission_sheet_config").update({ last_synced_at: new Date().toISOString(), last_sync_result: summary }).eq("id", cfg.id);
    return new Response(JSON.stringify({ ok: true, spreadsheet_id: cfg.spreadsheet_id, summary }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
