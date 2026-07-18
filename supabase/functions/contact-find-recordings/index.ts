import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── contact-find-recordings ──────────────────────────────────────────────────
// The mirror of recording-identify. That one asks "who is in THIS recording?";
// this asks "which past recordings feature THIS contact?" — for the moment a
// conversation you had before they mattered suddenly matters.
//
// Two stores, two kinds of evidence:
//   PHONE CALLS (quo_calls): match the contact's phone against the call's
//     from/to number, last 10 digits. This is exact — a phone call already knows
//     who it was with. Any unlinked call that matches is offered for one-tap link.
//   MEETING RECORDINGS (recordings): no number, so the same signals as the
//     identifier — the contact's name spoken in the transcript, and a calendar
//     event overlapping the recording that names them.
//
// Everything is a SUGGESTION. Auto-linking the wrong recording feeds a stranger's
// words into this contact's DISC read, which is worse than leaving it unlinked.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const last10 = (s: string) => String(s || "").replace(/[^0-9]/g, "").slice(-10);
const firstName = (full: string) => String(full || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
const norm = (s: string) => String(s || "").toLowerCase().trim();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { contact_id, user_id } = await req.json();
    if (!contact_id || !user_id) return J({ error: "need contact_id, user_id" }, 400);

    const { data: contact } = await db.from("contacts").select("id,name,phone").eq("id", contact_id).eq("user_id", user_id).maybeSingle();
    if (!contact) return J({ error: "no such contact" }, 404);

    const phone = last10(contact.phone);
    const fname = firstName(contact.name);
    const fullname = norm(contact.name);
    const out: any[] = [];

    // ── Phone calls, matched by number ────────────────────────────────────────
    if (phone) {
      const { data: calls } = await db.from("quo_calls")
        .select("id,from_number,to_number,direction,op_created_at,summary")
        .is("contact_id", null).eq("user_id", user_id).limit(2000);
      for (const c of calls || []) {
        if (last10(c.from_number) === phone || last10(c.to_number) === phone) {
          out.push({
            kind: "call", id: c.id, when: c.op_created_at, confidence: "high",
            why: [`phone number matches ${contact.phone}`],
            preview: c.summary ? String(c.summary).slice(0, 90) : (c.direction || "call"),
          });
        }
      }
    }

    // ── Meeting recordings, matched by spoken name + calendar ─────────────────
    // Only bother if we have a name to look for.
    if (fname.length >= 4 || fullname.length > 4) {
      const { data: recs } = await db.from("recordings")
        .select("id,title,transcript_text,transcript_segments,recorded_at,summary")
        .is("contact_id", null).eq("user_id", user_id).limit(1000);

      // pre-load this contact's calendar events once, to check overlap
      for (const r of recs || []) {
        const text = r.transcript_text ||
          (Array.isArray(r.transcript_segments) ? r.transcript_segments.map((s: any) => s.text || "").join(" ") : "");
        const why: string[] = [];
        let pts = 0;

        // name spoken (word boundary, full name strongest)
        if (text) {
          const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          if (fullname.length > 4 && new RegExp(`\\b${esc(fullname)}\\b`, "i").test(text)) { pts += 3; why.push("full name spoken in the recording"); }
          else if (fname.length >= 4 && new RegExp(`\\b${esc(fname)}\\b`, "i").test(text)) { pts += 2; why.push(`"${fname}" spoken in the recording`); }
        }

        // calendar event that both overlaps this recording AND names the contact
        if (r.recorded_at) {
          const t = new Date(r.recorded_at).getTime();
          const lo = new Date(t - 3 * 3600e3).toISOString();
          const hi = new Date(t + 3 * 3600e3).toISOString();
          const { data: evs } = await db.from("events")
            .select("title,description,attendees,start_at,end_at")
            .eq("user_id", user_id).gte("start_at", lo).lte("start_at", hi)
            .or("all_day.is.null,all_day.eq.false").limit(10);
          for (const e of evs || []) {
            const st = new Date(e.start_at).getTime();
            const en = e.end_at ? new Date(e.end_at).getTime() : st + 3600e3;
            const gap = (t >= st && t <= en) ? 0 : Math.min(Math.abs(t - st), Math.abs(t - en));
            if (gap > 90 * 60e3) continue;
            const blob = `${e.title || ""} ${e.description || ""}`.toLowerCase();
            const inAttendees = (e.attendees || []).some((a: any) => norm(a.name) === fullname);
            if (inAttendees) { pts += 4; why.push(`invited to "${e.title}"`); break; }
            if (fullname.length > 4 && blob.includes(fullname)) { pts += 4; why.push(`named in "${e.title}" (${new Date(e.start_at).toLocaleDateString()})`); break; }
          }
        }

        if (pts > 0) {
          out.push({
            kind: "recording", id: r.id, when: r.recorded_at,
            confidence: pts >= 5 ? "high" : pts >= 3 ? "medium" : "low",
            why, preview: (r.summary || r.title || "").slice(0, 90),
          });
        }
      }
    }

    out.sort((a, b) => (b.confidence === "high" ? 1 : 0) - (a.confidence === "high" ? 1 : 0) || String(b.when).localeCompare(String(a.when)));
    return J({
      contact: { id: contact.id, name: contact.name },
      found: out.length,
      candidates: out.slice(0, 40),
      note: out.length ? "suggestions — confirm before linking" : "no past recordings look like this contact",
    });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e) }, 500);
  }
});
