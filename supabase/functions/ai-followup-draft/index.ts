// ai-followup-draft
// POST {
//   contactName, company?, role?, channel: 'email'|'text', kind?, entryBody?,
//   occurredAt?, instruction?, recentNotes?: string[], senderName?,
//   contact_id?            // when present, the draft is shaped by the contact's
//                          // DISC read + Relationship Intelligence (connection plan,
//                          // interests/values, public personal context).
// }
// -> { subject: string, body: string }
//
// Drafts a follow-up message (email or SMS) in the user's voice, adapted to the
// recipient's behavioral style and what genuinely matters to them. Never invents facts.
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
  D: "They read as DISC-D (decisive, results-driven). Be direct and brief. Lead with the bottom line and a clear, single ask. Cut warm-up and filler. Respect their time; project competence and momentum.",
  I: "They read as DISC-I (relational, expressive). Be warm, personable, and a little energetic. Open with genuine human connection, use their name, keep it conversational, and make it feel like a real person reaching out — not a transaction.",
  S: "They read as DISC-S (steady, relationship-first). Be calm, sincere, and unhurried. No pressure or hard asks. Reassure, show you value the relationship over the deal, and leave room for them to respond in their own time.",
  C: "They read as DISC-C (precise, analytical). Be accurate and specific. Favor concrete details and logic over enthusiasm or hype. No exclamation points or salesy language; give them something substantive they can evaluate.",
};

function buildIntel(profile: any): string {
  if (!profile) return "";
  const lines: string[] = [];
  const disc = profile.baseline_primary || profile.research_primary || profile.primary_letter;
  const sec = profile.baseline_secondary || profile.research_secondary || profile.secondary_letter;
  if (disc && DISC_STYLE[disc]) {
    lines.push(`STYLE TO MIRROR: ${DISC_STYLE[disc]}${sec && DISC_STYLE[sec] ? ` Secondary ${sec}, so blend in a touch of that.` : ""}`);
  }
  const plan = profile.research_connection_plan || {};
  const per = profile.research_personal || {};
  const prof = profile.research_profile || {};
  const interests = [
    ...(Array.isArray(per.hobbies) ? per.hobbies : []),
    ...(Array.isArray(prof.interests_values) ? prof.interests_values : []),
  ].slice(0, 6);
  if (interests.length) lines.push(`Things they genuinely care about: ${interests.join("; ")}.`);
  if (Array.isArray(plan.topics_lean_in) && plan.topics_lean_in.length) lines.push(`Good ground to touch: ${plan.topics_lean_in.slice(0, 4).join("; ")}.`);
  if (Array.isArray(plan.add_value) && plan.add_value.length) lines.push(`Ways I can add value to them (weave one in only if it fits the moment): ${plan.add_value.slice(0, 3).join("; ")}.`);
  if (per.family_context) lines.push(`Public family context (for warmth only, reference lightly and only if natural): ${per.family_context}`);
  if (Array.isArray(plan.topics_avoid) && plan.topics_avoid.length) lines.push(`AVOID these topics: ${plan.topics_avoid.join("; ")}.`);
  if (!lines.length) return "";
  return `\n\n=== WHAT I KNOW ABOUT THIS PERSON (use to shape tone and pick a genuine, relevant angle — never copy verbatim, never imply you "researched" them, never force a detail that doesn't fit) ===\n${lines.join("\n")}`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const b = await req.json();
    const channel = b.channel === "text" ? "text" : "email";
    const isText = channel === "text";
    const who = b.contactName || "the contact";
    const sender = b.senderName || "Dara";
    const recent: string[] = Array.isArray(b.recentNotes) ? b.recentNotes.filter(Boolean).slice(0, 6) : [];
    const ctx = recent.length ? `\n\nRecent history with this person (most recent first):\n${recent.map((n) => `- ${n}`).join("\n")}` : "";

    // Pull Relationship Intelligence for this contact (DISC + connection plan + personal),
    // verifying the caller owns the contact.
    let intel = "";
    if (b.contact_id) {
      try {
        const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
        const { data: { user } } = await supabase.auth.getUser(token);
        if (user) {
          const { data: contact } = await supabase.from("contacts").select("user_id").eq("id", b.contact_id).maybeSingle();
          if (contact && contact.user_id === user.id) {
            const { data: profile } = await supabase.from("profiles").select("*").eq("contact_id", b.contact_id).maybeSingle();
            intel = buildIntel(profile);
          }
        }
      } catch (_) { /* non-fatal: draft without intel */ }
    }

    const system = `You draft follow-up messages for ${sender}, a Tampa Bay real-estate broker and investor. Voice: professional but warm, relationship-forward, concise, and confident — never stiff, never generic filler.
Write a ${isText
      ? "short SMS text message: 1-3 sentences, casual but professional, no subject line, no formal signature block."
      : `follow-up email: include a clear subject line, keep the body tight (2-4 short paragraphs), and sign off simply as "${sender}".`}
${intel ? "Adapt the tone and pick your angle using the recipient knowledge provided in the user message. The goal is a message that feels personally written for THIS person — mirror how they communicate, and lean on something they genuinely care about when it fits naturally. Subtlety wins; do not stuff in facts about them." : ""}
Ground the message in the activity being followed up. Do NOT invent facts, figures, dollar amounts, commitments, or dates that aren't supported by the provided details. If a next step was implied, reinforce it concretely.
Respond with ONLY a JSON object (no markdown fences, no preamble): {"subject": "<subject, or empty string for a text>", "body": "<the message>"}`;

    const userMsg = `Draft a ${channel} follow-up to ${who}${b.company ? ` (${b.role ? b.role + ", " : ""}${b.company})` : ""}, following up on this ${b.kind || "conversation"}${b.occurredAt ? ` from ${b.occurredAt}` : ""}:

"${b.entryBody || "(no details recorded)"}"${ctx}${intel}${b.instruction ? `\n\nExtra instruction for this draft: ${b.instruction}` : ""}`;

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        system,
        messages: [{ role: "user", content: userMsg }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      return new Response(JSON.stringify({ error: `Anthropic ${r.status}: ${t.slice(0, 200)}` }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const j = await r.json();
    let raw = (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
    let subject = "", body = raw;
    try {
      const parsed = JSON.parse(raw);
      subject = parsed.subject || "";
      body = parsed.body || raw;
    } catch (_) {
      // Model didn't return clean JSON — treat whole output as the body.
    }
    return new Response(JSON.stringify({ subject, body, intel_used: !!intel }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
