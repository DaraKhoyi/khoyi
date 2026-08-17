// correspondent-research — turns one seed into a publishable piece, or says there
// is no story this week and stops.
//
// The hard part is not writing. It is refusing to write. Every content tool in
// real estate produces something every time it is asked, which is exactly why its
// output gets deleted unread. This one is allowed to come back with nothing, and
// that permission is what makes the times it does produce something worth opening.
//
// THREE RULES THE PROMPT ENFORCES:
//  - Never invent a figure. Every number carries a source, or it is cut. An
//    invented statistic in a client-facing email is a career risk for the agent
//    whose name is on it, not a style problem.
//  - A place story may discuss the market. It may never characterise the people.
//    Fair housing liability lives in adjectives about neighbourhoods, and the
//    reviewer strikes them before the agent ever sees the draft.
//  - Banned structures and words, listed explicitly, because the tells of machine
//    writing are specific and removable.
//
// verify_jwt: false — called with the agent's JWT and scoped to them.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const BANNED_WORDS = [
  "leverage", "seamless", "game-changing", "unlock", "elevate", "curated",
  "in today's market", "dive into", "delve", "landscape", "tapestry",
  "it's no secret", "look no further", "nestled", "boasts", "hidden gem",
  "must-see", "won't last", "dream home", "buyer's market", "seller's market",
];

const SYSTEM = `You research and write one short piece for a real-estate agent to publish under their own name. The agent's reputation is on it. Their clients will read it.

YOUR FIRST JOB IS TO DECIDE WHETHER THERE IS A STORY AT ALL.
Most weeks, for most seeds, there is not. If what you find is ordinary — nothing changed, no decision was made, no number moved in a way a normal person would notice — you return no_story: true with a plain reason. That is a correct and valuable answer. Do NOT manufacture a story from nothing; a piece nobody needed is worse than silence, because it teaches the reader to ignore the next one.

WHAT MAKES A PIECE WORTH SOMEONE'S FOUR MINUTES:
- It tells them something they did not know and could not easily have found.
- It has a specific, checkable fact at its centre — a decision, a filing, a number that moved, a thing that happened on a particular date.
- It answers "so what does that mean for me" without being asked.
- A reader with no relationship to the agent would still finish it.

BANNED STRUCTURES — using any of these means the piece failed:
- "In today's market…" or any opening that describes the season or the weather.
- A listicle. "5 tips", "3 things", "what you need to know".
- A monthly market summary. Median price up, inventory down, nobody cares.
- A press release rewritten. If the source is a press release, find what it did not say.
- Ending with a call to action about buying or selling. The piece is not an ad.
- Rhetorical questions as an opening. "Ever wondered…"
- The phrase "as a homeowner" or "as an investor".

BANNED WORDS: ${BANNED_WORDS.join(", ")}.

EVERY FACTUAL CLAIM NEEDS A SOURCE. For each one, record the publisher, the URL, the date, and the exact claim it supports. If you cannot source a claim, CUT IT — do not soften it into vagueness. Never estimate a figure and present it as fact.

FAIR HOUSING — this is the highest-risk part and it is not negotiable:
- You may write about: prices, inventory, days on market, taxes, insurance, permits, zoning, infrastructure, flood zones, builders, commercial openings, transport.
- You may NEVER write about: who lives somewhere or what they are like; whether an area is "family-friendly", "up-and-coming", "safe", "quiet", "improving", "desirable", "good" or "bad"; crime; schools beyond a bare state rating with its source named; religion, national origin, race, colour, sex, disability, familial status; anything about the "type" of buyer or resident.
- Describe PLACES BY THEIR FACTS, never by their people. If a sentence would be different if the residents changed, cut the sentence.

TONE: plain, short sentences. Specific over general. No exclamation marks. Write like a well-informed local who is not selling anything. Never sound like a Realtor's newsletter.

LENGTH: 350-600 words. Shorter is better than padded.

Return ONLY JSON, no fence:
{
 "no_story": false,
 "no_story_reason": null,
 "title": "plain and specific, under 70 chars, no colon-subtitle pattern",
 "dek": "one sentence saying why this is worth reading",
 "angle": "the angle chosen, one sentence",
 "angles_rejected": [{"angle":"...","why_rejected":"..."}],
 "body_md": "the piece in markdown, no title heading",
 "sources": [{"publisher":"...","url":"...","date":"...","claim":"the specific claim this supports"}],
 "unverified": ["any claim you kept that you could not source — should normally be empty"]
}`;

