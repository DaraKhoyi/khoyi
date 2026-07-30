// recording-process — gives Cube ACR recordings the same treatment Quo calls get:
// reads transcribed recordings, generates a call summary + action items (Claude),
// writes a contact timeline entry (contact_interactions, channel 'call'), and stores
// proposed_tasks (review_status='pending') for the user to approve. Idempotent via processed_at.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODELS = ["claude-sonnet-4-6", "claude-3-5-sonnet-20241022"];
function estToday(){ return new Date(Date.now()-4*3600e3).toISOString().slice(0,10); }
function toText(v: any): string { if (!v) return ""; if (typeof v === "string") return v; if (Array.isArray(v)) return v.join("\n"); if (typeof v === "object") return JSON.stringify(v); return String(v); }

const SYSTEM = `You process a phone call transcript for a real estate professional, referred to below as the ACCOUNT OWNER ("me"). Output STRICT JSON only — no prose, no markdown.
Shape:
{ "call_summary": "a tight 2-4 sentence summary: what the call was about, the key points or advice discussed, and where it landed",
  "key_points": [ "a concise, substantive point, decision, or piece of advice worth remembering later" ],
  "non_english": true if the transcript contains ANY non-English speech (e.g. Farsi or Spanish), otherwise false,
  "labels_inverted": true if the "Me:"/"Them:" labels are backwards (see the ATTRIBUTION rule), otherwise false,
  "attribution_confidence": "high" | "low",
  "action_items": [ { "owner": "me" | "them" | "other", "owner_name": "if other, the third person's name", "title": "short imperative task", "fuse": "immediate" | "near" | "distant", "due_date": "YYYY-MM-DD or null", "priority": "high" | "medium" | "low", "note": "brief context, optional" } ] }
Rules:
- call_summary + key_points carry the SUBSTANCE of the call (context, advice, decisions). This is where information is preserved, NOT in tasks. Be useful but concise: up to 5 key_points, fewer if the call was simple; return "key_points": [] if there is nothing beyond the summary.
- action_items are ONLY concrete, real next steps someone actually committed to, each with a clear deliverable. BE STRICT: exclude vague intentions ("we should catch up sometime"), hypotheticals, general discussion, pleasantries, and anything already done during the call. If something is context or advice rather than a discrete to-do, keep it in key_points and do NOT make it a task. When in doubt, leave it out. Return at most 5 action_items; if nothing was truly committed, return [].
- ATTRIBUTION — READ THIS BEFORE ASSIGNING ANY OWNER. The "Me:"/"Them:" labels were NOT produced by identifying anyone. They come from a positional guess about who spoke first, which is frequently WRONG — and when it is wrong, every label in the transcript is backwards. Do not trust them. Work out from the CONTENT who the account owner actually is: who introduces themselves by the owner's name, who is providing the real-estate service versus receiving it, who is being asked for information about listings, showings, contracts or commissions. If the content shows the labels are backwards, set "labels_inverted": true and assign owners according to the TRUE speaker, not the label. If you cannot tell who is who, set "attribution_confidence":"low".
- "owner":"me" = something the ACCOUNT OWNER agreed to do. "owner":"them" = the primary other person's commitment. "owner":"other" = a THIRD person on the call (meetings often have 3+ people) — put their name in "owner_name". The owner should track/expect all of them. Include all.
- Resolve relative dates to an absolute YYYY-MM-DD using the provided current date; else null.
- Keep titles short and actionable. Do not invent commitments that were not discussed.
- "fuse" classifies HOW SOON the promise comes due, which decides whether it is worth queuing at all:
    "immediate" = due within a few hours, usually inside the same conversation window
                  ("I'll call you right back", "be there in 20 minutes", "text you shortly").
                  These are almost always already handled by the time anyone reviews them.
    "near"      = a real future window with a deliverable: today, tomorrow, a named day,
                  "by Friday", "this week", "before the closing".
    "distant"   = far off or conditional: "follow up in 6 months", "if I don't hear back",
                  "when you're ready", "sometime".
  Measured on 199 real commitments: 91% of "immediate" ones were thrown away as stale,
  because review happens ~23 hours after the call. Classify honestly — do NOT inflate an
  immediate promise into "near" to make it look important.
LANGUAGE:
- The transcript may contain more than one language (the speaker code-switches, e.g. English with Farsi, or English with Spanish). Write ALL of your output — call_summary, every action item title, and every note — in clear, natural English, translating from the other language(s) as needed. Never leave non-English text in the summary or tasks.
PRONOUNS (get these exactly right in the summary and notes):
- Dara is male — always refer to Dara with he/him/his.
- NEVER infer anyone's gender from voice, pitch, tone, or first name.
- For other people, use only the pronouns given under "Known participants" below. If a person's pronouns are not listed there, use they/them — never guess.`;

