import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

// ── call-enrich ──────────────────────────────────────────────────────────────
// A call arrives from Cube ACR as a wall of "Speaker A: / Speaker B:" and gets
// dumped whole into the contact's timeline. Three things are wrong with that:
// the timeline should carry a SUMMARY, the transcript should be one tap away
// rather than in your face, and "Speaker A" is not a person.
//
// The caller ID is sitting in the recorded filename all along:
//   "Tom Mikula (+1 727-862-4395) ↙ (phone) 2026-07-17 14-23-18.amr"
// so we always know WHO the other party is, and the arrow says which way the
// call went. What the filename cannot tell us is which VOICE the diarizer chose
// to call "A" — so that single bit is inferred here, stored, and made flippable
// in one tap. Attribution is a claim about who said what; a confident wrong name
// on a quote is worse than an honest "Speaker A".

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "claude-sonnet-4-6";

// Cube ACR writes the direction as an arrow glyph. cube-acr-sync hard-coded
// every call as "inbound", so outbound calls have been silently mislabelled.
// ↙ / ← incoming · ↗ / → outgoing
const INBOUND_GLYPHS = ["↙", "←", "⬅"];
const OUTBOUND_GLYPHS = ["↗", "→", "➡"];

function parseFileName(name: string) {
  const phoneMatch = (name.match(/\+?\d[\d\s().-]{6,}\d/g) || [])
    .map((s) => s.replace(/[^\d]/g, ""))
    .filter((d) => d.length >= 7)
    .sort((a, b) => b.length - a.length)[0] || null;
  // the display name Cube ACR took from the phone's own address book
  const nameMatch = (name.split("(")[0] || "").trim() || null;
  let direction: "inbound" | "outbound" | null = null;
  if (INBOUND_GLYPHS.some((g) => name.includes(g))) direction = "inbound";
  else if (OUTBOUND_GLYPHS.some((g) => name.includes(g))) direction = "outbound";
  return { phone: phoneMatch, name: nameMatch, direction };
}

const last10 = (s: string) => (s || "").replace(/[^\d]/g, "").slice(-10);

function transcriptText(t: unknown): string {
  if (typeof t === "string") return t;
  if (t && typeof t === "object") {
    const o = t as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    const d = (o.dialogue || o.utterances || o.segments) as unknown[];
    if (Array.isArray(d)) {
      return d.map((s) => {
        const x = s as Record<string, unknown>;
        return `Speaker ${x.speaker ?? "?"}: ${x.text ?? ""}`;
      }).join("\n");
    }
  }
  return "";
}

