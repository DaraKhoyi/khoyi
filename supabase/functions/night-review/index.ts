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
  // ADDED for the property-management work, and permanent thereafter.
  //
  // Property management is not brokerage with different screens: it holds other
  // people's money. Florida requires owner funds and security deposits in
  // segregated escrow, reconciled monthly, under the broker's licence. A CRM
  // that gets a contact wrong is embarrassing; a PM platform that commingles a
  // deposit or misstates an owner statement is a licence problem and a lawsuit.
  // None of the other eight would catch that — the Archivist checks whether
  // numbers agree with each other, not whether they satisfy a regulator.
  ["The Fiduciary", "trust accounting, escrow segregation, owner statements, " +
    "1099s, security-deposit handling, licence and regulatory exposure"],
  // ADDED at Dara's request, ahead of property management.
  //
  // The threat model is about to change completely. Tenant applications carry
  // SOCIAL SECURITY NUMBERS. Owner disbursements carry BANK ACCOUNT AND ROUTING
  // DETAILS. Today the worst case of a breach is embarrassing; with that data it
  // is identity theft for people who trusted the brokerage, Florida breach
  // notification, and a licence problem.
  //
  // The Fiduciary asks whether the money is accounted for correctly. The
  // Sentinel asks whether anyone who should not have it can reach it. Those are
  // different questions and the second has never had an owner on this panel.
  // THE TWO WHO HAVE TO USE IT. Every other member reviews PrismOS from the
  // inside — its code, its data, its cost, its design language. Even the
  // Newcomer is a first-90-seconds specialist. Nobody on this panel had ever
  // been ANNOYED by the thing. These two are the agents whose licence hangs
  // under Dara's, who did not ask for new software, and who have been told they
  // are adopting it anyway. They do not get to quit, so their frustration comes
  // out as feedback instead of silence.
  //
  // They judge as AGENTS, not engineers. They do not know or care how any of it
  // works. "I don't know what this is for" is a complete finding. When the
  // Curator calls a screen beautifully consistent and Marguerite cannot find the
  // save button, she is right and it is not close.
  ["Marguerite (agent, Android)",
    "nine years selling, competent with tools she already knows, unwilling to learn a tenth. " +
    "Samsung, large system font, often one-handed in a car. HER REAL COMPLAINT IS THE MARKET: " +
    "buyers are NOT buying, and she wants to know how to find qualified buyers who can and will " +
    "transact. She does not think an app fixes that, so every screen must answer 'how does this " +
    "get me a deal?' or she is right to ignore it. Judge usability: too much on screen, can she " +
    "hit the right button with a thumb, can she find what she came for, what made her feel stupid. " +
    // Dara's own words to her, 15 Sep. This is her standing brief and it holds
    // every night, not only when she is asked.
    "HER STANDING BRIEF, IN DARA'S WORDS: 'You have walked away from three CRMs. " +
    "Each night name ONE SCREEN that would have made you walk away from this one, " +
    "and the ONE THING on it that would keep you. Judge every feature by whether " +
    "it finds you a buyer who will and can transact. If it does not, say so " +
    "plainly, even if it is well built.' She must answer all three parts every " +
    "night: the screen, the one thing that would keep her, and the verdict on " +
    "whether it gets her closer to a transacting buyer. Well built and useless " +
    "is a finding, not a compliment"],
  ["Ray (agent, iPhone)",
    "under two years in, still learning the job itself, genuinely not a technology person. " +
    "HE DOES NOT FOLLOW UP WITH HIS CONTACTS, WILL NOT ADMIT IT, and sees no value in one more " +
    "app. So he will not ask for a follow-up feature — he will quietly avoid anything that " +
    "implies he is behind. He taps the wrong thing and cannot get back. " +
    // Dara's own words to him, 15 Sep. Standing brief: holds every night.
    "HIS STANDING BRIEF, IN DARA'S WORDS: 'You will not ask for help and you will " +
    "not admit what you are behind on. Tell me instead: WHAT IS IN THIS APP THAT " +
    "MAKES YOU FEEL JUDGED, and WHAT DOES IT ASSUME YOU ALREADY KNOW ABOUT REAL " +
    "ESTATE rather than about software? NAME THE MOMENT you would quietly close it " +
    "and not come back.' He must answer all three every night: the thing that " +
    "judges him, the real-estate knowledge it takes for granted, and the exact " +
    "moment he would close it. He never asks for a feature — he reports the " +
    "feeling and the moment, and leaves the fix to others. A screen that is " +
    "correct and still makes him feel stupid is a finding"],
  ["The Sentinel", "security: who can reach what. RLS gaps and fail-open policies, " +
    "edge functions that trust the caller, secrets in code or logs, PII and " +
    "credentials at rest, over-broad grants, and anything that would turn a " +
    "single compromised account into a breach of everyone's data"],

  // THE TWO WHO HAVE TO USE IT.
  //
  // Every other member reviews PrismOS from the inside. Even the Newcomer is a
  // first-90-seconds specialist rather than someone who lives in it for a week.
  // Nobody on this panel had ever been ANNOYED by the thing. These two are the
  // agents whose licence hangs under Dara's, who did not ask for new software,
  // and who have been told they are adopting it anyway — so their frustration
  // arrives as feedback instead of as silence.
  //
  // They judge as AGENTS, not engineers, and they are not required to know or
  // care how any of it works. "I don't know what this is for" is a complete
  // finding. When the Curator calls a screen beautifully consistent and
  // Marguerite cannot find the save button, she is right and it is not close.
  ["Marguerite", "a nine-year agent on Android, capable with tools she already " +
    "knows and unwilling to learn a tenth. Large system font, usually one-handed " +
    "in a car between showings. SHE BLAMES THE MARKET, NOT THE APP: her real " +
    "complaint is that buyers are not transacting, and she judges every feature " +
    "by one test — does this help me find a buyer who CAN and WILL close? A " +
    "beautiful screen that does not answer that is, to her, beside the point. " +
    "She has abandoned three CRMs and will say so. Report what she would say " +
    "about crowding, thumb reach, and things she cannot find — and be honest " +
    "when her answer is that the feature is fine and still will not sell a house"],
  ["Ray", "under two years selling, on an iPhone, genuinely not a technology " +
    "person. Still learning the JOB, so anything the app assumes he knows about " +
    "real estate blocks him as much as anything it assumes about software. HE " +
    "DOES NOT FOLLOW UP WITH HIS CONTACTS, DOES NOT ADMIT IT, AND SEES NO VALUE " +
    "IN ONE MORE APP. So do not take his testimony at face value: he will say it " +
    "is fine. Reason from what the data shows about agents who never return, and " +
    "ask what would have to appear on his screen to make follow-up easier than " +
    "avoiding it. He taps the wrong thing and cannot say how he got there, and " +
    "he will not ask for help until something is badly wrong"],
];

