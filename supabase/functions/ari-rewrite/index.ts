// ari-rewrite
// Rewrites a draft message in Dara's voice, adapted to the recipient's behavioral
// style and — when a contact_id is supplied — their Relationship Intelligence
// (DISC read, connection plan, genuine interests, public personal context).
//
// Rebuilt from scratch (was previously a deployed-only function with no source in
// the repo) so it is both version-controlled AND intelligence-aware. Matches the
// original request/response contract exactly so existing call sites keep working.
//
// POST {
//   draft: string,                 // required — the message to refine
//   contact_name?: string,
//   disc_label?: string,           // fallback DISC hint, e.g. "I — Influencer"
//   source_text?: string,          // the message/thread this responds to
//   audience?: 'individual'|'group',
//   recipients?: string[],         // names, when audience === 'group'
//   contact_id?: uuid,             // when present → full Relationship Intelligence
//   channel?: 'email'|'text'
// }
// -> { message: string } | { error: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DISC_STYLE: Record<string, string> = {
  D: "DISC-D (decisive, results-driven): tighten it — lead with the point, one clear ask, cut filler. Confident and brief; respect their time.",
  I: "DISC-I (relational, expressive): warm it up — personable and a little energetic, open with genuine human connection, conversational.",
  S: "DISC-S (steady, relationship-first): soften it — calm, sincere, unhurried, no pressure; value the relationship over the ask and leave them room.",
  C: "DISC-C (precise, analytical): sharpen it — accurate and specific, logic over hype, no exclamation points or salesy language; give them something substantive.",
};

function discFromLabel(label: string): string | null {
  if (!label) return null;
  const m = label.match(/\b([DISC])\b/);
  return m ? m[1] : null;
}

function buildIntel(profile: any, discLabel: string): string {
  const lines: string[] = [];
  const disc = (profile && (profile.baseline_primary || profile.research_primary || profile.primary_letter)) || discFromLabel(discLabel);
  const sec = profile && (profile.baseline_secondary || profile.research_secondary || profile.secondary_letter);
  if (disc && DISC_STYLE[disc]) lines.push(`STYLE TO MIRROR: ${DISC_STYLE[disc]}${sec && DISC_STYLE[sec] ? ` Secondary ${sec} — blend in a touch.` : ""}`);
  if (profile) {
    const plan = profile.research_connection_plan || {};
    const per = profile.research_personal || {};
    const prof = profile.research_profile || {};
    const interests = [...(Array.isArray(per.hobbies) ? per.hobbies : []), ...(Array.isArray(prof.interests_values) ? prof.interests_values : [])].slice(0, 6);
    if (interests.length) lines.push(`Things they genuinely care about: ${interests.join("; ")}.`);
    if (Array.isArray(plan.topics_lean_in) && plan.topics_lean_in.length) lines.push(`Good ground to touch: ${plan.topics_lean_in.slice(0, 4).join("; ")}.`);
    if (Array.isArray(plan.add_value) && plan.add_value.length) lines.push(`Ways I can add value (weave one in only if it fits): ${plan.add_value.slice(0, 3).join("; ")}.`);
    if (per.family_context) lines.push(`Public family context (for warmth only, light touch, only if natural): ${per.family_context}`);
    if (Array.isArray(plan.topics_avoid) && plan.topics_avoid.length) lines.push(`AVOID these topics: ${plan.topics_avoid.join("; ")}.`);
  }
  if (!lines.length) return "";
  return `\n\n=== WHAT I KNOW ABOUT THIS PERSON (use to shape tone and pick a genuine, relevant angle — never copy verbatim, never imply you "researched" them, never force a detail that doesn't fit) ===\n${lines.join("\n")}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const b = await req.json();
    const draft = (b.draft || "").toString();
    if (!draft.trim()) return J({ error: "draft is required" }, 400);
    const who = b.contact_name || "the recipient";
    const isText = b.channel === "text";
    const isGroup = b.audience === "group";

    // Relationship Intelligence (verify the caller owns the contact)
    let profile: any = null;
    if (b.contact_id) {
      try {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          const { data: contact } = await supabase.from("contacts").select("user_id").eq("id", b.contact_id).maybeSingle();
          if (contact && contact.user_id === user.id) {
            const { data: p } = await supabase.from("profiles").select("*").eq("contact_id", b.contact_id).maybeSingle();
            profile = p || null;
          }
        }
      } catch (_) { /* non-fatal */ }
    }
    const intel = buildIntel(profile, b.disc_label || "");

    const groupLine = isGroup
      ? `\nThis message goes to MULTIPLE recipients${Array.isArray(b.recipients) && b.recipients.length ? ` (${b.recipients.slice(0, 8).join(", ")})` : ""}. Keep it appropriate for a group — inclusive, not one-to-one intimate.`
      : "";
    const sourceLine = b.source_text
      ? `\n\nThis message is in response to the following — make sure the rewrite fits it naturally:\n"""${String(b.source_text).slice(0, 1500)}"""`
      : "";

    const system = `You are Ari, refining a message that Dara — a Tampa Bay real-estate broker and investor — is about to send to ${who}. Rewrite the DRAFT in Dara's voice: professional but warm, relationship-forward, concise, confident; never stiff or generic.
Hard rules:
- Preserve the draft's intent, every fact, and its medium. ${isText ? "Keep it a short SMS-style text; no subject line, no formal signature." : "Keep it an email body; do NOT add a subject line."} Keep it roughly the same length.
- Do NOT invent facts, figures, dollar amounts, dates, or commitments that aren't in the draft (or the context provided).
- Improve clarity, warmth, and flow.${intel ? "\n- Use the recipient knowledge below to adjust tone and choose a genuine, relevant angle. Mirror how they communicate. Be subtle — never stuff in facts about them, never reveal you 'looked them up'." : ""}${groupLine}
Return ONLY the rewritten message text — no preamble, no quotation marks, no explanation, no JSON.`;

    const userMsg = `DRAFT to rewrite:\n"""${draft}"""${sourceLine}${intel}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 900, system, messages: [{ role: "user", content: userMsg }] }),
    });
    if (!r.ok) {
      const t = await r.text();
      return J({ error: `Anthropic ${r.status}: ${t.slice(0, 200)}` }, 502);
    }
    const j = await r.json();
    let message = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    // Strip any accidental wrapping quotes/fences.
    message = message.replace(/^```[a-z]*\s*/i, "").replace(/```$/i, "").trim();
    if ((message.startsWith('"') && message.endsWith('"')) || (message.startsWith("'") && message.endsWith("'"))) {
      message = message.slice(1, -1).trim();
    }
    if (!message) return J({ error: "No output" }, 502);
    return J({ message, intel_used: !!intel });
  } catch (e) {
    return J({ error: String((e as any)?.message || e) }, 500);
  }
});
