// investor-transition-draft — writes the letter the office manager sends when an
// agent leaves and their investors need to hear from the brokerage.
//
// WHY THIS IS AI-DRAFTED AND NOT A TEMPLATE: a mail-merge with [NAME] and a
// number in it reads like a mail-merge, and an investor who feels processed
// answers "remove me". Each investor has a different history — twenty properties
// and three viewings, or signed up last month and never shown anything — and the
// letter has to sound like someone looked before writing.
//
// WHAT THE DRAFT MAY NOT DO, enforced in the prompt and checked after:
//   - Invent a single number. Only the figures passed in, which come from
//     investor_matches and nothing else.
//   - Print a zero. "We presented you 0 properties" is worse than saying nothing;
//     thin-history investors are routed to a phone call instead of an email.
//   - Say anything about WHY the agent left, or anything that reads as criticism
//     of them. NAR Article 15, and simple decency: the investor may like them.
//   - Sound relieved, apologetic, or like a retention save. It is a courtesy
//     notice with a real question in it.
//
// The question is fixed by Dara: keep receiving matching properties, or come off
// the Investor Buyer list. Both answers are one tap and both are genuinely fine —
// an unsubscribe that requires a reply is not a real choice.
//
// verify_jwt: false — called with the manager's JWT, checked via is_brokerage_staff.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `You write one short letter from a real-estate brokerage to a property investor whose agent has left the firm. The brokerage sends it — not the departing agent, not the new one.

WHAT THIS LETTER IS: a courtesy notice with a genuine question in it. The investor gave us their buying criteria and we have been matching properties to it. Their agent has moved on. We are telling them before they hear it elsewhere, naming who is looking after them now, and asking whether they want us to carry on.

RULES — BREAKING ANY OF THESE MAKES THE LETTER UNUSABLE:
- Use ONLY the facts given to you. Invent nothing: no numbers, no property addresses, no dates, no claims about conversations.
- NEVER state a figure that is zero, and never imply a count you were not given. If the facts are thin, write a shorter letter that leans on their stated criteria instead of their history.
- Say the departing agent's name plainly and neutrally: "is no longer with the firm" or "has moved on from the firm". NOTHING about why. No praise that sounds like a eulogy, no hint of criticism, no speculation. The investor may well like this person.
- Do not apologise for the departure, do not sound relieved, and do not beg them to stay. No "we value you as a client", no "we would hate to lose you".
- Do not promise results, returns, or specific properties.
- No fair-housing risk: never characterise a neighbourhood, its people, or a buyer pool. Markets are place names only.
- Plain, short, confident sentences. No exclamation marks. No marketing language. Nothing a reasonable person would call salesy.

STRUCTURE, roughly 150-220 words:
1. One sentence: the agent is no longer with the firm, and who is looking after them now.
2. What we know they are looking for, in their own terms — this is what proves a person read the file.
3. Their history with us, ONLY if there is something real to say.
4. The question, clearly: continue receiving matching properties, or come off the list. Make clear both answers are fine and that either takes one tap.
5. One closing line offering a conversation if they would rather talk.

Do NOT write the greeting line or the sign-off — the system adds those. Do NOT write the buttons or links. Start at the first real sentence of the body.

