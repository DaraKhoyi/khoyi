// ari-disc-broadcast
// Takes ONE base message and returns it rewritten into multiple DISC-style
// variants in a single call, so the user can review/edit a D / I / S / C (and an
// optional neutral) draft and fan each one out to the contacts whose dominant
// behavioral style matches.
//
// Each body opens with a greeting containing the literal token {first_name},
// which the client replaces per recipient at send time. Adapts to the calling
// agent's MyVoice on top of the house voice (same substrate as ari-rewrite).
//
// POST {
//   base_message: string,          // required — what the user wants to say
//   channel: 'email' | 'text',     // default 'text'
//   styles?: ('D'|'I'|'S'|'C')[],  // default ['D','I','S','C']
//   include_neutral?: boolean,     // add a 5th non-DISC variant
//   base_subject?: string          // email only — a starting subject
// }
// -> { drafts: { D?:{subject,body}, I?:..., S?:..., C?:..., neutral?:... } } | { error }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DISC_STYLE: Record<string, string> = {
  D: "DISC-D (decisive, results-driven): lead with the point, one clear ask, cut filler. Confident and brief; respect their time. No small talk.",
  I: "DISC-I (relational, expressive): warm and a little energetic, open with genuine human connection, conversational, optimistic. An exclamation point is fine.",
  S: "DISC-S (steady, relationship-first): calm, sincere, unhurried, zero pressure; value the relationship over the ask and leave them room to decide.",
  C: "DISC-C (precise, analytical): accurate and specific, logic over hype, no exclamation points or salesy language; give them something substantive.",
};
const NAMES: Record<string, string> = { D: "Dominance", I: "Influence", S: "Steadiness", C: "Conscientiousness" };

// Loads the calling agent's ACTIVE MyVoice card. Null for users without one
// (e.g. Dara), preserving default house-voice behavior.
async function loadVoice(req: Request): Promise<{ body: string; name: string | null } | null> {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return null;
    const [{ data: vc }, { data: ag }, { data: us }] = await Promise.all([
      supabase.from("voice_cards").select("body").eq("user_id", user.id).eq("kind", "agent").eq("is_active", true).order("updated_at", { ascending: false }).limit(1),
      supabase.from("agents").select("name").eq("auth_user_id", user.id).maybeSingle(),
      supabase.from("user_settings").select("display_name, email_signature, text_signature").eq("user_id", user.id).maybeSingle(),
    ]);
    const meta: any = (user as any).user_metadata || {};
    const name = (ag && ag.name) || (us && (us as any).display_name) || meta.full_name || meta.display_name || (user.email ? String(user.email).split("@")[0] : null);
    return { body: (vc && vc[0] && vc[0].body) || null, name, emailSig: (us && (us as any).email_signature) || null, textSig: (us && (us as any).text_signature) || null };
  } catch (_) { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const b = await req.json();
    const baseMessage = (b.base_message || "").toString().trim();
    if (!baseMessage) return J({ error: "base_message is required" }, 400);
    const isText = b.channel !== "email";
    let styles: string[] = Array.isArray(b.styles) && b.styles.length ? b.styles.filter((s: string) => DISC_STYLE[s]) : ["D", "I", "S", "C"];
    const includeNeutral = !!b.include_neutral;
    const baseSubject = (b.base_subject || "").toString().trim();

    const info = await loadVoice(req);
    const senderName = (info && info.name) || "there";
    const voice = (info && info.body) ? { body: info.body, name: senderName } : null;
    const personaIntro = voice
      ? `You are Ari, preparing a message that ${senderName} — a real-estate agent — is about to send. Write in ${senderName}'s own voice, captured here and authoritative on tone, phrasing, rhythm, and word choice:\n"""${voice.body}"""\nThe brokerage house voice — warm, savvy, lead with the answer, plain language, no clichés, one concrete next step, never salesy or AI-sounding — is the floor; ${senderName}'s voice rides on top and wins where they differ.`
      : `You are Ari, preparing a message that ${senderName} — a real-estate agent — is about to send. Write in ${senderName}'s voice: professional but warm, relationship-forward, concise, confident; never stiff, generic, or salesy.`;

    const wanted: string[] = [...styles];
    const styleSpec = wanted.map((s) => `"${s}" — ${DISC_STYLE[s]}`).join("\n");
    const neutralSpec = includeNeutral
      ? `\n"neutral" — no behavioral profile is known for these recipients. Use the clean house voice: warm, clear, professional, no assumptions about their style.`
      : "";

    const channelRules = isText
      ? `This is an SMS TEXT. Each "body" must be a short, natural text message (no subject, no formal signature, no email formatting). Set each "subject" to an empty string "".`
      : `This is an EMAIL. Each "body" is an email body (no signature block needed). Each "subject" is a concise subject line tuned to that style${baseSubject ? `, starting from this idea: "${baseSubject}"` : ""}.`;

    const keys = [...wanted, ...(includeNeutral ? ["neutral"] : [])];
    const shape = `{ ${keys.map((k) => `"${k}": { "subject": string, "body": string }`).join(", ")} }`;

    const system = `${personaIntro}

You are given ONE base message. Produce a separate version of it for each behavioral style below, preserving the intent and every fact. Do NOT invent facts, figures, dates, dollar amounts, or commitments not present in the base message.

${channelRules}

CRITICAL personalization rule: begin EVERY body with a greeting that contains the literal token {first_name} exactly (with the curly braces) — e.g. "Hi {first_name}," or "{first_name} —". The app replaces that token with each person's real first name at send time. Never invent or guess a name.

Styles to write (use these exact keys):
${styleSpec}${neutralSpec}

Return ONLY minified JSON in exactly this shape, nothing else:
${shape}`;

    const userMsg = `BASE MESSAGE:\n"""${baseMessage}"""`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 2000, system, messages: [{ role: "user", content: userMsg }] }),
    });
    if (!r.ok) {
      const t = await r.text();
      return J({ error: `Anthropic ${r.status}: ${t.slice(0, 200)}` }, 502);
    }
    const j = await r.json();
    try { await logAiUsage(supabase, { userId: user?.id, fn: "ari-disc-broadcast", model: MODEL, usage: j?.usage, usedOwn: false }); } catch (_) {}
    let raw = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    raw = raw.replace(/^```[a-z]*\s*/i, "").replace(/```$/i, "").trim();
    // Be tolerant: pull the outermost JSON object if there's any stray prose.
    const first = raw.indexOf("{"); const last = raw.lastIndexOf("}");
    if (first > 0 || last < raw.length - 1) { if (first >= 0 && last > first) raw = raw.slice(first, last + 1); }

    let parsed: any;
    try { parsed = JSON.parse(raw); } catch (_) { return J({ error: "Could not parse drafts. Try again." }, 502); }

    const __sig = ((isText ? (info && info.textSig) : (info && info.emailSig)) || "").trim() || (isText ? ("– " + String(senderName).split(/\s+/)[0]) : String(senderName));
    const drafts: Record<string, { subject: string; body: string }> = {};
    for (const k of keys) {
      const v = parsed[k] || {};
      let body = (v.body || "").toString().trim();
      if (!body) continue;
      if (__sig) body = body.replace(/\s+$/, "") + "\n\n" + __sig;
      drafts[k] = { subject: (v.subject || "").toString().trim(), body };
    }
    if (!Object.keys(drafts).length) return J({ error: "No drafts produced. Try again." }, 502);

    return J({ drafts });
  } catch (e) {
    return J({ error: String((e as any)?.message || e) }, 500);
  }
});