let __recUsage: any = null;
// Accumulate usage across BOTH Claude calls in this function (extraction AND
// translation) — a recording that needs translating makes two billable calls.
// Overwriting would have logged only the last one and lost the other's cost.
function __recAcc(u: any) {
  if (!u) return;
  if (!__recUsage) __recUsage = { input_tokens: 0, output_tokens: 0, server_tool_use: { web_search_requests: 0 } };
  __recUsage.input_tokens += u.input_tokens || 0;
  __recUsage.output_tokens += u.output_tokens || 0;
  __recUsage.server_tool_use.web_search_requests += (u.server_tool_use?.web_search_requests || 0);
}
async function callClaude(transcript: string, participants: string): Promise<any> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  let lastErr = "";
  for (const model of MODELS) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model, max_tokens: 1200, system: SYSTEM, messages: [{ role: "user", content: `Current date: ${estToday()}.${participants ? "\n\n" + participants : ""}\n\nTranscript:\n${transcript.slice(0, 14000)}` }] }) });
      if (!r.ok) { lastErr = `${model}: ${r.status}`; continue; }
      const data = await r.json(); __recAcc(data?.usage);
      const txt = (data.content || []).map((c: any) => c.text || "").join("").trim();
      if (txt) { const m = txt.match(/\{[\s\S]*\}/); return JSON.parse(m ? m[0] : txt); }
    } catch (e) { lastErr = `${model}: ${e}`; }
  }
  throw new Error(lastErr || "Claude failed");
}

async function translateToEnglish(transcript: string): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const SYS = "Translate this call transcript into clear, natural English. Preserve the speaker labels (e.g. 'Dara:', 'Maria:') and the line breaks exactly. Lines already in English stay unchanged. Output ONLY the translated transcript — no preamble, no notes.";
  for (const model of MODELS) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model, max_tokens: 4000, system: SYS, messages: [{ role: "user", content: transcript.slice(0, 14000) }] }) });
      if (!r.ok) continue;
      const data = await r.json(); __recAcc(data?.usage);
      const txt = (data.content || []).map((c: any) => c.text || "").join("").trim();
      if (txt) return txt;
    } catch (_) {}
  }
  return "";
}

