// commitment-rejudge — re-read the waiting cards under the rules learned from the
// broker's 190 dismissals (21 Sep), and give every survivor what a card needs.
//
// The new extractor prevents new noise. The backlog was made by the old one: cards
// with no named person, no "what do I do", other people's work steps that owed the
// agent nothing. Rules in code can catch the obvious ones (and did — 77 archived);
// "does this vendor's promise owe the agent anything?" needs judgement.
//
// For each card: keep or archive, and for a keeper — the person's name, a title
// that stands alone, the agent's next step, one line of context. Archived cards get
// the reason in commitment_events and can be restored; they are never "dismissed",
// because that word belongs to the agent's own decisions.
//
// x-qcp-token gated. Body: { user_id?, limit? } — default 40 cards per run.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
const MODEL = "claude-sonnet-4-6";

Deno.serve(async (req) => {
  if (req.headers.get("x-qcp-token") !== Deno.env.get("QCP_TOKEN")) return J({ error: "unauthorised" }, 401);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit) || 40, 60);

  let qb = db.from("commitments").select("id,user_id,owner,title,quote,contact_id,call_id,owner_name,next_step")
    .eq("status", "proposed").is("next_step", null).order("created_at", { ascending: false }).limit(limit);
  if (body.user_id) qb = qb.eq("user_id", body.user_id);
  const { data: cards, error } = await qb;
  if (error) return J({ error: error.message }, 500);
  if (!cards?.length) return J({ ok: true, judged: 0 });

  // Names and call summaries, so the model knows who and what each card is about.
  const cids = [...new Set(cards.map((c) => c.contact_id).filter(Boolean))];
  const calls = [...new Set(cards.map((c) => c.call_id).filter(Boolean))];
  const [{ data: people }, { data: sums }] = await Promise.all([
    cids.length ? db.from("contacts").select("id,name").in("id", cids) : Promise.resolve({ data: [] }),
    calls.length ? db.from("quo_calls").select("id,summary").in("id", calls) : Promise.resolve({ data: [] }),
  ]);
  const nameOf = Object.fromEntries((people || []).map((p: any) => [p.id, p.name]));
  const sumOf = Object.fromEntries((sums || []).map((s: any) => [s.id, typeof s.summary === "string" ? s.summary : JSON.stringify(s.summary || "")]));

  const items = cards.map((c, i) => ({
    n: i, owner: c.owner === "me" ? "the agent" : "the other person",
    contact: c.contact_id ? nameOf[c.contact_id] || null : null,
    title: c.title, quote: c.quote, call_summary: (c.call_id && sumOf[c.call_id] || "").slice(0, 400),
  }));

  const system = [
    "You are cleaning a busy broker's list of promises extracted from his phone calls. He runs his WHOLE LIFE through this list —",
    "family, personal errands, his own accounts and appointments count exactly as much as real-estate work. Never archive",
    "something because it is personal or not about real estate. For EACH item decide whether it",
    "belongs on his list, using these rules — each is a measured cause of cards he dismissed:",
    "- KEEP only if it creates work for him: he will do it, or someone will deliver something to him or his client that he",
    "  may have to chase. A contractor or vendor describing the steps of their own job owes him nothing — archive it.",
    "- Archive if nobody can be named as the person involved.",
    "- Archive anything conditional, anything done during the call, requests he never agreed to, logistics already settled,",
    "  pleasantries, and anything too vague to act on.",
    "For a KEEPER give: person (the real name), title (verb + concrete object + person + property/deal if any; it must make",
    "sense a week later to someone who never heard the call), next_step (what HE should do, in one line — for someone",
    "else's promise that is usually 'Chase <name> on <day> for <thing>'), context (one short line: property, deal or amount).",
    "When unsure whether it is his work, KEEP it — hiding a real task is worse than showing a doubtful one.",
    'Return ONLY JSON: {"items":[{"n":0,"keep":true,"reason":"...","person":"...","title":"...","next_step":"...","context":"..."}]}',
  ].join("\n");

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, system, messages: [{ role: "user", content: JSON.stringify(items) }] }),
  });
  const j = await r.json();
  // Inlined rather than importing _shared/aiUsage so this can be deployed on its
  // own; same row shape, same rates (Sonnet: $3 in, $15 out per million).
  try {
    const u = j?.usage || {};
    await db.from("ai_usage_log").insert({ user_id: cards[0].user_id, fn: "commitment-rejudge", model: MODEL,
      input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0,
      cost_usd: ((u.input_tokens || 0) / 1e6) * 3 + ((u.output_tokens || 0) / 1e6) * 15 });
  } catch (_) {}
  const text = (j?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  const s = text.indexOf("{"), e = text.lastIndexOf("}");
  let verdicts: any[] = [];
  try { verdicts = JSON.parse(text.slice(s, e + 1)).items || []; } catch (_) { return J({ error: "unparseable", head: text.slice(0, 160) }, 502); }

  let kept = 0, archived = 0;
  const reasons: Record<string, number> = {};
  for (const v of verdicts) {
    const c = cards[v?.n];
    if (!c) continue;
    if (v.keep === false) {
      const { error: uErr } = await db.from("commitments").update({ status: "archived", decided_at: new Date().toISOString() }).eq("id", c.id).eq("status", "proposed");
      if (!uErr) {
        archived++;
        const why = String(v.reason || "does not create work for the agent").slice(0, 200);
        reasons[why] = (reasons[why] || 0) + 1;
        await db.from("commitment_events").insert({ commitment_id: c.id, user_id: c.user_id, event: "archived_by_rules", note: "rejudged: " + why });
      }
    } else {
      const patch: Record<string, unknown> = {
        next_step: v.next_step ? String(v.next_step).slice(0, 300) : "Review and decide",
        context: v.context ? String(v.context).slice(0, 300) : null,
      };
      if (v.person) patch.owner_name = String(v.person).slice(0, 120);
      if (v.title && String(v.title).trim().split(/\s+/).length >= 4) patch.title = String(v.title).slice(0, 300);
      const { error: kErr } = await db.from("commitments").update(patch).eq("id", c.id);
      if (!kErr) kept++;
    }
  }
  return J({ ok: true, judged: cards.length, kept, archived, reasons });
});
