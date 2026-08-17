// correspondent-personalize — turns an approved audience into per-person notes.
//
// THE GATE THIS EXISTS TO ENFORCE: a note may go out only if it contains ONE
// verifiably true, specific clause about that person. Not a merge field, not their
// first name, not "as a valued client". If there is no such clause, the recipient
// is downgraded to newsletter_only — they get the published piece with an honest
// covering line and nothing pretending to be personal.
//
// This matters more than the writing. A mass email that SOUNDS personal is worse
// than one that is obviously a newsletter, because the day two recipients compare
// notes the newsletter is fine and the forgery is not. So the clause has to be
// real, and it has to be DIFFERENT per person — two people in one household
// receiving the same "personal" observation is the exact discovery that ends trust.
//
// WHERE THE CLAUSE COMES FROM, in priority order. All of it is already in PrismOS:
//   1. a recorded call with them — what they actually said
//   2. a dated note on their contact record
//   3. a closing anniversary or transaction fact
//   4. a property they own
// If none of those exist, there is no clause. That will be true of most of the
// list, and the honest answer is the newsletter tier, not an invented intimacy.
//
// ON THE BEHAVIOURAL LAYER, HONESTLY: DISC-adapting structure and length is
// defensible — a high-D genuinely does stop reading a long wind-up. DISC-adapting
// WARMTH is mostly cosmetic. So the style map below changes shape, order and
// length only. It does not change how friendly the note is.
//
// verify_jwt: false — called with the agent's JWT and scoped by it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const STYLE: Record<string, string> = {
  D: "Shortest of all. Lead with the single most consequential fact. No wind-up, no pleasantries before the point. One line on why it matters to them. 60-90 words.",
  I: "Warmest opening, conversational rhythm, a little energy. May reference the shared thing by name. 90-130 words.",
  S: "Gentle opening, no urgency, no pressure of any kind. Make clear nothing is being asked of them. 90-130 words.",
  C: "Precise. Name the source of the number in the piece. No adjectives doing the work of evidence. Offer the detail rather than the summary. 90-130 words.",
};

