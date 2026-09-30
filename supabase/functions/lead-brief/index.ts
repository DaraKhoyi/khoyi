// Three lines about the person who just wrote to you.
//
// The panel's finding: the concierge surfaced 5,920 items and agents acted on
// 16, while contact-research — the tool that would tell you who these people
// are — fired 15 times in a month because nobody goes looking for it. Two
// underused tools, and the signal to join them already in the database.
//
// Marguerite set the shape: "a nudge, not a report, and only on contacts who
// wrote to her first." So this is deliberately NOT contact-research. That runs
// to a page and costs 30 cents. This is three lines and costs a fraction of a
// cent, because a card you glance at on a phone cannot carry a report and an
// agent deciding whether to reply does not want one.
//
// WHAT I COULD NOT VERIFY, recorded so nobody builds on it later as if it were
// established: the panel said the 16 acted-on leads "almost certainly share a
// behavioural signal". I checked. They are 11 rows from 9 people, and the one
// hypothesis I could test — already being a contact — was FALSE in every case,
// 0 of 11. Eleven points is not enough to fit a model to, and pretending
// otherwise would repeat the 90-day-retention mistake. So this does not target a
// learned signal. It applies the one rule Marguerite actually gave, which needs
// no model: a real person, writing to you first, who is not bulk.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import { isServiceCaller } from "../_shared/serviceCaller.ts";