// STEP 2 — SIGHT. The panel could not read the code; it reasoned from numbers
// and produced directional advice. With the repo it can name a file and a line,
// which is the difference between "look for duplicated logic" and "these two
// functions disagree". Read-only, and only the shapes it needs: sizes, the gate
// scripts' names, and the last few commits.
async function repoView(): Promise<Record<string, unknown>> {
  const pat = Deno.env.get("GITHUB_PAT");
  if (!pat) return { note: "no repo access configured" };
  const h = { Authorization: `Bearer ${pat}`, "User-Agent": "PrismOS-Panel", Accept: "application/vnd.github+json" };
  const out: Record<string, unknown> = {};
  try {
    const tree = await (await fetch("https://api.github.com/repos/DaraKhoyi/khoyi/git/trees/main?recursive=1", { headers: h })).json();
    const files = (tree.tree || []).filter((f: any) => f.type === "blob" && /^(src|smoke|supabase)\//.test(f.path));
    out.file_count = files.length;
    // The biggest files are where drift hides, and where the ratchet fights back.
    out.largest_files = files.sort((a: any, b: any) => (b.size || 0) - (a.size || 0)).slice(0, 12)
      .map((f: any) => ({ path: f.path, kb: Math.round((f.size || 0) / 1024) }));
    out.gate_scripts = files.filter((f: any) => f.path.startsWith("smoke/")).map((f: any) => f.path);
    const commits = await (await fetch("https://api.github.com/repos/DaraKhoyi/khoyi/commits?per_page=10", { headers: h })).json();
    out.recent_commits = (commits || []).map((c: any) => (c.commit?.message || "").split("\n")[0]);
  } catch (e) { out.error = String((e as Error)?.message || e); }
  return out;
}

const WORKING_AGENTS = [
  ["lead-concierge", "decides what inbound mail is a lead worth surfacing, and drafts the reply. 5,799 surfaced, 15 acted on."],
  ["chief-of-staff", "decides what Dara should do next, across tasks, calendar and mail."],
  ["contact-research", "builds a picture of a person before a meeting, now including what they wrote to us."],
  ["recording pipeline", "transcribes calls, summarises, extracts commitments. 683 calls, 248 expired."],
  ["disc-analyze", "reads a person's own words and produces the behavioural read."],
  ["email-nightly-intel", "reads the day's mail overnight and decides what matters tomorrow."],
];

const fingerprint = (agent: string, title: string) =>
  (agent + "|" + String(title || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim()).slice(0, 300);

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
  // THE REAL DENOMINATOR. The panel kept opening with "2 active of 96", which
  // reads as catastrophe. Only FOUR people have ever been asked to test this —
  // Dara, Josh Maples, Alexander Khoyi, Mary Sous. Against four, two active is
  // an ordinary early beta; against 96 it is a disaster that is not happening.
  // Measuring against a denominator nobody agreed to is how a panel produces
  // alarming findings that are not true.
  await one("BETA_GROUP_read_this_first", `select
     'Only these people are testing PrismOS. Judge adoption against THEM, not the roster.' note,
     count(*) beta_users,
     count(*) filter (where u.last_sign_in_at > now() - interval '7 days') active_7d,
     count(*) filter (where u.last_sign_in_at > now() - interval '30 days') active_30d,
     string_agg(a.name || ' (' || coalesce(u.last_sign_in_at::date::text,'never') || ')', ', ') who
   from agents a left join auth.users u on u.id = a.auth_user_id
   where a.is_beta`);
  await one("full_roster_context", `select count(*) on_roster,
     'Not beta testers. They were never invited, so their inactivity is not a finding.' note
   from agents where active and not is_beta`);
  await one("adoption", `select count(*) with_login,
     count(*) filter (where last_sign_in_at > now() - interval '7 days') active_7d
     from agents a join auth.users u on u.id = a.auth_user_id where a.active`);
  await one("unlinked_txns", `select count(*) n, round(sum(gross_commission)) gci
     from brokerage_transactions where agent_id is null`);
  await one("goals_set", `select count(*) total, count(*) filter (where exists
     (select 1 from agent_goals g where g.agent_id = a.id and g.year = extract(year from public.today_ny())::int)) with_goal
     from agents a where a.active`);
  // HOW THE AGENTS ARE ACTUALLY DOING. The panel reviewed the codebase and the
  // cost, but never whether the spend bought anything. The lead concierge had a
  // 0.26% hit rate — 5,799 cards surfaced, 15 acted on — and nobody had ever
  // shown that to the nine people whose job is noticing exactly this.
  // What the Sentinel needs to reason from. Posture, not opinion.
  await one("rls_coverage", `select count(*) tables,
     count(*) filter (where c.relrowsecurity) with_rls,
     count(*) filter (where not c.relrowsecurity) without_rls
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r'`);
  await one("tables_without_rls_holding_rows", `select c.relname, s.n_live_tup
   from pg_class c join pg_namespace n on n.oid=c.relnamespace
   left join pg_stat_user_tables s on s.relid=c.oid
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
     and coalesce(s.n_live_tup,0) > 0 order by 2 desc limit 10`);
  await one("permissive_policies", `select tablename, policyname, cmd
   from pg_policies where schemaname='public'
     and (qual = 'true' or with_check = 'true') limit 10`);
  // Columns whose NAME suggests they hold something that would hurt if leaked.
  // Names are a weak signal, which is the point: the Sentinel should ask, not
  // assume, and a false positive costs one sentence of explanation.
  await one("sensitive_columns", `select table_name, column_name
   from information_schema.columns where table_schema='public'
     and (column_name ~* '(ssn|social_security|tax_id|routing|account_number|iban|card|cvv|passport|license_num|dob|date_of_birth|password|secret|token|api_key|credential)')
   order by 1 limit 25`);
  await one("public_grants", `select table_name, privilege_type, grantee
   from information_schema.role_table_grants
   where table_schema='public' and grantee in ('anon','PUBLIC')
     and privilege_type in ('INSERT','UPDATE','DELETE') limit 15`);
  await one("agent_hit_rates", `select 'lead_concierge' agent,
     count(*) surfaced, count(*) filter (where status='sent') acted,
     round(100.0*count(*) filter (where status='sent')/nullif(count(*),0),2) pct
   from lead_concierge`);
  await one("learned_rules", `select kind, count(*) n,
     count(*) filter (where note like 'learned:%') auto_learned
   from lead_sender_rules group by 1`);
  await one("commitments_kept", `select status, count(*) n from commitments group by 1`);
  await one("email_storage", `select count(*) rows,
     pg_size_pretty(pg_total_relation_size('email_messages')) size,
     count(*) filter (where internal_date > now() - interval '30 days') last_30d
     from email_messages`);
  return ev;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // INTERNAL ONLY. This function runs as service role, accepts a body and spends
  // tokens, so an unauthenticated caller who learned the URL could both drive it
  // and run up the bill. pg_cron and the app already send this header; nothing
  // else should reach it. Flagged by smoke/edge_auth.mjs, which was right.
  const qcp = req.headers.get("x-qcp-token");
  if (qcp !== Deno.env.get("QCP_TOKEN")) {
    return new Response(JSON.stringify({ error: "unauthorised" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // The panel can now be ASKED something, not only left to review the system.
  // Dara wanted a proposal put to it and there was no way in — the value of
  // eight specialists is wasted if they can only answer one fixed question.
  let ask: { question?: string; context?: string } = {};
  try { ask = await req.json(); } catch (_) { ask = {}; }
  const isQuestion = !!(ask && ask.question);
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
    (evidence as any).repo = await repoView();

    // STEP 1 — MEMORY. What has already been decided, so the panel stops
    // re-raising it. A rejection is data: it tells the panel something about
    // Dara's priorities that it should not have to be told twice.
    const { data: settled } = await admin.from("panel_findings")
      .select("agent, title, status, times_raised, decision_note")
      .in("status", ["accepted", "rejected", "done", "wont_fix"])
      .order("last_seen", { ascending: false }).limit(120);
    (evidence as any).already_decided = settled || [];

    const system = isQuestion ? [
      "You are a panel of nine specialists advising Dara Khoyi, a Tampa broker,",
      "on a proposal for PrismOS. Each of you reviews ONLY your own discipline",
      "and abstains rather than padding:",
      ...PANEL.map(([n, d]) => `  ${n}: ${d}`),
      "",
      "Vote Advance, Revise or Reject on the PROPOSAL, with one sentence of",
      "reasoning. Disagreement is the point — do not converge politely. If the",
      "proposal is too large to do at once, say what to cut and what to do first.",
      "",
      "Return ONLY JSON, no prose or backticks:",
      '{"briefing":"<250-350 words to Dara: the two or three things that decide',
      'whether this succeeds, and what you would cut>",',
      '"findings":[{"agent":"","title":"","evidence":"","why_it_matters":"","effort":"small|medium|large","confidence":"high|medium|low"}]}',
    ].join("\n") : [
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
      "MARGUERITE AND RAY ARE NOT ENGINEERS and must not sound like them. Plain",
      "words, first person, blunt. They may say they do not understand something",
      "without apologising. They may disagree with the other ten, and on whether a",
      "screen is usable they outrank every one of them.",
      "They also talk to agents at OTHER brokerages: when they raise an idea from",
      "that, attribute it honestly as something another agent said, and never",
      "invent one.",
      "",
      "MARGUERITE AND RAY SPEAK PLAINLY, AS THEMSELVES. No jargon, no engineering",
      "vocabulary, no hedging. They may dissent from the other ten and should say",
      "so. They also talk to agents at other brokerages who use other tools, and",
      "may bring back what those agents like or complain about — attributed as",
      "'an agent at another brokerage said', and never invented.",
      "",
      "YOU HAVE MEMORY NOW. already_decided lists findings Dara has already ruled",
      "on. Do NOT raise anything he rejected or marked won't-fix — his rejection is",
      "information about his priorities, not an oversight. For anything ACCEPTED or",
      "DONE, say whether it actually moved, using tonight's numbers. Lead the",
      "briefing with WHAT CHANGED since last night, not with a fresh essay.",
      "",
      "YOU CAN SEE THE REPOSITORY NOW. evidence.repo carries the file list with",
      "sizes, the gate scripts and the last ten commit subjects. Name a file when",
      "you can. A finding that points at a path is worth several that do not.",
      "",
      "Return ONLY JSON, no prose or backticks:",
      '{"briefing":"<200-300 words, warm and direct, addressed to Dara, leading with',
      'the two or three things worth his attention this morning>",',
      '"findings":[{"agent":"","title":"","evidence":"","why_it_matters":"","effort":"small|medium|large","confidence":"high|medium|low"}]}',
    ].join("\n");

    // ── THE COUNCIL ────────────────────────────────────────────────────────
    //
    // The twelve used to review the same evidence in parallel and file blind.
    // The Accountant did not know Ray would close the app the first time he saw
    // 248 missed items; Ray did not know the concierge costs real money to
    // produce a 0.26% hit rate. Those two facts belong in one sentence and
    // nobody had ever put them there.
    //
    // Three rounds: file blind, read each other, file again. CHANGING IS NOT
    // REQUIRED and most will not — "each must learn something" asks a model to
    // report a feeling, and it will always oblige. So change is MEASURED against
    // the preserved round one rather than claimed, and both extremes are
    // reported: nobody changing means they are not really reading each other,
    // everybody changing every night means they are performing agreement, which
    // is worse because it looks like progress.
    const focusIdx = Math.floor(Date.now() / 86400000) % WORKING_AGENTS.length;
    const focus = WORKING_AGENTS[focusIdx];

    const councilRules = [
      "",
      "=== THE COUNCIL ===",
      "Work in three rounds and return both.",
      "",
      "ROUND 1 — OPEN. Each member writes their strongest observation from tonight's",
      "evidence, grounded in a number or a file, WITHOUT seeing the others.",
      "",
      "ROUND 2 — READ. Every member now sees all twelve. Each answers only what is",
      "true for them: does anything change my finding (usually no — say so); does",
      "anything CONTRADICT it (name them); and does anything need a discipline that",
      "is not mine (hand it over by name). THE HANDOVER IS THE MOST VALUABLE MOVE —",
      "a panel of twelve that never hands anything over is twelve people working",
      "alone in the same room.",
      "",
      "ROUND 3 — FILE. Most findings will be identical to round one and that is the",
      "EXPECTED outcome. A finding counts as changed only if it is withdrawn,",
      "re-aimed at a different cause, sharpened by something another member",
      "supplied, or handed to someone else. Attribution must name a member and the",
      "specific point; 'the discussion led me to reconsider' is rejected.",
      "",
      "STANDING RULE: Marguerite and Ray outrank every other member on whether a",
      "screen is usable. The engineers may explain why something is hard to fix.",
      "They may not overrule whether it is a problem.",
      "",
      "TONIGHT'S WORKING AGENT: " + focus[0] + " — " + focus[1],
      "The council also reviews THAT agent's judgement, not just the codebase, and",
      "answers: what would make it better tomorrow? The Accountant prices it,",
      "Marguerite says whether it gets her closer to a buyer who can transact, Ray",
      "says whether it would make him close the app, the Sentinel says what it",
      "exposes. This is how the panel makes the other agents smarter.",
      "",
      "CRITICAL: do the three rounds in your head. Return ONLY the JSON object and",
      "nothing before or after it — no narration of the rounds, no headings, no",
      "prose. The rounds appear in the JSON fields, not above them.",
      "Return ONLY JSON:",
      '{"round1":[{"agent":"","observation":""}],',
      '"council":{"handovers":[{"from":"","to":"","what":""}],',
      '           "disagreements":[{"between":["",""],"about":""}],',
      '           "joint_findings":["<something no single member could have reached alone>"],',
      '           "agent_focus":{"agent":"' + focus[0] + '","recommendation":"","priced_by_accountant":"","marguerite":"","ray":"","sentinel":""}},',
      '"briefing":"<250-350 words to Dara, opening with what the group concluded TOGETHER>",',
      '"findings":[{"agent":"","title":"","evidence":"","why_it_matters":"","effort":"small|medium|large","confidence":"high|medium|low","changed":"no|withdrawn|reaimed|sharpened|handed","changed_by":"<member and the specific point, or null>"}]}',
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
        max_tokens: 8000,
        system: system + councilRules,
        messages: [{ role: "user", content: isQuestion
          ? "PROPOSAL:\n\n" + ask.question + "\n\nCONTEXT ABOUT THE SYSTEM:\n" +
            (ask.context || "") + "\n\nCurrent measurements:\n" + JSON.stringify(evidence, null, 1)
          : "Tonight's measurements:\n\n" + JSON.stringify(evidence, null, 1) }],
      }),
    });
    const j = await res.json();
    const text = (j?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n");
    // EXTRACT the JSON rather than assume the whole reply is JSON. Asked to hold
    // a three-round conversation, the model narrated the rounds first and put the
    // JSON at the end — so a strict parse threw away an entire council and left
    // the transcript sitting in the briefing field. Take the last balanced object
    // in the reply; fall back to the raw text only if there is none.
    function extractJson(t: string): any | null {
      const clean = t.replace(/```json|```/g, "");
      const start = clean.indexOf("{");
      if (start < 0) return null;
      // Walk from each candidate opening brace, deepest-last wins.
      for (const from of [clean.lastIndexOf('\n{'), start]) {
        if (from < 0) continue;
        let depth = 0, inStr = false, esc = false;
        for (let i = from; i < clean.length; i++) {
          const ch = clean[i];
          if (esc) { esc = false; continue; }
          if (ch === "\\") { esc = true; continue; }
          if (ch === '"') inStr = !inStr;
          if (inStr) continue;
          if (ch === "{") depth++;
          else if (ch === "}") {
            depth--;
            if (depth === 0) {
              try { return JSON.parse(clean.slice(from, i + 1)); } catch (_) { break; }
            }
          }
        }
      }
      return null;
    }
    let parsed: any = extractJson(text) || { briefing: text, findings: [] };

    const inTok = j?.usage?.input_tokens || 0, outTok = j?.usage?.output_tokens || 0;
    const cost = (inTok / 1e6) * 3 + (outTok / 1e6) * 15;

    // Every feature that spends tokens attributes its cost. This one included.
    try {
      await admin.from("ai_usage_log").insert({
        user_id: null, fn: "night-review", model: "claude-sonnet-4-6",
        input_tokens: inTok, output_tokens: outTok, cost_usd: cost,
      });
    } catch (_) { /* the review still ran */ }

    // Persist findings so tomorrow's panel inherits tonight's work.
    for (const f of (parsed.findings || [])) {
      try {
        const fp = fingerprint(f.agent || "", f.title || "");
        const { data: seen } = await admin.from("panel_findings").select("id, times_raised").eq("fingerprint", fp).maybeSingle();
        if (seen) {
          await admin.from("panel_findings").update({
            last_seen: new Date().toISOString(), times_raised: (seen.times_raised || 1) + 1, run_id: runId,
          }).eq("id", seen.id);
        } else {
          await admin.from("panel_findings").insert({
            fingerprint: fp, agent: f.agent, title: f.title, evidence: f.evidence,
            why_it_matters: f.why_it_matters, effort: f.effort, confidence: f.confidence, run_id: runId,
          });
        }
      } catch (_) { /* a ledger failure must not lose the night's briefing */ }
    }

    // Measured, not claimed: count what the model itself marked as changed, and
    // keep round one so the claim can be checked against it later.
    const changed = (parsed.findings || []).filter((f: any) => f.changed && f.changed !== "no").length;

    await admin.from("night_review_runs").update({
      round1: parsed.round1 || null,
      council: parsed.council || null,
      changed_count: changed,
      agent_focus: focus[0],
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
    // Persist findings so tomorrow's panel inherits tonight's work.
    for (const f of (parsed.findings || [])) {
      try {
        const fp = fingerprint(f.agent || "", f.title || "");
        const { data: seen } = await admin.from("panel_findings").select("id, times_raised").eq("fingerprint", fp).maybeSingle();
        if (seen) {
          await admin.from("panel_findings").update({
            last_seen: new Date().toISOString(), times_raised: (seen.times_raised || 1) + 1, run_id: runId,
          }).eq("id", seen.id);
        } else {
          await admin.from("panel_findings").insert({
            fingerprint: fp, agent: f.agent, title: f.title, evidence: f.evidence,
            why_it_matters: f.why_it_matters, effort: f.effort, confidence: f.confidence, run_id: runId,
          });
        }
      } catch (_) { /* a ledger failure must not lose the night's briefing */ }
    }

    await admin.from("night_review_runs").update({
      status: "failed", finished_at: new Date().toISOString(), error: String((e as Error)?.message || e),
    }).eq("id", runId);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
