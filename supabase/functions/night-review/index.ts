// The overnight panel.
//
// Runs at 1:00 AM New York, gathers real evidence from the live system, puts it
// to eight specialists who each review only their own discipline, and leaves a
// briefing for Dara to wake up to.
//
// TWO RULES THAT ARE NOT NEGOTIABLE.
//
// 1. It does not commit. allow_fixes defaults to FALSE and nothing in this file
//    writes to the repository. The value Dara described — waking up with ideas —
//    comes from the briefing; the commits are where the downside lives. In one
//    supervised week I introduced a data-isolation leak, orphaned $1.88M of
//    transactions, and twice reported work as shipped when CI had rejected it.
//    Every one was caught because a person was watching. An unattended process
//    with commit rights and none of that supervision is a different risk class,
//    and the allowlist is worth building only after Dara has watched what this
//    thing proposes for a few weeks.
//
// 2. The kill switch is checked FIRST, every run. Dara can stop it from the app
//    without waiting for me.
//
// The panel earns its place by finding things a person would not, so it is fed
// MEASUREMENTS rather than asked to speculate: table sizes, spend, unlinked
// rows, silent-failure counts, adoption. A recommendation that could have been
// written without opening the database is a failure of this function.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-qcp-token",
};

const PANEL = [
  ["The Architect", "duplicated logic, drift, structural decay, one-rule-one-place violations"],
  ["The Skeptic", "silent failures, unchecked writes, missing rollbacks, what breaks unnoticed"],
  ["The Archivist", "data integrity: orphans, duplicates, stale syncs, numbers that disagree"],
  ["The Curator", "visual inconsistency, anything fighting the Rooms design language"],
  ["The Simplifier", "screens doing too much, steps that could be removed entirely"],
  ["The Newcomer", "discoverability for an agent in their first ninety seconds"],
  ["The Accountant", "token spend, query cost, storage growth, cost per agent per month"],
  ["The Merchant", "what would make this sellable beyond this one brokerage"],
];

async function gather(admin: any) {
  const ev: Record<string, unknown> = {};
  const one = async (k: string, sql: string) => {
    try {
      const { data } = await admin.rpc("exec_readonly", { q: sql });
      ev[k] = data;
    } catch (_) { ev[k] = null; }
  };
  // Measurements, not impressions.
  await one("ai_spend_30d", `select fn, count(*) n, round(sum(cost_usd)::numeric,2) usd
     from ai_usage_log where created_at > now() - interval '30 days'
     group by 1 order by 3 desc limit 8`);
  await one("biggest_tables", `select relname, n_live_tup from pg_stat_user_tables
     where schemaname='public' order by n_live_tup desc limit 8`);
  await one("empty_tables", `select count(*) filter (where n_live_tup=0) empty, count(*) total
     from pg_stat_user_tables where schemaname='public'`);
  await one("adoption", `select count(*) with_login,
     count(*) filter (where last_sign_in_at > now() - interval '7 days') active_7d
     from agents a join auth.users u on u.id = a.auth_user_id where a.active`);
  await one("unlinked_txns", `select count(*) n, round(sum(gross_commission)) gci
     from brokerage_transactions where agent_id is null`);
  await one("goals_set", `select count(*) total, count(*) filter (where exists
     (select 1 from agent_goals g where g.agent_id = a.id and g.year = extract(year from public.today_ny())::int)) with_goal
     from agents a where a.active`);
  await one("email_storage", `select count(*) rows,
     pg_size_pretty(pg_total_relation_size('email_messages')) size,
     count(*) filter (where internal_date > now() - interval '30 days') last_30d
     from email_messages`);
  return ev;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // The kill switch, before anything else happens or anything is spent.
  const { data: cfg } = await admin.from("night_review_config").select("*").eq("id", true).maybeSingle();
  if (!cfg || cfg.enabled !== true) {
    return new Response(JSON.stringify({ skipped: "disabled" }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const { data: dayRow } = await admin.rpc("today_ny");
  const ranFor = dayRow || new Date().toISOString().slice(0, 10);

  const { data: run } = await admin.from("night_review_runs")
    .insert({ ran_for: ranFor, status: "running" }).select("id").single();
  const runId = run?.id;

  try {
    const evidence = await gather(admin);

    const system = [
      "You are a panel of eight specialists reviewing PrismOS, a real estate brokerage",
      "platform used daily by a broker with ~96 agents in Tampa.",
      "",
      "You are given MEASUREMENTS from the live system. Ground every claim in them.",
      "A recommendation that could have been written without seeing this data is a",
      "failure — 'improve error handling', 'add tests', 'consider accessibility' are",
      "non-answers. Cite the number you are reasoning from.",
      "",
      "Each specialist reviews ONLY their own discipline and abstains rather than padding:",
      ...PANEL.map(([n, d]) => `  ${n}: ${d}`),
      "",
      "Fewer excellent findings beat many weak ones. Three real ones is a good night.",
      "",
      "Return ONLY JSON, no prose or backticks:",
      '{"briefing":"<200-300 words, warm and direct, addressed to Dara, leading with',
      'the two or three things worth his attention this morning>",',
      '"findings":[{"agent":"","title":"","evidence":"","why_it_matters":"","effort":"small|medium|large","confidence":"high|medium|low"}]}',
    ].join("\n");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        system,
        messages: [{ role: "user", content: "Tonight's measurements:\n\n" + JSON.stringify(evidence, null, 1) }],
      }),
    });
    const j = await res.json();
    const text = (j?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    let parsed: any = {};
    try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); } catch (_) { parsed = { briefing: text, findings: [] }; }

    const inTok = j?.usage?.input_tokens || 0, outTok = j?.usage?.output_tokens || 0;
    const cost = (inTok / 1e6) * 3 + (outTok / 1e6) * 15;

    // Every feature that spends tokens attributes its cost. This one included.
    try {
      await admin.from("ai_usage_log").insert({
        user_id: null, fn: "night-review", model: "claude-sonnet-4-6",
        input_tokens: inTok, output_tokens: outTok, cost_usd: cost,
      });
    } catch (_) { /* the review still ran */ }

    await admin.from("night_review_runs").update({
      status: "done", finished_at: new Date().toISOString(),
      briefing: parsed.briefing || null,
      findings: parsed.findings || [],
      fixes: [],                 // nothing is changed; see the note at the top
      cost_usd: cost,
    }).eq("id", runId);

    return new Response(JSON.stringify({ ok: true, findings: (parsed.findings || []).length, cost }),
      { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    // A failed review must be visible tomorrow, not silent. Dara should never
    // wonder whether the panel found nothing or simply never ran.
    await admin.from("night_review_runs").update({
      status: "failed", finished_at: new Date().toISOString(), error: String((e as Error)?.message || e),
    }).eq("id", runId);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