// 30 Sep — RUNS ON ARRIVAL NOW. The panel (Simplifier + Marguerite + Newcomer):
// "a lead arrives, no brief fires, nobody knows if the contact can transact."
// This ran only on a "Who is this?" tap — 0 taps in 514 cards. lead-concierge
// now calls it (service) the moment a recognised lead lands, it reads the
// portal message when the buyer never emailed directly (every portal lead),
// and it is given what PrismOS already knows (lead_known_facts) and what the
// buyer has said about being able to act (lead-qualify), so its third line
// (It also asked for a column that does not exist — triage_summary — so every
// "Who is this?" tap since it shipped came back "not found".)
// answers Marguerite's question from facts — or says it is not known yet.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Same lists the HTML filter and the notification filter use. A newsletter does
// not get a briefing.
const BULK = /(no-?reply|do-?not-?reply|donotreply|notification|notifications|mailer|bounce|postmaster|newsletter|marketing|campaign|updates?@|news@|alerts?@|billing@|invoice@|receipts?@|noreply|beehiiv|mailchimp|sendgrid|constantcontact|hubspot|marketo|substack|klaviyo)/i;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { lead_id } = await req.json().catch(() => ({}));
  if (!lead_id) return json({ error: "lead_id required" }, 400);

  // Identity comes from the token, never from the body: the agent themself, or
  // the service (lead-concierge on arrival) acting for the card's own agent.
  let ownerId: string | null = null;
  if (await isServiceCaller(req)) {
    const { data: row } = await admin.from("lead_concierge").select("user_id").eq("id", lead_id).maybeSingle();
    ownerId = row?.user_id || null;
  } else {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    ownerId = user?.id || null;
  }
  if (!ownerId) return json({ error: "unauthorised" }, 401);
  const user = { id: ownerId };

  const { data: lead } = await admin
    .from("lead_concierge")
    .select("id, user_id, lead_email, lead_phone, lead_name, brief, inbound_text, source, kind, first_seen_at")
    .eq("id", lead_id).eq("user_id", user.id).maybeSingle();
  if (!lead) return json({ error: "not found" }, 404);
  if (lead.brief) return json({ ok: true, brief: lead.brief, cached: true });

  const addr = String(lead.lead_email || "").toLowerCase();
  // A portal lead's buyer address can look automated (leads@…) — the card's
  // own source says it is a real lead, and its message is what we read.
  if ((!addr || BULK.test(addr)) && !lead.source) return json({ ok: true, brief: null, skipped: "bulk sender" });

  // Their own words to this agent. Cheaper, more accurate and less intrusive
  // than searching the web for a stranger who has simply sent an email.
  const { data: msgs } = await admin
    .from("email_messages")
    .select("subject, snippet, body_text, internal_date, direction")
    .eq("user_id", user.id)
    .ilike("from_address", addr)
    .order("internal_date", { ascending: false })
    .limit(8);

  const { count: theirCount } = await admin
    .from("email_messages").select("id", { count: "exact", head: true })
    .eq("user_id", user.id).eq("direction", "inbound").ilike("from_address", addr);

  let thread = (msgs || []).map((m) =>
    `[${String(m.internal_date).slice(0, 10)}] ${m.subject || ""}: ${(m.body_text || m.snippet || "").replace(/\s+/g, " ").slice(0, 500)}`
  ).join("\n").slice(0, 6000);
  // Portal leads: the buyer never emailed directly; the inquiry IS the message.
  if (!thread.trim() && lead.inbound_text) thread = `[${String(lead.first_seen_at || "").slice(0, 10)}] ${String(lead.inbound_text).replace(/\s+/g, " ").slice(0, 1500)}`;

  if (!thread.trim()) return json({ ok: true, brief: null, skipped: "nothing to read" });

  // What PrismOS already knows (lookups, no AI) and what they said about being
  // able to act (lead-qualify). Given to the model as facts it may state.
  const [{ data: known }, { data: ready }] = await Promise.all([
    admin.rpc("lead_known_facts", { p_user: user.id, p_email: lead.lead_email, p_phone: lead.lead_phone, p_before: lead.first_seen_at || new Date().toISOString() }),
    admin.rpc("lead_readiness_for", { p_email: lead.lead_email, p_phone: lead.lead_phone }),
  ]);
  const knownLines: string[] = Array.isArray(known) ? known : [];
  const f = (ready && ready.facts) || {};
  const said = Object.entries(f).filter(([k, v]: any) => v && v.source === "said" && v.value !== null && v.value !== undefined)
    .map(([k, v]: any) => `${k.replace(/_/g, " ")}: ${v.value}${v.quote ? ` ("${String(v.quote).slice(0, 80)}")` : ""}`);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 160,
      system: [
        "You brief a real estate agent on someone who has just emailed them, in THREE SHORT LINES.",
        "This is read on a phone while deciding whether to reply. It is a nudge, not a report.",
        "",
        "Line 1 — WHO: who they appear to be and where from, in their own words. Nothing invented.",
        "Line 2 — WHAT THEY WANT: the ask, concretely. If it is unclear, say it is unclear.",
        "Line 3 — CAN THEY ACT: for a real buyer, seller or renter, say what is KNOWN about their",
        "  ability to act (pre-approved, cash, timeline, must sell first, already has an agent) from",
        "  the FACTS given — and if none is known, say 'Not known yet' and give the question to ask.",
        "  If it looks like a pitch, a vendor or an automated approach, say that plainly instead.",
        "  Never pad to fill three lines — two honest lines beat three.",
        "If PRISMOS KNOWS lists something (already a contact, written before, past client), put it in line 1.",
        "",
        "No preamble, no headings, no markdown. Plain sentences, one per line.",
        "You are reading ONLY what this person wrote to this agent. Do not speculate beyond it.",
      ].join("\n"),
      messages: [{ role: "user", content:
        `Sender: ${lead.lead_name || addr} <${addr}>\n` +
        // theirCount includes the inquiry itself; "before" comes only from PRISMOS KNOWS.
        `Messages from them to this agent, including this one: ${theirCount ?? 0}. Only PRISMOS KNOWS says whether they wrote BEFORE.\n` +
        (lead.source ? `Came in via: ${lead.source}\n` : "") +
        (knownLines.length ? `PRISMOS KNOWS: ${knownLines.join("; ")}\n` : "") +
        (said.length ? `FACTS THEY STATED: ${said.join("; ")}\n` : "FACTS THEY STATED: none yet\n") +
        (ready?.ask_next ? `ONE QUESTION TO ASK: ${ready.ask_next}\n` : "") +
        `\n${thread}` }],
    }),
  });

  const j = await res.json();
  const brief = (j?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
  if (!brief) return json({ error: "no brief produced" }, 502);

  const inTok = j?.usage?.input_tokens || 0, outTok = j?.usage?.output_tokens || 0;
  const cost = (inTok / 1e6) * 3 + (outTok / 1e6) * 15;

  await admin.from("lead_concierge")
    .update({ brief, brief_at: new Date().toISOString() }).eq("id", lead.id);
  // Standing rule: anything that spends tokens attributes the cost to its user.
  try {
    await admin.from("ai_usage_log").insert({
      user_id: user.id, fn: "lead-brief", model: "claude-sonnet-4-6",
      input_tokens: inTok, output_tokens: outTok, cost_usd: cost,
      subject_type: "lead_card", subject_id: lead.id, subject_email: addr || null,
    });
  } catch (_) { /* the brief still stands */ }

  return json({ ok: true, brief, cost });
});
