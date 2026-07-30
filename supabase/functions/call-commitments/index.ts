import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

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

let __lastUsage: any = null;
async function claude(key: string, system: string, user: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`claude ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const j = await r.json();
  __lastUsage = j?.usage || null;
  return (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

// Same promise, said three times across three calls, is ONE commitment.
async function dedupeKey(contactId: string, title: string) {
  const norm = title.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  const buf = new TextEncoder().encode(`${contactId}::${norm}`);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function labelledTranscript(transcript: unknown, map: Record<string, string> | null, them: string, me: string, people?: Record<string, { name?: string; contact_id?: string | null }> | null) {
  const text = typeof transcript === "string" ? transcript : String((transcript as any)?.text || "");
  if (!text) return "";
  return text.split("\n").map((line) => {
    const m = line.match(/^\s*Speaker\s+([A-Z0-9]+)\s*:\s*(.*)$/);
    if (!m) return line;
    const label = m[1];
    const role = map?.[label];
    // A third+ speaker (not me / not the primary contact) is resolved to their
    // identified name via speaker_people, so the model attributes to the right
    // person instead of a bare "Speaker C".
    let who: string;
    if (role === "contact") who = them;
    else if (role === "me") who = me;
    else if (people && people[label] && people[label].name) who = people[label].name!;
    else who = `Speaker ${label}`;
    return `${who}: ${m[2]}`;
  }).join("\n");
}

// Does the transcript actually contain a 3rd+ diarized speaker (beyond A/B)?
function hasExtraSpeakers(transcript: unknown, map: Record<string, string> | null): string[] {
  const text = typeof transcript === "string" ? transcript : String((transcript as any)?.text || "");
  const labels = new Set<string>();
  for (const mm of text.matchAll(/^\s*Speaker\s+([A-Z0-9]+)\s*:/gm)) labels.add(mm[1]);
  // "extra" = a diarized speaker whose role isn't me/contact (or isn't mapped)
  return [...labels].filter((l) => { const r = map?.[l]; return r !== "me" && r !== "contact"; });
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
        const existingPeople = (call.speaker_people && typeof call.speaker_people === "object") ? call.speaker_people : {};
        const extras = hasExtraSpeakers(call.transcript, call.speaker_map);
        const script = labelledTranscript(call.transcript, call.speaker_map, them, "Me", existingPeople);
        if (!script.trim()) { out.push({ id: call.id, skipped: "no transcript" }); continue; }

        // The candidate roster the model can attribute a 3rd-party commitment to:
        // this user's contacts by name (so "Alex will send it" resolves to a real
        // person). Kept small and name-only to stay within budget.
        const { data: roster } = await db.from("contacts")
          .select("id,name").eq("user_id", call.user_id).not("name", "is", null).limit(400);
        const rosterNames = (roster || []).map((r: any) => r.name).filter(Boolean);

        const multiParty = extras.length > 0;
        const sys =
          "Extract real COMMITMENTS from a phone call, and identify any third-party speakers. Strict JSON, no fence:\n" +
          '{ "speakers": [ { "label":"C", "name":"best guess of who this is", "confidence":"high"|"low" } ], ' +
          '"commitments": [ { "owner":"me"|"them"|"other", "owner_name":"who owes it (a speaker name)", "title":"...", "quote":"...", "fuse":"immediate"|"near"|"distant", "due_date":"YYYY-MM-DD"|null, "confidence":"high"|"low" } ] }\n\n' +
          "A commitment is somebody saying they WILL DO a specific thing. Rules:\n" +
          "- QUOTE IT. Copy the actual sentence into `quote`. If you cannot quote it, do not extract it.\n" +
          "- OWNER is whoever said they'd do it, from the speaker labels. `me` = the agent, `them` = the primary contact on the call, `other` = a third party. When `other`, put their spoken name in `owner_name`. Never infer from who benefits.\n" +
          "- SPEAKERS: for any speaker labelled 'Speaker C/D/…' (not already named), guess who they are from context (a name used in the call, a role). Only include speakers you can actually name; low confidence is fine. If none, use an empty list.\n" +
          "- ACTIONABLE only. A verb and an object. Topics, worries, opinions, 'we should look into it', pleasantries and small talk are NOT commitments.\n" +
          "- Default to NO. An empty list is a perfectly good answer, and is the RIGHT answer for most calls. Everything you leave out is still captured in the call summary.\n" +
          "- Do not invent dates. Only set due_date if a date or day was actually said; resolve 'Monday' against the call date.\n" +
          "- confidence low if the wording is vague or you are unsure who said it.\n" +
          (rosterNames.length ? `Known people you may match a name to (use the exact name if it fits): ${rosterNames.slice(0, 200).join(", ")}.\n` : "") +
          "Two or three commitments is a busy call. Ten means you are extracting topics, not promises.";

        const usr = `Call date: ${(call.op_created_at || "").slice(0, 10)}. Speakers are labelled by name.${multiParty ? " This call has THREE OR MORE speakers — attribute each commitment to the correct person." : ""}\n\n${script.slice(0, 14000)}`;
        const raw = await claude(KEY, sys, usr);
        try { await logAiUsage(db, { userId: call?.user_id, fn: "call-commitments", model: MODEL, usage: __lastUsage, usedOwn: false }); } catch (_) {}
        let parsed: any = {};
        try { parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()); } catch { parsed = { commitments: [] }; }
        const list = Array.isArray(parsed.commitments) ? parsed.commitments : [];
        const speakers = Array.isArray(parsed.speakers) ? parsed.speakers : [];

        // Resolve a spoken name → a contact_id, matching against the roster by
        // case-insensitive exact then first-name. Returns {contact_id, name}.
        const norm = (s: string) => String(s || "").trim().toLowerCase();
        const matchContact = (name: string): { contact_id: string | null; name: string } => {
          if (!name) return { contact_id: null, name: "" };
          const exact = (roster || []).find((r: any) => norm(r.name) === norm(name));
          if (exact) return { contact_id: exact.id, name: exact.name };
          const first = norm(name).split(/\s+/)[0];
          const byFirst = (roster || []).filter((r: any) => norm(r.name).split(/\s+/)[0] === first);
          if (byFirst.length === 1) return { contact_id: byFirst[0].id, name: byFirst[0].name };
          return { contact_id: null, name };
        };

        // Persist identified 3rd-party speakers into speaker_people (AI source;
        // a manual correction in the UI later overrides with source:'manual').
        if (speakers.length && multiParty) {
          const people: Record<string, any> = { ...existingPeople };
          for (const s of speakers) {
            if (!s?.label || !s?.name) continue;
            if (people[s.label]?.source === "manual") continue; // never clobber a human correction
            const mc = matchContact(s.name);
            people[s.label] = { name: mc.name || s.name, contact_id: mc.contact_id, source: "ai", confidence: s.confidence === "high" ? "high" : "low" };
          }
          await db.from("quo_calls").update({ speaker_people: people }).eq("id", call.id);
        }

        let kept = 0;
        for (const c of list) {
          // The quote is the receipt. No receipt, no commitment.
          if (!c?.title || !c?.quote || !["me", "them", "other"].includes(c.owner)) continue;
          // Resolve owner → owner_contact_id for third parties.
          let owner = c.owner;
          let owner_contact_id: string | null = null;
          if (owner === "other") {
            const mc = matchContact(c.owner_name || "");
            owner_contact_id = mc.contact_id;
            // If "other" actually resolves to the primary contact, fold to "them".
            if (owner_contact_id && owner_contact_id === call.contact_id) { owner = "them"; owner_contact_id = null; }
            // An unresolvable third party still records as owner='them' with the
            // name in owner_contact_id null — but only if we truly can't place it.
            else if (!owner_contact_id) { owner = "them"; }
          }
          const key = await dedupeKey(call.contact_id || "none", c.title);
          const { error } = await db.from("commitments").upsert({
            user_id: call.user_id,
            contact_id: call.contact_id,
            call_id: call.id,
            interaction_id: call.interaction_id,
            owner,
            owner_contact_id,
            title: String(c.title).slice(0, 300),
            quote: String(c.quote).slice(0, 600),
            fuse: ["immediate","near","distant"].includes(c.fuse) ? c.fuse : "near",
            due_date: /^\d{4}-\d{2}-\d{2}$/.test(c.due_date || "") ? c.due_date : null,
            confidence: c.confidence === "high" ? "high" : "low",
            dedupe_key: key,
            status: "proposed",
          }, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
          if (!error) kept++;
        }
        await db.from("quo_calls").update({ commitments_read_at: new Date().toISOString() }).eq("id", call.id);
        out.push({ id: call.id, who: them, found: list.length, kept, extras: extras.length, named: speakers.length });
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