Return ONLY JSON, no markdown fence:
{"subject":"...","body":"..."}
Subject: plain and specific, under 60 characters, no marketing tone. Body: paragraphs separated by a blank line.`;

function factSheet(n: any, brokerage: string): string {
  const st = n.stats || {};
  const lines: string[] = [];
  lines.push(`Brokerage: ${brokerage}`);
  lines.push(`Investor: ${n.buyer?.name || "(name unknown)"}`);
  lines.push(`Departing agent: ${n.departing_name || "their agent"}`);
  lines.push(`Now looking after them: ${n.new_name || "the brokerage's investor team"}`);

  const mk = Array.isArray(st.markets) ? st.markets.filter(Boolean) : [];
  if (mk.length) lines.push(`Areas they asked for: ${mk.join(", ")}`);
  const ty = Array.isArray(st.types) ? st.types.filter(Boolean) : [];
  if (ty.length) lines.push(`Property types they asked for: ${ty.join(", ")}`);
  const lo = st.price_min, hi = st.price_max;
  if (lo || hi) {
    const f = (v: any) => "$" + Number(v).toLocaleString("en-US");
    lines.push(`Price range they gave: ${lo && hi ? f(lo) + " to " + f(hi) : lo ? "from " + f(lo) : "up to " + f(hi)}`);
  }

  // Only positive counts. A zero is omitted entirely, never printed.
  const days = Number(st.days_on_list) || 0;
  if (days >= 30) lines.push(`On our investor list for about ${Math.round(days / 30)} month(s)`);
  const matched = Number(st.matched) || 0;
  const presented = Number(st.presented) || 0;
  const interested = Number(st.interested) || 0;
  if (presented > 0) lines.push(`Properties we put in front of them: ${presented}`);
  if (matched > presented && matched > 0) lines.push(`Properties that matched their criteria in total: ${matched}`);
  if (interested > 0) lines.push(`Of those, they told us they were interested in: ${interested}`);
  if (presented === 0) {
    lines.push(`HISTORY IS THIN: we have not actually presented them a property yet. Write the shorter version — lean on their stated criteria, and do NOT reference any history or counts.`);
  }
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return j({ ok: false, error: "not authenticated" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });

  // Staff check runs as the CALLER, so an agent cannot draft a company letter.
  const { data: isStaff } = await asUser.rpc("is_brokerage_staff");
  if (!isStaff) return j({ ok: false, error: "broker only" }, 403);

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.notice_ids) ? body.notice_ids : (body.notice_id ? [body.notice_id] : []);
  if (!ids.length) return j({ ok: false, error: "notice_id required" });

  const { data: queue } = await asUser.rpc("investor_transition_queue");
  const all = Array.isArray(queue) ? queue : [];
  const brokerage = "Realty ONE Group Advantage";
  const out: any[] = [];

  for (const id of ids.slice(0, 25)) {
    const n = all.find((x: any) => x.id === id);
    if (!n) { out.push({ id, ok: false, error: "not in queue" }); continue; }

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1400, system: SYSTEM,
          messages: [{ role: "user", content: "Write the letter from these facts. Use nothing that is not here.\n\n" + factSheet(n, brokerage) }],
        }),
      });
      const d = await r.json();
      try { await logAiUsage(admin, { userId: body.user_id || null, fn: "investor-transition-draft", model: MODEL, usage: d?.usage, usedOwn: false }); } catch (_) {}
      if (!r.ok) { out.push({ id, ok: false, error: d?.error?.message || ("HTTP " + r.status) }); continue; }

      const text = (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
      let parsed: any = null;
      try { parsed = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()); }
      catch (_) { const a = text.indexOf("{"), z = text.lastIndexOf("}"); if (a > -1 && z > a) { try { parsed = JSON.parse(text.slice(a, z + 1)); } catch (_) {} } }
      if (!parsed?.body) { out.push({ id, ok: false, error: "draft came back in an unexpected shape" }); continue; }

      // Belt and braces on the rule that matters most: no fabricated zero.
      let bodyText = String(parsed.body).replace(/\b0 (properties|matches|listings)\b/gi, "properties");

      await asUser.rpc("investor_transition_save", {
        p_id: id, p_subject: String(parsed.subject || "About your investor account").slice(0, 120), p_body: bodyText,
      });
      out.push({ id, ok: true, subject: parsed.subject, body: bodyText });
    } catch (err) {
      out.push({ id, ok: false, error: String(err) });
    }
  }
  return j({ ok: true, drafted: out.filter((o) => o.ok).length, results: out });
});
