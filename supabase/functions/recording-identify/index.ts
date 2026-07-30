import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

// ── recording-identify ───────────────────────────────────────────────────────
// Answers "who was in this recording?" for a face-to-face meeting that carries no
// phone number and no email — only spoken words and a moment in time.
//
// Three independent signals, combined, always SUGGEST rather than auto-link:
//   1. NAMES SPOKEN.   People say each other's names constantly — greetings,
//      goodbyes, "as I told Javier". We pull every candidate name from the
//      transcript and match against the contact list.
//   2. CALENDAR OVERLAP. A recording that runs 2:10–2:55 PM and a calendar event
//      2:00–3:00 PM the same day almost certainly are the same meeting. The
//      event's attendees (from Google) and any names typed into its DESCRIPTION
//      tell us who was there.
//   3. AGREEMENT.      A contact that shows up in BOTH signals is close to
//      certain; one signal alone is a softer suggestion.
//
// Auto-linking the wrong person is worse than linking no one — it would feed a
// stranger's words into that contact's DISC read. So this returns ranked
// candidates with WHY, and a human confirms. Same discipline as call attribution.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "claude-sonnet-4-6";

let __riUsage: any = null;
async function claude(key: string, system: string, user: string, maxTokens = 700) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`claude ${r.status}: ${(await r.text()).slice(0, 140)}`);
  const j = await r.json(); __riUsage = j?.usage || __riUsage;
  return (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

// crude but effective: pull capitalised first-name-like tokens from a transcript
function transcriptText(rec: any): string {
  if (rec.transcript_text) return rec.transcript_text;
  const seg = rec.transcript_segments;
  if (Array.isArray(seg)) return seg.map((s: any) => s.text || s.content || "").join(" ");
  return "";
}

const firstName = (full: string) => String(full || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
const norm = (s: string) => String(s || "").toLowerCase().trim();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const KEY = Deno.env.get("ANTHROPIC_API_KEY");
    const { recording_id, user_id } = await req.json();
    if (!recording_id || !user_id) return J({ error: "need recording_id, user_id" }, 400);

    const { data: rec } = await db.from("recordings").select("*").eq("id", recording_id).eq("user_id", user_id).maybeSingle();
    if (!rec) return J({ error: "no such recording" }, 404);

    const text = transcriptText(rec);
    const when = rec.recorded_at || rec.created_at;

    // the contact list to match against
    const { data: contacts } = await db.from("contacts").select("id,name,email").eq("user_id", user_id).limit(3000);
    const byFirst = new Map<string, any[]>();
    for (const c of contacts || []) {
      const f = firstName(c.name);
      if (!f) continue;
      (byFirst.get(f) || byFirst.set(f, []).get(f))!.push(c);
    }

    const score = new Map<string, { contact: any; points: number; why: string[] }>();
    const add = (c: any, pts: number, why: string) => {
      const e = score.get(c.id) || { contact: c, points: 0, why: [] };
      e.points += pts; e.why.push(why); score.set(c.id, e);
    };

    // ── Signal 1: names spoken in the transcript ──────────────────────────────
    let spokenNames: string[] = [];
    if (text && KEY) {
      try {
        const sys = "From a meeting transcript, list the FIRST NAMES of people who appear to be participants or are addressed directly. " +
          "Return a JSON array of lowercase first names only, e.g. [\"javier\",\"josh\"]. Exclude the narrator's self-references, brands, and places. If none, return [].";
        const raw = await claude(KEY, sys, text.slice(0, 8000), 200);
        try { await logAiUsage(db, { userId: user_id, fn: "recording-identify", model: MODEL, usage: __riUsage, usedOwn: false }); } catch (_) {}
        spokenNames = JSON.parse(raw.replace(/```json|```/g, "").trim());
        if (!Array.isArray(spokenNames)) spokenNames = [];
      } catch { spokenNames = []; }
    }
    for (const nm of spokenNames) {
      if (norm(nm).length < 4) continue;   // "bj", "zane" ok; skip 1-3 char noise
      const hits = byFirst.get(norm(nm)) || [];
      // a spoken name that matches exactly one contact is a strong hit; if it
      // matches several (three "Mike"s) it's weak until the calendar disambiguates
      const pts = hits.length === 1 ? 3 : hits.length > 1 ? 1 : 0;
      for (const c of hits) add(c, pts, `said "${nm}" in the recording`);
    }

    // ── Signal 2: a calendar event overlapping the recording's time ───────────
    let matchedEvent: any = null;
    if (when) {
      const t = new Date(when).getTime();
      // events that started within 3h of the recording — a meeting recorded live
      const lo = new Date(t - 3 * 3600e3).toISOString();
      const hi = new Date(t + 3 * 3600e3).toISOString();
      const { data: evs } = await db.from("events").select("id,title,description,attendees,start_at,end_at,all_day")
        .eq("user_id", user_id).gte("start_at", lo).lte("start_at", hi)
        .or("all_day.is.null,all_day.eq.false")   // a birthday is not a meeting you record
        .limit(20);
      // pick the event whose window best contains the recording time
      let best: any = null, bestGap = Infinity;
      for (const e of evs || []) {
        const st = new Date(e.start_at).getTime();
        const en = e.end_at ? new Date(e.end_at).getTime() : st + 3600e3;
        const gap = (t >= st && t <= en) ? 0 : Math.min(Math.abs(t - st), Math.abs(t - en));
        if (gap < bestGap) { bestGap = gap; best = e; }
      }
      if (best && bestGap < 90 * 60e3) {   // within 90 min counts as "this meeting"
        matchedEvent = best;
        // 2a. structured Google attendees
        for (const a of (best.attendees || [])) {
          const c = (contacts || []).find((x) => x.email && norm(x.email) === norm(a.email));
          if (c) add(c, 4, `was invited to "${best.title}"`);
        }
        // 2b. names typed into the DESCRIPTION (Dara does this by hand) + the title
        const blob = `${best.title || ""} ${best.description || ""}`;
        const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        for (const c of (contacts || [])) {
          const nm = norm(c.name);
          const fn = firstName(c.name);
          // full name, on word boundaries — "Javier Suarez" yes, fragment of "T. Blahut" no
          if (nm.length > 4 && new RegExp(`\\b${esc(nm)}\\b`, "i").test(blob)) add(c, 4, `named in the "${best.title}" event`);
          // first name alone only counts if it's substantial (>=4 chars), so "BJ"/"Al"/"T" don't fire
          else if (fn.length >= 4 && new RegExp(`\\b${esc(fn)}\\b`, "i").test(blob)) add(c, 2, `mentioned in the "${best.title}" event`);
        }
      }
    }

    // ── combine, rank, explain ────────────────────────────────────────────────
    const ranked = [...score.values()]
      .map((e) => ({
        contact_id: e.contact.id,
        name: e.contact.name,
        confidence: e.points >= 5 ? "high" : e.points >= 3 ? "medium" : "low",
        points: e.points,
        why: [...new Set(e.why)],
      }))
      .sort((a, b) => b.points - a.points)
      .slice(0, 8);

    return J({
      recording_id,
      recorded_at: when,
      matched_event: matchedEvent ? { title: matchedEvent.title, start_at: matchedEvent.start_at } : null,
      spoken_names: spokenNames,
      candidates: ranked,
      note: ranked.length ? "suggestions only — confirm before linking" : "no identifying signal found in this recording",
    });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e) }, 500);
  }
});