let __lastUsage: any = null;
async function claude(key: string, system: string, user: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 900, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`claude ${r.status}: ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  __lastUsage = j?.usage || null;
  return (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!KEY) return J({ error: "no ANTHROPIC_API_KEY" }, 500);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 15, 40);

    // deno check trips TS2589 ("type instantiation excessively deep") when a
    // supabase-js query builder is reassigned — a known typing quirk, harmless at
    // runtime. Building each branch separately keeps the checker green without
    // casting the whole client to any and losing the rest of the types.
    const { data: calls, error } = body.call_id
      ? await db.from("quo_calls").select("*").eq("id", body.call_id).limit(1)
      : await db.from("quo_calls").select("*")
          .is("enriched_at", null).not("transcript", "is", null)
          .order("op_created_at", { ascending: false }).limit(limit);
    if (error) return J({ error: error.message }, 500);
    if (!calls?.length) return J({ done: 0, note: "nothing to enrich" });

    const out: unknown[] = [];
    for (const call of calls) {
      try {
        const text = transcriptText(call.transcript);
        if (!text.trim()) { await db.from("quo_calls").update({ enriched_at: new Date().toISOString() }).eq("id", call.id); continue; }

        const fileName = call?.raw?.cube?.file_name || "";
        const meta = parseFileName(fileName);

        // ── Caller ID -> who the other party is ─────────────────────────────
        // Match on the last 10 digits so +1 727-862-4395 and 7278624395 are the
        // same person. Trust the row's contact_id first; fall back to the number.
        let contact: any = null;
        if (call.contact_id) {
          const { data } = await db.from("contacts").select("id,name,phone").eq("id", call.contact_id).maybeSingle();
          contact = data;
        }
        if (!contact && (meta.phone || call.participant)) {
          const want = last10(meta.phone || call.participant);
          const { data: cs } = await db.from("contacts").select("id,name,phone").eq("user_id", call.user_id).limit(2000);
          contact = (cs || []).find((c: any) => last10(c.phone || "") === want) || null;
        }

        const { data: prof } = await db.from("profiles").select("display_name").eq("user_id", call.user_id).maybeSingle();
        const meName = prof?.display_name || "You";
        const otherName = contact?.name || meta.name || "the caller";
        const direction = meta.direction || call.direction || "inbound";

        const sys =
          "You summarise a recorded phone call for the person who was on it. Reply with STRICT JSON only, no markdown fence.\n" +
          '{ "summary": "...", "speaker_map": {"A":"contact"|"me"|"other","B":"contact"|"me"|"other"}, "speaker_people": {"C":{"name":"who this third speaker is"}}, "confidence": "high"|"low" }\n' +
          "summary: 2-3 plain sentences on what was actually said and decided. Write it for the person who was there — no throat-clearing, no 'the call began with'. If a decision, number, date or commitment was made, it belongs in the summary.\n" +
          "speaker_map: for EACH diarizer label present (A, B, C, D, …), decide its role: `me` = the person whose phone recorded this call, `contact` = the primary other party, `other` = an ADDITIONAL third person. EXACTLY ONE speaker is `me` (the phone owner — they are on almost every call). Most calls are just two people (`me` + `contact`). Only use `other` for a genuine additional voice, and never label ALL speakers `other` — the phone owner is always one of them. Note the phone owner may be addressed by a nickname or role (e.g. a family member calling them 'Dad').\n" +
          "speaker_people: ONLY for labels you marked `other` — give your best guess of who that third person is by name, from the content (names used, roles). Omit any you cannot name. If there are no third parties, use an empty object {}.\n" +
          "Use the content: who called whom, who is asking vs answering, who owns the problem, names used. Set confidence low if it is genuinely ambiguous — a wrong attribution is worse than an admitted guess.";

        const usr =
          `This is a ${direction} call ${direction === "inbound" ? "from" : "to"} ${otherName}` +
          `${contact?.phone ? ` (${contact.phone})` : ""}. The phone belongs to ${meName}.\n` +
          `${direction === "inbound" ? `${otherName} placed the call.` : `${meName} placed the call.`}\n\n` +
          `Transcript:\n${text.slice(0, 14000)}`;

        const raw = await claude(KEY, sys, usr);
        try { await logAiUsage(db, { userId: call?.user_id, fn: "call-enrich", model: MODEL, usage: __lastUsage, usedOwn: false }); } catch (_) {}
        let parsed: any = {};
        try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch { parsed = {}; }

        let map = parsed.speaker_map && parsed.speaker_map.A ? parsed.speaker_map : null;
        // Invariant: the phone owner is on the call, so exactly-one 'me' should
        // exist. If the model labelled NO speaker 'me' (over-applying 'other'),
        // the map is untrustworthy for attribution — drop it rather than store a
        // map where the owner disappeared (which would mis-route every commitment).
        if (map && !Object.values(map).includes("me")) map = null;
        const summary = (parsed.summary || "").trim() || null;
        // Match any AI-named third parties to a contact by name (best-effort), and
        // never clobber a human correction (source:'manual') already on the row.
        let speakerPeople: Record<string, any> | null = null;
        const sp = parsed.speaker_people;
        if (sp && typeof sp === "object" && Object.keys(sp).length) {
          const { data: cs2 } = await db.from("contacts").select("id,name").eq("user_id", call.user_id).not("name", "is", null).limit(1000);
          const norm = (s: string) => String(s || "").trim().toLowerCase();
          const existing = (call.speaker_people && typeof call.speaker_people === "object") ? call.speaker_people : {};
          speakerPeople = { ...existing };
          for (const [label, val] of Object.entries(sp)) {
            if ((existing as any)[label]?.source === "manual") continue;
            const name = String((val as any)?.name || "").trim();
            if (!name) continue;
            const exact = (cs2 || []).find((c: any) => norm(c.name) === norm(name));
            const first = norm(name).split(/\s+/)[0];
            const byFirst = (cs2 || []).filter((c: any) => norm(c.name).split(/\s+/)[0] === first);
            const cid2 = exact ? exact.id : (byFirst.length === 1 ? byFirst[0].id : null);
            speakerPeople[label] = { name: exact ? exact.name : (byFirst.length === 1 ? byFirst[0].name : name), contact_id: cid2, source: "ai" };
          }
        }

        await db.from("quo_calls").update({
          summary,
          speaker_map: map,
          ...(speakerPeople ? { speaker_people: speakerPeople } : {}),
          direction,
          enriched_at: new Date().toISOString(),
        }).eq("id", call.id);

        // The timeline should carry the SUMMARY. The transcript stays on the call
        // row, one tap away — it was never deleted, just moved off the front page.
        if (call.interaction_id && summary) {
          const mins = Math.round((call.duration || 0) / 60);
          await db.from("contact_interactions").update({
            brief: `Call (${mins}m) — ${summary.slice(0, 120)}`,
            body: summary,
          }).eq("id", call.interaction_id);
        }

        out.push({ id: call.id, who: otherName, direction, map, confidence: parsed.confidence, summary: (summary || "").slice(0, 70) });
      } catch (e) {
        await db.from("quo_calls").update({ enriched_at: new Date().toISOString() }).eq("id", call.id);
        out.push({ id: call.id, error: String((e as Error)?.message || e).slice(0, 120) });
      }
    }
    return J({ done: out.length, results: out });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e) }, 500);
  }
});
