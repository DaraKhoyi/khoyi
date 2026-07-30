// usage-report-monthly
// Generates last month's per-agent AI usage report as an .xlsx, stores it in the
// usage-reports bucket, records metadata, and emails it to khoyi1234@gmail.com.
// Run by pg_cron at 00:15 on the 1st of each month (America/New_York). verify_jwt=false.
//
// Optional body: { period_start: "YYYY-MM-01" } to (re)generate a specific month;
// otherwise it computes the calendar month that just ended.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const REPORT_TO = "khoyi1234@gmail.com";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function monthBounds(anchor: Date) {
  // the calendar month BEFORE the anchor's month (anchor is normally "now" on the 1st)
  const end = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));   // first of anchor's month = exclusive end
  const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1)); // first of prior month
  return { start, end };
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthLabel = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = createClient(SUPABASE_URL, SERVICE);
  try {
    const body = await req.json().catch(() => ({}));
    let start: Date, end: Date;
    if (body?.period_start) {
      start = new Date(body.period_start + "T00:00:00Z");
      end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    } else {
      ({ start, end } = monthBounds(new Date()));
    }
    const label = monthLabel(start);

    // Per-agent rollup for the window (same shape the Settings panel uses).
    const { data: rows, error: rErr } = await sb.rpc("ai_usage_rollup_admin", { p_start: start.toISOString(), p_end: end.toISOString() });
    if (rErr) return J({ error: "rollup failed: " + rErr.message }, 500);
    const agents = (rows || []) as any[];

    // Per-feature breakdown for the same window.
    const { data: byFn } = await sb.from("ai_usage_log")
      .select("fn, cost_usd, input_tokens, output_tokens, web_searches")
      .gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
    const featureMap: Record<string, { calls: number; cost: number; inTok: number; outTok: number; searches: number }> = {};
    for (const r of (byFn || [])) {
      const k = r.fn || "unknown";
      const f = featureMap[k] || (featureMap[k] = { calls: 0, cost: 0, inTok: 0, outTok: 0, searches: 0 });
      f.calls++; f.cost += Number(r.cost_usd || 0); f.inTok += r.input_tokens || 0; f.outTok += r.output_tokens || 0; f.searches += r.web_searches || 0;
    }

    // Totals.
    const totals = agents.reduce((a, r) => ({
      cost: a.cost + Number(r.platform_cost_usd || 0),
      inTok: a.inTok + Number(r.input_tokens || 0),
      outTok: a.outTok + Number(r.output_tokens || 0),
      searches: a.searches + Number(r.web_searches || 0),
      calls: a.calls + Number(r.calls || 0),
    }), { cost: 0, inTok: 0, outTok: 0, searches: 0, calls: 0 });

    // ── Build the workbook ──
    const wb = XLSX.utils.book_new();
    const money = (n: number) => Number((n || 0).toFixed(4));

    const summaryRows = [
      ["Realty ONE Group Advantage — AI Usage & Cost"],
      [label + "  (brokerage account)"],
      [],
      ["Total brokerage cost", "$" + totals.cost.toFixed(2)],
      ["Agents with usage", agents.filter((a) => Number(a.calls || 0) > 0).length + " of " + agents.length],
      ["Total AI calls", totals.calls],
      ["Input tokens", totals.inTok],
      ["Output tokens", totals.outTok],
      ["Web searches", totals.searches],
      [],
      ["Generated", new Date().toISOString().slice(0, 19).replace("T", " ") + " UTC"],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
    wsSummary["!cols"] = [{ wch: 26 }, { wch: 22 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    const agentHeader = ["Agent (email)", "Brokerage cost ($)", "Own-key cost ($)", "Calls", "Input tokens", "Output tokens", "Web searches"];
    const agentRows = agents.map((a) => [
      a.email || "Unknown", money(a.platform_cost_usd), money(a.own_key_cost_usd),
      Number(a.calls || 0), Number(a.input_tokens || 0), Number(a.output_tokens || 0), Number(a.web_searches || 0),
    ]);
    agentRows.push([]);
    agentRows.push(["TOTAL", money(totals.cost), "", totals.calls, totals.inTok, totals.outTok, totals.searches]);
    const wsAgents = XLSX.utils.aoa_to_sheet([agentHeader, ...agentRows]);
    wsAgents["!cols"] = [{ wch: 34 }, { wch: 18 }, { wch: 16 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 13 }];
    XLSX.utils.book_append_sheet(wb, wsAgents, "By Agent");

    const featHeader = ["Feature", "Calls", "Cost ($)", "Input tokens", "Output tokens", "Web searches"];
    const featRows = Object.entries(featureMap).sort((a, b) => b[1].cost - a[1].cost)
      .map(([fn, f]) => [fn, f.calls, money(f.cost), f.inTok, f.outTok, f.searches]);
    const wsFeat = XLSX.utils.aoa_to_sheet([featHeader, ...featRows]);
    wsFeat["!cols"] = [{ wch: 30 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 14 }, { wch: 13 }];
    XLSX.utils.book_append_sheet(wb, wsFeat, "By Feature");

    const xlsxBytes: Uint8Array = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const b64 = btoa(String.fromCharCode(...new Uint8Array(xlsxBytes)));
    const fname = `AI-Usage-${iso(start).slice(0, 7)}.xlsx`;
    const storagePath = `${iso(start).slice(0, 7)}/${fname}`;

    // ── Store in the bucket (upsert so re-runs replace) ──
    const { error: upErr } = await sb.storage.from("usage-reports").upload(storagePath, xlsxBytes, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", upsert: true,
    });
    if (upErr) return J({ error: "storage upload failed: " + upErr.message }, 500);

    // ── Email it (gmail-send supports attachments) ──
    let emailed_at: string | null = null;
    try {
      const { data: acct } = await sb.from("email_accounts").select("id, user_id").eq("email_address", REPORT_TO).eq("is_active", true).maybeSingle();
      if (acct?.id) {
        const summaryLine = `Total brokerage AI cost for ${label}: $${totals.cost.toFixed(2)} across ${agents.filter((a) => Number(a.calls || 0) > 0).length} active agent(s).`;
        // Direct fetch with the exact service-role key in the Authorization header so
        // gmail-send's trusted-internal bypass matches (functions.invoke forwards the
        // anon key, which wouldn't).
        const mailResp = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${SERVICE}`, "apikey": SERVICE, "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: acct.id, user_id: acct.user_id, to: REPORT_TO,
            subject: `AI Usage & Cost — ${label}`,
            body_text: `Attached is the AI usage & cost report for ${label}.\n\n${summaryLine}\n\nThe full breakdown by agent and by feature is in the attached spreadsheet. This report is also saved in PrismOS under the Brokerage tab.\n\n— Prism`,
            attachments: [{ filename: fname, mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", content_base64: b64 }],
          }),
        });
        if (mailResp.ok) emailed_at = new Date().toISOString();
        else console.error("gmail-send failed:", mailResp.status, (await mailResp.text()).slice(0, 200));
      }
    } catch (_) { /* email is best-effort; the stored report is the source of truth */ }

    // ── Record metadata (upsert on the month) ──
    const { error: metaErr } = await sb.from("usage_reports").upsert({
      period_start: iso(start), period_end: iso(end), month_label: label,
      storage_path: storagePath, total_cost_usd: money(totals.cost),
      agent_count: agents.length,
      totals: { input_tokens: totals.inTok, output_tokens: totals.outTok, web_searches: totals.searches, calls: totals.calls },
      emailed_to: emailed_at ? REPORT_TO : null, emailed_at,
    }, { onConflict: "period_start" });
    if (metaErr) return J({ error: "metadata write failed: " + metaErr.message }, 500);

    return J({ ok: true, month: label, total_cost: money(totals.cost), agents: agents.length, storage_path: storagePath, emailed: !!emailed_at });
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