// Who is "me" for THIS recording. Never hardcode a person into a multi-user
// function. Falls back to a neutral label rather than to somebody else's name.
async function ownerIdentity(admin: any, userId: string): Promise<{ name: string; pronouns: string }> {
  try {
    // Pronouns live on the AGENT row — the account owner's own record. Reading
    // them off a contact row was wrong: most owners have no contact record of
    // themselves, so the lookup fell through to "unknown" and the model was left
    // to infer gender from a voice. That is precisely how people get mis-gendered
    // in their own call summaries.
    const { data: a } = await admin.from("agents")
      .select("name,email,pronouns").eq("auth_user_id", userId).maybeSingle();
    const name = a?.name || "The account owner";
    let pronouns = a?.pronouns || null;
    if (!pronouns && a?.email) {
      const { data: c } = await admin.from("contacts")
        .select("pronouns").eq("email", a.email).not("pronouns", "is", null).maybeSingle();
      if (c?.pronouns) pronouns = c.pronouns;
    }
    return { name, pronouns: pronouns || "they/them (pronouns unknown — do not guess, never infer from voice)" };
  } catch (_) {
    return { name: "The account owner", pronouns: "they/them (pronouns unknown — do not guess)" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const internalTok = req.headers.get("x-internal-token") || "";
    const INTERNAL = Deno.env.get("QCP_TOKEN") || "";
    let scopedUser: string | null = null;
    if (!(INTERNAL && internalTok === INTERNAL)) {
      if (!token) return J({ error: "Not authenticated" }, 401);
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return J({ error: "Not authenticated" }, 401);
      scopedUser = user.id;
    }
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 20, 40);

    let q = admin.from("recordings").select("*").is("processed_at", null).not("transcript_text", "is", null).in("transcription_status", ["ready", "done", "completed"]).order("recorded_at", { ascending: false, nullsFirst: false }).limit(limit);
    if (body.recording_id) q = admin.from("recordings").select("*").eq("id", body.recording_id).limit(1);
    if (scopedUser) q = q.eq("user_id", scopedUser);
    else if (body.user_id) q = q.eq("user_id", body.user_id);
    const { data: recs, error: recErr } = await q;
    if (recErr) throw recErr;

    let processed = 0, timelined = 0, actions = 0;
    for (const rec of (recs || [])) {
      const transcript = toText(rec.transcript_text);
      if (!transcript.trim()) { await admin.from("recordings").update({ processed_at: new Date().toISOString() }).eq("id", rec.id); continue; }

      // MULTI-USER: this function runs for every agent's recordings, so the
      // account owner must be looked up, never hardcoded. Pronouns come from the
      // roster where known; where unknown we say so, because guessing gender from
      // a voice or a name is exactly how people get mis-gendered in summaries.
      const owner = await ownerIdentity(admin, rec.user_id);
      let participants = `Known participants and their pronouns (use these exactly):\n- ${owner.name} — ${owner.pronouns} (this is "me", the account owner)`;
      if (rec.contact_id) {
        const { data: pc } = await admin.from("contacts").select("name, pronouns").eq("id", rec.contact_id).maybeSingle();
        if (pc?.name) participants += `\n- ${pc.name} — ${pc.pronouns ? pc.pronouns : "they/them (pronouns unknown — do not guess)"} (likely "them")`;
      }
      let plan: any = { call_summary: "", action_items: [] };
      __recUsage = null;
      try { plan = await callClaude(transcript, participants); } catch (_) { continue; } // leave unprocessed to retry next run
      try { await logAiUsage(admin, { userId: rec?.user_id, fn: "recording-process", model: MODELS[0], usage: __recUsage, usedOwn: false }); } catch (_) {}

      // The transcript's Me/Them labels are a positional guess (first_speaker
      // defaults to "me"), so a call the other person opened comes through
      // entirely backwards. If the model could tell from content that the labels
      // are inverted, honour that over the label.
      if (plan && plan.labels_inverted === true && Array.isArray(plan.action_items)) {
        plan.action_items = plan.action_items.map((a: any) =>
          ({ ...a, owner: a?.owner === "me" ? "them" : a?.owner === "them" ? "me" : a?.owner }));
      }
      let transcriptEn: string | null = null;
      if (plan.non_english) { try { const t = await translateToEnglish(transcript); if (t) transcriptEn = t; } catch (_) {} }
      const summary = String(plan.call_summary || "").trim();
      const keyPoints = (Array.isArray(plan.key_points) ? plan.key_points : []).map((k: any) => String(k || "").trim()).filter(Boolean).slice(0, 6);
      const items = (Array.isArray(plan.action_items) ? plan.action_items : []).slice(0, 5);

      const occurredAt = rec.recorded_at || rec.created_at || new Date().toISOString();
      const durMin = rec.duration_seconds ? Math.max(1, Math.round(rec.duration_seconds / 60)) : null;

      // timeline entry (only if linked to a contact + not already created)
      let interactionId = rec.interaction_id || null;
      if (rec.contact_id && !interactionId) {
        const briefLine = (summary || transcript).split("\n").map((s) => s.trim()).filter(Boolean)[0]?.slice(0, 180) || "Recorded call";
        const bodyText = [summary, keyPoints.length ? keyPoints.map((k) => "• " + k).join("\n") : ""].filter(Boolean).join("\n\n") || "Recorded call — see full recording.";
        const { data: ins } = await admin.from("contact_interactions").insert({
          user_id: rec.user_id, contact_id: rec.contact_id, channel: "call", direction: "inbound",
          kind: "call", occurred_at: occurredAt, duration_minutes: durMin,
          brief: `Call (${durMin ? durMin + "m" : "recorded"}) — ${briefLine}`, body: bodyText,
          entity_type: "recording", entity_id: rec.id,
        }).select("id").single();
        interactionId = ins?.id || null;
        if (interactionId) timelined++;
      }

      const lowAttr = plan?.attribution_confidence === "low";
      // For any 3rd-party ("other") action item, resolve the spoken name to a
      // contact so it attributes to the specific person (and can be delegated).
      const { data: rosterC } = await admin.from("contacts").select("id,name").eq("user_id", rec.user_id).not("name", "is", null).limit(1000);
      const normN = (s: string) => String(s || "").trim().toLowerCase();
      const resolveName = (name: string): string | null => {
        if (!name) return null;
        const exact = (rosterC || []).find((c: any) => normN(c.name) === normN(name));
        if (exact) return exact.id;
        const first = normN(name).split(/\s+/)[0];
        const byFirst = (rosterC || []).filter((c: any) => normN(c.name).split(/\s+/)[0] === first);
        return byFirst.length === 1 ? byFirst[0].id : null;
      };
      const proposed = items.map((a: any) => {
        let owner = a.owner === "them" ? "them" : a.owner === "other" ? "other" : "me";
        let owner_contact_id: string | null = null;
        if (owner === "other") {
          owner_contact_id = resolveName(a.owner_name || "");
          if (owner_contact_id && owner_contact_id === rec.contact_id) { owner = "them"; owner_contact_id = null; }
          else if (!owner_contact_id) { owner = "them"; }  // unresolvable → track as the counterparty's
        }
        return { title: String(a.title || "").slice(0, 200), owner, owner_contact_id,
          // Surfaced in review as "unsure" so a shaky attribution is visible rather
          // than silently wrong — the reviewer can flip it in one tap.
          attribution_confidence: lowAttr ? "low" : "high", due_date: a.due_date || null, priority: ["high", "medium", "low"].includes(a.priority) ? a.priority : "medium", note: String(a.note || "").slice(0, 300), status: "pending" };
      });
      actions += proposed.length;
      await admin.from("recordings").update({
        summary: (summary || keyPoints.length) ? [summary, ...keyPoints].filter(Boolean) : null, proposed_tasks: proposed, transcript_en: transcriptEn,
        review_status: proposed.length ? "pending" : "done", interaction_id: interactionId, processed_at: new Date().toISOString(),
      }).eq("id", rec.id);
      processed++;
    }
    return J({ ok: true, processed, timelined, actions });
  } catch (e) { return J({ error: String(e) }, 500); }
});
