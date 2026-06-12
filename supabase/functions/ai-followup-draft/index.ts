// ai-followup-draft
// POST {
//   contactName, company?, role?, channel: 'email'|'text', kind?, entryBody?,
//   occurredAt?, instruction?, recentNotes?: string[], senderName?
// }
// -> { subject: string, body: string }
//
// Drafts a follow-up message (email or SMS) in the user's voice based on a
// timeline activity entry. Never invents facts.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

    const system = `You draft follow-up messages for ${sender}, a Tampa Bay real-estate broker and investor. Voice: professional but warm, relationship-forward, concise, and confident — never stiff, never generic filler.
Write a ${isText
      ? "short SMS text message: 1-3 sentences, casual but professional, no subject line, no formal signature block."
      : `follow-up email: include a clear subject line, keep the body tight (2-4 short paragraphs), and sign off simply as "${sender}".`}
Ground the message in the activity being followed up. Do NOT invent facts, figures, dollar amounts, commitments, or dates that aren't supported by the provided details. If a next step was implied, reinforce it concretely.
Respond with ONLY a JSON object (no markdown fences, no preamble): {"subject": "<subject, or empty string for a text>", "body": "<the message>"}`;

    const userMsg = `Draft a ${channel} follow-up to ${who}${b.company ? ` (${b.role ? b.role + ", " : ""}${b.company})` : ""}, following up on this ${b.kind || "conversation"}${b.occurredAt ? ` from ${b.occurredAt}` : ""}:

"${b.entryBody || "(no details recorded)"}"${ctx}${b.instruction ? `\n\nExtra instruction for this draft: ${b.instruction}` : ""}`;

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
    return new Response(JSON.stringify({ subject, body }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