const SYSTEM = `You write one short covering note from a real-estate agent to one person they know, pointing at a piece the agent just published.

WHAT THIS IS: the note is one-to-one. The PIECE is openly a publication and everyone gets the same one — that is fine and honest. The note is the part that is only for this person.

THE ONE RULE THAT MATTERS: you are given ONE true clause about this person. Use it once, naturally, in the first two sentences. Do not embellish it, do not extend it into a paragraph, do not invent a second detail around it. If you find yourself adding colour that was not given to you, stop — that is the forgery this system exists to prevent.

NEVER:
- Never write "I was thinking of you" or "I thought of you when" unless the given clause actually supports it.
- Never claim a conversation, a meeting, or a shared moment that is not in the clause.
- Never imply this note went only to them if you are not certain of that. Do not say "I'm only sending this to a few people".
- Never sell. No listing pitch, no "if you or anyone you know", no offer of a home valuation. This note asks for nothing.
- Never use: leverage, seamless, game-changing, unlock, elevate, curated, "in today's market", "dive into", "reach out", "circle back", "touch base", "just checking in", "hope this finds you well", "wanted to share".
- Never open with "Hope you're doing well" or any variant.

STRUCTURE: greeting with their first name; the true clause used naturally; one sentence on what the piece is and the single most useful thing in it for them; a close that asks nothing. Sign with the agent's first name only. No postscript. No subject line inside the body.

Return ONLY JSON, no fence:
{"subject":"...","body":"..."}
Subject: lower-case or sentence case, under 55 characters, reads like a person wrote it to one person. Never a headline, never title case, no emoji, no "Newsletter", no month name.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return j({ ok: false, error: "not authenticated" }, 401);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: who } = await asUser.auth.getUser();
  const uid = who?.user?.id;
  if (!uid) return j({ ok: false, error: "not authenticated" }, 401);

  const body = await req.json().catch(() => ({}));
  const pieceId = body.piece_id;
  if (!pieceId) return j({ ok: false, error: "piece_id required" });

  const { data: piece } = await asUser.from("correspondent_pieces").select("*").eq("id", pieceId).maybeSingle();
  if (!piece) return j({ ok: false, error: "piece not found" });
  if (piece.status === "sent") return j({ ok: false, error: "already sent" });

  const { data: aud } = await asUser.rpc("correspondent_audience", { p_piece: pieceId });
  // The audience RPC returns `suppressed` (boolean), not a disposition string.
  // I had this wrong first time and it silently produced an empty audience — the
  // function returned ok:true with 0 recipients, which reads as "nothing to do"
  // rather than "I looked at the wrong field".
  const included = (Array.isArray(aud) ? aud : []).filter((a: any) => !a.suppressed);

  const { data: agent } = await asUser.from("agents").select("name").eq("auth_user_id", uid).maybeSingle();
  const agentFirst = String(agent?.name || "").split(" ")[0] || "your agent";

  // Clauses already used on this piece, so no two people get the same one. The
  // household rule is the reason this is tracked across the whole send and not
  // just within a contact.
  const usedClauses = new Set<string>();
  const out: any[] = [];

  for (const a of included.slice(0, 60)) {
    const cid = a.contact_id;

    // ── retrieve the individual layer ───────────────────────────────────────
    let clause: string | null = null, source: string | null = null;

    const { data: recs } = await asUser.from("quo_calls")
      .select("summary,transcript_en,created_at").eq("contact_id", cid)
      .not("summary", "is", null).order("created_at", { ascending: false }).limit(1);
    if (recs && recs.length) {
      const s = typeof recs[0].summary === "string" ? recs[0].summary : JSON.stringify(recs[0].summary);
      if (s && s.length > 30) { clause = s.slice(0, 400); source = "call " + String(recs[0].created_at).slice(0, 10); }
    }
    if (!clause) {
      const { data: notes } = await asUser.from("notes")
        .select("body,created_at,id").eq("user_id", uid).eq("kind", "note")
        .order("created_at", { ascending: false }).limit(40);
      const { data: links } = await asUser.from("entity_links")
        .select("item_id").eq("target_type", "contact").eq("target_id", cid).eq("item_type", "note");
      const ids = new Set((links || []).map((l: any) => l.item_id));
      const hit = (notes || []).find((n: any) => ids.has(n.id) && String(n.body || "").length > 30);
      if (hit) { clause = String(hit.body).slice(0, 400); source = "note " + String(hit.created_at).slice(0, 10); }
    }
    if (!clause) {
      const { data: c } = await asUser.from("contacts")
        .select("notes,home_address,last_transaction_at").eq("id", cid).maybeSingle();
      if (c?.notes && String(c.notes).length > 30) { clause = String(c.notes).slice(0, 400); source = "contact record"; }
      else if (c?.home_address) { clause = "They own " + c.home_address; source = "property on file"; }
    }

    // ── THE GATE ────────────────────────────────────────────────────────────
    if (!clause) {
      await asUser.from("correspondent_sends").upsert({
        piece_id: pieceId, user_id: uid, contact_id: cid, tier: "newsletter",
        status: "newsletter_only", clause_source: null,
        suppressed_reason: "no verifiable specific fact about this person — sending the piece as a newsletter rather than faking a personal note",
      }, { onConflict: "piece_id,contact_id" });
      out.push({ contact_id: cid, name: a.name, tier: "newsletter", reason: "no true clause" });
      continue;
    }

    const disc = String(a.disc || "").toUpperCase().charAt(0);
    const style = STYLE[disc] || STYLE.S;

    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: MODEL, max_tokens: 900, system: SYSTEM,
          messages: [{ role: "user", content:
            `AGENT'S FIRST NAME: ${agentFirst}\n` +
            `RECIPIENT FIRST NAME: ${String(a.name || "").split(" ")[0]}\n` +
            `BEHAVIOURAL STYLE — shape and length only, not warmth: ${style}\n\n` +
            `THE ONE TRUE CLAUSE about this person (source: ${source}). Use it once, do not embellish:\n${clause}\n\n` +
            `THE PIECE — title and the single most useful point:\n${piece.title}\n${piece.dek || ""}\n\n` +
            (usedClauses.size ? `ALREADY USED with someone else on this same send — do NOT reuse this framing:\n- ${[...usedClauses].slice(-6).join("\n- ")}\n` : "") }],
        }),
      });
      const d = await r.json();
      try { await logAiUsage(admin, { userId: uid, fn: "correspondent-personalize", model: MODEL, usage: d?.usage, usedOwn: false }); } catch (_) {}
      if (!r.ok) { out.push({ contact_id: cid, name: a.name, error: d?.error?.message || ("HTTP " + r.status) }); continue; }

      const txt = (d.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
      let p: any = null;
      try { p = JSON.parse(txt.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()); }
      catch (_) { const i = txt.indexOf("{"), z = txt.lastIndexOf("}"); if (i > -1 && z > i) { try { p = JSON.parse(txt.slice(i, z + 1)); } catch (_) {} } }
      if (!p?.body) { out.push({ contact_id: cid, name: a.name, error: "draft shape unexpected" }); continue; }

      usedClauses.add(String(p.body).split(/(?<=\.)\s/)[1] || String(p.body).slice(0, 90));

      await asUser.from("correspondent_sends").upsert({
        piece_id: pieceId, user_id: uid, contact_id: cid, tier: "segment",
        subject: String(p.subject || "").slice(0, 120), body: String(p.body),
        true_clause: clause.slice(0, 300), clause_source: source,
        disc_style: disc || null, status: "drafted",
      }, { onConflict: "piece_id,contact_id" });
      out.push({ contact_id: cid, name: a.name, tier: "segment", subject: p.subject, source });
    } catch (err) {
      out.push({ contact_id: cid, name: a.name, error: String(err) });
    }
  }

  const personal = out.filter((o) => o.tier === "segment").length;
  const news = out.filter((o) => o.tier === "newsletter").length;
  return j({ ok: true, personal, newsletter_only: news, failed: out.filter((o) => o.error).length, results: out });
});
