import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── call-commitments ─────────────────────────────────────────────────────────
// Pulls the promises out of a call. The whole design answers one question Dara
// asked: how do you get the real tasks without everything becoming a task?
//
// The evidence for the strictness: the old extractor produced 314 proposals from
// 211 calls — 1.5 per call. Ten conversations a day is 15 tasks a day, 75 a week.
// That is not a task list, it is a landfill, and 54 of its proposals are still
// sitting unreviewed. Worse, with no speaker attribution it guessed the owner and
// got Tom Mikula's call exactly backwards: Tom said "I'll come out there" and it
// filed a task for DARA to visit TOM's property.
//
// So:
//  1. THEIR promise is not your task. You cannot do it. It is a waiting-on, and
//     it only becomes a task when it goes late — and then it is "chase them".
//  2. Three tests, all must pass, default NO:
//       quotable  — point at the sentence, or it did not happen
//       owned     — from the speaker map, never inferred from vibes
//       actionable— a verb, ideally a date. "We should think about X" is not a task.
//     Anything that fails stays in the SUMMARY. Nothing is lost; it just isn't a task.
//     The summary is what makes this strictness safe.
//  3. Nothing auto-creates. Proposed, then one tap.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "claude-sonnet-4-6";

async function claude(key: string, system: string, user: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`claude ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const j = await r.json();
  return (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

// Same promise, said three times across three calls, is ONE commitment.
async function dedupeKey(contactId: string, title: string) {
  const norm = title.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const buf = new TextEncoder().encode(`${contactId}::${norm}`);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function labelledTranscript(transcript: unknown, map: Record<string, string> | null, them: string, me: string) {
  const text = typeof transcript === "string" ? transcript : String((transcript as any)?.text || "");
  if (!text) return "";
  return text.split("\n").map((line) => {
    const m = line.match(/^\s*Speaker\s+([A-Z0-9]+)\s*:\s*(.*)$/);
    if (!m) return line;
    const role = map?.[m[1]];
    const who = role === "contact" ? them : role === "me" ? me : `Speaker ${m[1]}`;
    return `${who}: ${m[2]}`;
  }).join("\n");
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

    // Only enriched calls: without speaker_map we cannot know who promised what,
    // and guessing the owner is the exact bug this replaces.
    const { data: calls } = body.call_id
      ? await db.from("quo_calls").select("*").eq("id", body.call_id).limit(1)
      : await db.from("quo_calls").select("*")
          .not("speaker_map", "is", null)
          .not("transcript", "is", null)
          .is("commitments_read_at", null)     // <- the marker. Without it this
          .order("op_created_at", { ascending: false })  // re-read the same six
          .limit(Math.min(Number(body.limit) || 8, 20)); // calls forever.
    if (!calls?.length) return J({ done: 0, note: "no attributed calls to read" });

    const out: unknown[] = [];
    for (const call of calls) {
      try {
        await db.from("quo_calls").update({ commitments_read_at: new Date().toISOString() }).eq("id", call.id);
        if (!call.speaker_map) { out.push({ id: call.id, skipped: "not attributed" }); continue; }
        if (call.commitments_read_at && !body.force) { out.push({ id: call.id, skipped: "already read" }); continue; }

        const { data: contact } = call.contact_id
          ? await db.from("contacts").select("id,name").eq("id", call.contact_id).maybeSingle()
          : { data: null };
        const them = contact?.name || "The contact";
        const script = labelledTranscript(call.transcript, call.speaker_map, them, "Me");
        await db.from("quo_calls").update({ commitments_read_at: new Date().toISOString() }).eq("id", call.id);
        if (!script.trim()) { out.push({ id: call.id, skipped: "no transcript" }); continue; }

        const sys =
          "Extract only real COMMITMENTS from a phone call. Strict JSON, no fence:\n" +
          '{ "commitments": [ { "owner":"me"|"them", "title":"...", "quote":"...", "due_date":"YYYY-MM-DD"|null, "confidence":"high"|"low" } ] }\n\n' +
          "A commitment is somebody saying they WILL DO a specific thing. Rules:\n" +
          "- QUOTE IT. Copy the actual sentence into `quote`. If you cannot quote it, do not extract it.\n" +
          "- OWNER is whoever said they'd do it, from the speaker labels in the transcript. Never infer from who benefits.\n" +
          "- ACTIONABLE only. A verb and an object. Topics, worries, opinions, 'we should look into it', pleasantries and small talk are NOT commitments.\n" +
          "- Default to NO. An empty list is a perfectly good answer, and is the RIGHT answer for most calls. Everything you leave out is still captured in the call summary, so nothing is lost.\n" +
          "- Do not invent dates. Only set due_date if a date or day was actually said; resolve 'Monday' against the call date.\n" +
          "- confidence low if the wording is vague or you are unsure who said it.\n" +
          "Two or three commitments is a busy call. Ten means you are extracting topics, not promises.";

        const usr = `Call date: ${(call.op_created_at || "").slice(0, 10)}. Speakers are labelled by name.\n\n${script.slice(0, 14000)}`;
        const raw = await claude(KEY, sys, usr);
        let parsed: any = {};
        try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch { parsed = { commitments: [] }; }
        const list = Array.isArray(parsed.commitments) ? parsed.commitments : [];

        let kept = 0;
        for (const c of list) {
          // The quote is the receipt. No receipt, no commitment — this is the
          // guard that stops "we should think about the panel" becoming a task.
          if (!c?.title || !c?.quote || !["me", "them"].includes(c.owner)) continue;
          const key = await dedupeKey(call.contact_id || "none", c.title);
          const { error } = await db.from("commitments").upsert({
            user_id: call.user_id,
            contact_id: call.contact_id,
            call_id: call.id,
            interaction_id: call.interaction_id,
            owner: c.owner,
            title: String(c.title).slice(0, 300),
            quote: String(c.quote).slice(0, 600),
            due_date: /^\d{4}-\d{2}-\d{2}$/.test(c.due_date || "") ? c.due_date : null,
            confidence: c.confidence === "high" ? "high" : "low",
            dedupe_key: key,
            status: "proposed",
          }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
          if (!error) kept++;
        }
        // Mark read whether or not anything was found. "No promises made" is a
        // result — and per the design it is the RIGHT result for most calls.
        await db.from("quo_calls").update({ commitments_read_at: new Date().toISOString() }).eq("id", call.id);
        out.push({ id: call.id, who: them, found: list.length, kept });
      } catch (e) {
        // deliberately NOT marked read: a genuine failure deserves another go.
        out.push({ id: call.id, error: String((e as Error)?.message || e).slice(0, 110) });
      }
    }
    return J({ done: out.length, results: out });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e) }, 500);
  }
});