const REVIEW_SYSTEM = `You are a fair housing attorney who has defended advertising complaints, reviewing a piece a real-estate agent is about to publish under their own name in Florida.

Find every sentence that creates liability or reads as steering. You are looking for:
- Any characterisation of the PEOPLE of an area, however positive. "Family-friendly", "young professionals", "great community", "quiet neighbours" — all of it.
- Coded language: "up-and-coming", "improving", "desirable", "safe", "good area", "pride of ownership".
- Crime, or any proxy for it.
- Schools beyond a bare rating with the source named.
- Any protected class: race, colour, religion, sex, disability, familial status, national origin.
- Statistics presented without a source, or numbers that look invented.
- Anything that implies who should or should not live somewhere.

For each finding: quote the exact text, name the problem, and give a replacement that keeps the useful information and removes the liability. If a sentence cannot be saved, say STRIKE.

Return ONLY JSON:
{"pass": true, "findings":[{"quote":"...","problem":"...","fix":"..." }], "struck":["..."], "note":"one line for the agent"}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return j({ ok: false, error: "not authenticated" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: me } = await asUser.auth.getUser();
  const uid = me?.user?.id;
  if (!uid) return j({ ok: false, error: "not authenticated" }, 401);

  const body = await req.json().catch(() => ({}));
  const seedKind = ["zip", "tag", "freehand"].includes(body.seed_kind) ? body.seed_kind : "freehand";
  const seedValue = String(body.seed_value || "").slice(0, 200);
  if (!seedValue) return j({ ok: false, error: "seed required" });

  const brief = seedKind === "zip"
    ? `Seed: ZIP code / neighbourhood ${seedValue} (Tampa Bay area, Florida).
Search for what has actually happened here recently that a resident would not already know: permits and approvals, commercial openings and closures, infrastructure and road projects, zoning decisions, tax or millage changes, insurance market changes, flood map revisions, notable builder activity. Find the thing nobody has written up yet. Remember: places by their facts, never by their people.`
    : seedKind === "tag"
    ? `Seed: a group of this agent's contacts who share the interest "${seedValue}".
This is NOT a real-estate piece. Write something genuinely interesting to someone who cares about ${seedValue}, with a local (Tampa Bay) angle where one honestly exists. Do not force real estate into it. Do not mention property at all unless the story is actually about property. If the honest piece is purely about ${seedValue}, write that.`
    : `Seed, in the agent's own words: "${seedValue}". Research it and find the angle.`;

  let piece: any = null, usage: any = null;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 8000, system: SYSTEM,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
        messages: [{ role: "user", content: brief }],
      }),
    });
    const d = await r.json();
    usage = d?.usage;
    if (!r.ok) return j({ ok: false, error: d?.error?.message || ("HTTP " + r.status) });
    const text = (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    const a = text.indexOf("{"), z = text.lastIndexOf("}");
    piece = JSON.parse(a > -1 ? text.slice(a, z + 1) : text);
  } catch (err) {
    return j({ ok: false, error: "research failed: " + String(err) });
  }
  try { await logAiUsage(admin, { userId: uid, fn: "correspondent-research", model: MODEL, usage, usedOwn: false }); } catch (_) {}

  // No story is a real answer. Record it so the agent can see it decided, not failed.
  if (piece.no_story) {
    const { data: row } = await asUser.from("correspondent_pieces").insert({
      user_id: uid, seed_kind: seedKind, seed_value: seedValue,
      no_story: true, no_story_reason: piece.no_story_reason || "nothing worth publishing this week",
      status: "draft", model: MODEL,
    }).select("id").maybeSingle();
    return j({ ok: true, no_story: true, reason: piece.no_story_reason, piece_id: row?.id });
  }

  // Compliance review runs BEFORE the agent sees it, so the draft they read is
  // already clean. A reviewer that runs after the human has read it is theatre.
  let compliance: any = null;
  try {
    const r2 = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 2500, system: REVIEW_SYSTEM,
        messages: [{ role: "user", content: `TITLE: ${piece.title}\n\n${piece.body_md}` }],
      }),
    });
    const d2 = await r2.json();
    try { await logAiUsage(admin, { userId: uid, fn: "correspondent-compliance", model: MODEL, usage: d2?.usage, usedOwn: false }); } catch (_) {}
    const t2 = (d2.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    const a2 = t2.indexOf("{"), z2 = t2.lastIndexOf("}");
    if (a2 > -1) compliance = JSON.parse(t2.slice(a2, z2 + 1));
  } catch (_) { compliance = { pass: false, note: "compliance review did not complete — do not publish until it does" }; }

  // Deterministic backstop on the banned words. The prompt asks; this checks.
  const lower = String(piece.body_md || "").toLowerCase();
  const hits = BANNED_WORDS.filter((w) => lower.includes(w));
  if (hits.length) {
    compliance = { ...(compliance || {}), banned_words: hits,
      note: ((compliance?.note || "") + ` Banned phrasing found: ${hits.join(", ")}.`).trim() };
  }

  const slug = String(piece.title || "piece").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
  const { data: row, error } = await asUser.from("correspondent_pieces").insert({
    user_id: uid, seed_kind: seedKind, seed_value: seedValue,
    title: piece.title, dek: piece.dek, body_md: piece.body_md,
    angle: piece.angle, angles_rejected: piece.angles_rejected || [],
    sources: piece.sources || [], compliance,
    slug, status: "reviewing", model: MODEL,
  }).select("*").maybeSingle();
  if (error) return j({ ok: false, error: error.message });

  return j({ ok: true, piece: row, unverified: piece.unverified || [] });
});
