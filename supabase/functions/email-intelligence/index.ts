// email-intelligence
// AI triage for incoming email threads. Given a thread_id, loads the latest
// few messages, asks Claude to classify, and returns a recommendation.
//
// POST body: { thread_id: uuid }
// Returns:   {
//   category: 'urgent' | 'requires_response' | 'fyi' | 'can_wait' | 'promotional' | 'spam',
//   action:   'reply_now' | 'reply_today' | 'schedule_reply' | 'archive' | 'ignore' | 'snooze',
//   summary:  string,        // one-line gist
//   reasoning:string,        // why this category/action
//   confidence: 0..1,
// }
//
// Auth: requires a valid user JWT. Thread must belong to caller.
// Note: this is a starter stub — wire into the inbox UI when you're ready.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-sonnet-4-6";

const BASE_SYSTEM = `You are an email triage assistant.
For each thread, classify into ONE category and ONE action.

Categories:
- urgent: time-critical, requires immediate attention (active crisis, hard deadline today, anything blocking others)
- requires_response: needs a personal reply but not emergency (question, coordination, scheduling)
- fyi: informational, no reply expected (newsletter, status update, recap)
- can_wait: relevant but low-priority (longer-term planning, non-urgent feedback)
- promotional: marketing/sales pitch to the user
- spam: junk, phishing, irrelevant

Actions:
- reply_now: open and respond before next task
- reply_today: respond by end of day
- schedule_reply: set a reminder/snooze; not today
- archive: read and file
- ignore: no action needed (FYI/auto)
- snooze: hide from inbox, bring back later

Return ONLY a JSON object: {"category":"...", "action":"...", "summary":"...", "reasoning":"...", "confidence":0..1}. No prose outside the JSON.`;

// Loads optional user context so triage can calibrate what's urgent for this user.
async function buildSystemPrompt(supabase: any, userId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("user_settings")
      .select("profession, assistant_context")
      .eq("user_id", userId)
      .maybeSingle();
    const profession = data?.profession?.trim();
    const ctx = data?.assistant_context?.trim();
    if (!profession && !ctx) return BASE_SYSTEM;
    const contextLines = [
      profession ? `- The user's role/profession: ${profession}` : null,
      ctx ? `- About the user: ${ctx}` : null,
    ].filter(Boolean).join("\n");
    return `${BASE_SYSTEM}\n\nUSER CONTEXT (calibrate "urgent" and "important" against this):\n${contextLines}`;
  } catch (_) {
    return BASE_SYSTEM;
  }
}

async function callClaude(systemPrompt: string, messages: any[]) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, system: systemPrompt, messages }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Anthropic ${r.status}: ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  return (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

function safeParseJSON(text: string) {
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in response");
  return JSON.parse(cleaned.slice(start, end + 1));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { thread_id } = body || {};
    if (!thread_id) {
      return new Response(JSON.stringify({ error: "thread_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // SECURITY: derive user_id from JWT only
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    // Load the thread. Must belong to caller.
    const { data: thread, error: tErr } = await supabase
      .from("email_threads").select("id, user_id, subject, participants, snippet, labels")
      .eq("id", thread_id).maybeSingle();
    if (tErr || !thread) {
      return new Response(JSON.stringify({ error: "Thread not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (thread.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load the last few messages of the thread for context (cap to limit prompt size)
    const { data: msgs } = await supabase
      .from("email_messages")
      .select("from_name, from_address, subject, snippet, body_text, sent_at, direction")
      .eq("thread_id", thread_id)
      .order("sent_at", { ascending: false })
      .limit(5);

    const messageBlocks = (msgs || []).reverse().map((m: any, i: number) => {
      const from = m.from_name ? `${m.from_name} <${m.from_address}>` : (m.from_address || "(unknown)");
      const body = (m.body_text || m.snippet || "").slice(0, 1500);
      return `--- Message ${i + 1} (${m.direction || "inbound"}, ${m.sent_at}) ---\nFrom: ${from}\nSubject: ${m.subject || "(no subject)"}\n\n${body}`;
    }).join("\n\n");

    const userMsg = `Subject: ${thread.subject || "(no subject)"}
Participants: ${(thread.participants || []).map((p: any) => p.name || p.email).join(", ") || "(unknown)"}
Labels: ${(thread.labels || []).join(", ") || "(none)"}

${messageBlocks || "(no message bodies available)"}`;

    const systemPrompt = await buildSystemPrompt(supabase, userId);
    const raw = await callClaude(systemPrompt, [{ role: "user", content: userMsg }]);
    const parsed = safeParseJSON(raw);

    // Validate enum values
    const validCategories = ["urgent","requires_response","fyi","can_wait","promotional","spam"];
    const validActions = ["reply_now","reply_today","schedule_reply","archive","ignore","snooze"];
    if (!validCategories.includes(parsed.category)) parsed.category = "fyi";
    if (!validActions.includes(parsed.action)) parsed.action = "archive";
    if (typeof parsed.confidence !== "number") parsed.confidence = 0.5;
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = String(err && (err as any).message ? (err as any).message : err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
