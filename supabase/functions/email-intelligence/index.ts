// email-intelligence
// AI triage for incoming email threads. Given a thread_id:
//   1. Check email_triage cache (return cached unless force=true or stale)
//   2. If miss/stale, load messages, ask Claude to classify
//   3. UPSERT result into email_triage table
//   4. Return the triage object
//
// POST body: { thread_id: uuid, force?: boolean }
// Returns:   {
//   category: 'urgent' | 'requires_response' | 'fyi' | 'can_wait' | 'promotional' | 'spam',
//   action:   'reply_now' | 'reply_today' | 'schedule_reply' | 'archive' | 'ignore' | 'snooze',
//   summary:  string,        // one-line gist
//   reasoning: string,       // why this category/action
//   confidence: 0..1,
//   cached: boolean,         // true if served from cache without re-running
//   created_at: timestamptz, // when the (cached or new) row was written
// }
//
// Cache invalidation: re-runs if the thread has grown beyond what we analyzed
// (message_count > message_count_at_triage). Pass force=true to bypass cache.
//
// Auth: requires a valid user JWT. Thread must belong to caller.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-sonnet-4-6";
const PROMPT_VERSION = "v1";

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

let __lastUsage: any = null;
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
  __lastUsage = j?.usage || null;
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
    const { thread_id, force = false } = body || {};
    if (!thread_id) {
      return new Response(JSON.stringify({ error: "thread_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // SECURITY: identity comes from the JWT, or — for the cron worker only — from an
    // INTERNAL TOKEN plus an explicit user_id.
    //
    // The internal path exists because lead-triage-worker classifies leads on a
    // schedule, when no user is present to hold a token. It is the same pattern
    // recording-process uses, and it is deliberately a SEPARATE header rather than
    // the service-role key: presenting the service key still fails, so a leaked
    // service key does not become a way to read anyone's mail.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const internalTok = req.headers.get("x-internal-token") || "";
    const INTERNAL = Deno.env.get("QCP_TOKEN") || "";
    let userId: string;

    if (INTERNAL && internalTok === INTERNAL) {
      // Cron path: the caller must name the user, and it can only be reached by
      // something holding a secret no browser ever sees.
      const uid = (body && body.user_id) || null;
      if (!uid) {
        return new Response(JSON.stringify({ error: "user_id required on the internal path" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      userId = uid;
    } else {
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
      userId = user.id;
    }
    const _logUsage = () => { try { logAiUsage(supabase, { userId, fn: "email-intelligence", model: MODEL, usage: __lastUsage, usedOwn: false }); } catch (_) {} };

    // Load the thread. Must belong to caller.
    const { data: thread, error: tErr } = await supabase
      .from("email_threads")
      .select("id, user_id, subject, participants, snippet, labels, message_count, last_message_at")
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

    // CACHE CHECK: serve cached result unless force=true OR thread grew since
    // we last analyzed it OR cached row was generated under a different prompt
    // version (means we changed the system prompt).
    if (!force) {
      const { data: cached } = await supabase
        .from("email_triage")
        .select("*")
        .eq("thread_id", thread_id)
        .maybeSingle();
      if (cached) {
        const stale = (thread.message_count != null
                        && cached.message_count_at_triage != null
                        && thread.message_count > cached.message_count_at_triage)
                     || cached.prompt_version !== PROMPT_VERSION;
        if (!stale) {
          return new Response(JSON.stringify({
            category: cached.category,
            action: cached.action,
            summary: cached.summary,
            reasoning: cached.reasoning,
            confidence: Number(cached.confidence),
            cached: true,
            created_at: cached.created_at,
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }
    }

    // CACHE MISS / FORCE: run the model
    const { data: msgs } = await supabase
      .from("email_messages")
      .select("from_name, from_address, subject, snippet, body_text, sent_at, direction")
      .eq("thread_id", thread_id)
      .order("sent_at", { ascending: false })
      .limit(5);

    const messageBlocks = (msgs || []).reverse().map((m: any, i: number) => {
      const from = m.from_name ? `${m.from_name} <${m.from_address}>` : (m.from_address || "(unknown)");
      const bodyText = (m.body_text || m.snippet || "").slice(0, 1500);
      return `--- Message ${i + 1} (${m.direction || "inbound"}, ${m.sent_at}) ---\nFrom: ${from}\nSubject: ${m.subject || "(no subject)"}\n\n${bodyText}`;
    }).join("\n\n");

    const userMsg = `Subject: ${thread.subject || "(no subject)"}
Participants: ${(thread.participants || []).map((p: any) => p.name || p.email).join(", ") || "(unknown)"}
Labels: ${(thread.labels || []).join(", ") || "(none)"}

${messageBlocks || "(no message bodies available)"}`;

    const systemPrompt = await buildSystemPrompt(supabase, userId);
    const raw = await callClaude(systemPrompt, [{ role: "user", content: userMsg }]);
    _logUsage();
    const parsed = safeParseJSON(raw);

    // Validate enum values
    const validCategories = ["urgent","requires_response","fyi","can_wait","promotional","spam"];
    const validActions = ["reply_now","reply_today","schedule_reply","archive","ignore","snooze"];
    if (!validCategories.includes(parsed.category)) parsed.category = "fyi";
    if (!validActions.includes(parsed.action)) parsed.action = "archive";
    if (typeof parsed.confidence !== "number") parsed.confidence = 0.5;
    parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));

    // UPSERT into cache. The UNIQUE(thread_id) constraint means re-runs replace.
    // user_id is set from JWT — RLS would block service-role bypass but we
    // pass it explicitly so the row is owned by the caller.
    const { error: upsertErr } = await supabase
      .from("email_triage")
      .upsert({
        user_id: userId,
        thread_id,
        category: parsed.category,
        action: parsed.action,
        summary: parsed.summary || null,
        reasoning: parsed.reasoning || null,
        confidence: parsed.confidence,
        message_count_at_triage: thread.message_count ?? null,
        last_message_at_triage: thread.last_message_at ?? null,
        model: MODEL,
        prompt_version: PROMPT_VERSION,
        created_at: new Date().toISOString(),
      }, { onConflict: "thread_id" });

    // Pass 5 Finding #12: surface persistence failure to the client so it can
    // re-run later if needed. Previously this was only console.error'd; clients
    // saw 'cached: true' on the next view even though nothing was actually cached.
    if (upsertErr) {
      console.error("email_triage upsert failed:", upsertErr.message);
    }

    return new Response(JSON.stringify({
      ...parsed,
      cached: false,
      created_at: new Date().toISOString(),
      persist_error: upsertErr ? (upsertErr.message || String(upsertErr)) : null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = String(err && (err as any).message ? (err as any).message : err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
