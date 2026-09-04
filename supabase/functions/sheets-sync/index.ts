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
function toDate(v: any): string | null {
  if (!v) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); // M/D/YYYY
  if (m) {
    let [_, mo, d, y] = m;
    if (y.length === 2) y = "20" + y;
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
      wb = XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: "array", cellDates: false });
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
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: null }) as any[][];
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
          gross_sale: gs, gross_commission: gc, date_received: toDate(col(r, "Date Rcvd")),
          amount_to_agent: toNum(col(r, "Amount to Pay Agent")), kind,
          lender: txt(col(r, "Lender")), office_fee: toNum(col(r, "Gross Office Fee") ?? col(r, "Office Fee Share")),
          referral_1: toNum(col(r, "Referral (1)")), rog_corp_cost: toNum(col(r, "ROG Corp. Cost")),
          tc_payment: toNum(col(r, "TC payment")), date_paid: toDate(col(r, "Date Paid (ALEX)")),
          notes: txt(col(r, "Notes include who referals are paid to")), title_agent: txt(col(r, "Title Agent")),
          raw_row: raw,
        });
      }

      // 4) resolve agents in bulk, then upsert
      for (const rec of records) {
        const { data: aid } = await supabase.rpc("resolve_agent_id", { p_name: rec.agent_name_raw });
        rec.agent_id = aid || null;
      }
      // upsert keyed on (year, trans_id)
      const { error: upErr } = await supabase.from("brokerage_transactions").upsert(
        records.map((r) => ({ ...r, imported_at: new Date().toISOString() })),
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
