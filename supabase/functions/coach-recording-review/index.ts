// John reviews a real appointment recording and coaches the specific stage.
// Computes a talk ratio from speaker-labeled segments, then has Claude coach
// like a mentor who listened to the tape. The Phase D differentiator.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const DISC_DELIVERY: Record<string, string> = {
  D: "Be direct and bottom-line. Lead with the biggest lever.",
  I: "Be warm and encouraging; celebrate the good moments with energy.",
  S: "Be steady and reassuring; frame growth gently.",
  C: "Be precise; show the specific moments and the reasoning.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return J({ error: "Unauthorized" }, 401);
    const uid = user.id;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { recording_id } = await req.json().catch(() => ({}));
    if (!recording_id) return J({ error: "recording_id required" }, 400);

    const { data: rec } = await admin.from("recordings").select("id,title,transcript_text,transcript_segments,duration_seconds,transcription_status").eq("id", recording_id).eq("user_id", uid).maybeSingle();
    if (!rec) return J({ error: "not_found" }, 404);
    if (rec.transcription_status !== "ready" || !rec.transcript_text) return J({ error: "not_ready" }, 400);

    // talk ratio from speaker-labeled segments
    let meWords = 0, otherWords = 0;
    const segs = Array.isArray(rec.transcript_segments) ? rec.transcript_segments : [];
    for (const seg of segs) {
      const w = String(seg.text || "").split(/\s+/).filter(Boolean).length;
      if (String(seg.speaker || "").toLowerCase() === "me") meWords += w; else otherWords += w;
    }
    const total = meWords + otherWords;
    const meRatio = total > 0 ? meWords / total : null;

    const [{ data: settings }, { data: profs }] = await Promise.all([
      admin.from("coach_settings").select("coach_name,style").eq("user_id", uid).maybeSingle(),
      admin.from("profiles").select("primary_letter,baseline_primary,subject_kind").eq("user_id", uid).limit(6),
    ]);
    const coachName = settings?.coach_name || "John";
    const selfProf = (profs || []).find((p: any) => p.subject_kind === "owner") || (profs || [])[0];
    const discKey = String((selfProf?.baseline_primary || selfProf?.primary_letter || "")).charAt(0).toUpperCase();

    const transcript = String(rec.transcript_text).slice(0, 15000);
    const ratioNote = meRatio != null ? `You measured the talk ratio: the agent (labeled "me") spoke about ${Math.round(meRatio * 100)}% of the words. (Great discovery calls are usually agent-talking 30-45%.)` : "";

    const system = `You are ${coachName}, a real estate coach who just listened to a recording of your agent's real appointment/call titled "${rec.title}". ${ratioNote}

Coach this like a sharp, caring mentor who heard the tape. Give it in 4 tight beats:
1. ONE specific thing they did well — reference a real moment from the transcript.
2. The single biggest opportunity — the one stage that leaked: did they uncover the real motivation, talk too much, fail to ask for the business, mishandle an objection, or not set clear next steps?
3. Concrete coaching to fix it, naming a lesson where it fits (e.g. "Talk less, sell more", "Find the why behind the move", "Agree first then handle it", "Anchor then justify", "Manage the deal to the finish line").
4. One thing to do differently next time.

${discKey && DISC_DELIVERY[discKey] ? DISC_DELIVERY[discKey] : "Keep it human."} COMPASSION FIRST — this is about growth, never shame. Be specific to what you actually heard. Concise — a few sentences per beat, no fluff. Talk like a coach texting their agent after listening.`;

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system, messages: [{ role: "user", content: `Here is the transcript. Coach me on it.\n\n${transcript}` }] }),
    });
    const data = await resp.json();
    const reply = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim() || "I listened, but couldn't pull my notes together — try again.";

    await admin.from("coach_checkins").insert({ user_id: uid, kind: "recording_review", role: "coach", content: reply, data: { recording_id, title: rec.title, me_ratio: meRatio } });
    return J({ reply, me_ratio: meRatio, title: rec.title });
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
