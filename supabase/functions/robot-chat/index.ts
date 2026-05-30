// robot-chat
// Chat with an AI robot defined in the robots table. Each robot has its own
// system_prompt and role. Persists the rolling conversation to robot_conversations
// so the assistant can reference prior turns.
//
// POST body: { robot_id: uuid, message: string, history?: [{role,content}, ...] }
// Returns:   { response: string, meta?: { model, tokens } }
//
// Auth: requires a valid user JWT. Robot lookups are scoped to active=true robots.
// Conversations are stored per (user_id, robot_id).

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
const MAX_TOKENS = 2048;
const MAX_HISTORY_TURNS = 20;  // keep prompt size sane

async function callClaude(system: string, messages: any[]) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system,
      messages,
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Anthropic ${r.status}: ${t.slice(0, 400)}`);
  }
  const j = await r.json();
  const text = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  return { text, usage: j.usage };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { robot_id, message, history = [] } = body || {};
    if (!robot_id || !message || typeof message !== "string") {
      return new Response(JSON.stringify({ error: "robot_id and message required" }), {
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

    // Load the robot. Each robot now belongs to a single user (Pass 2 Batch A).
    // We require the robot to belong to the calling user — passing another user's
    // robot_id would otherwise leak their custom system_prompt.
    const { data: robot, error: rErr } = await supabase
      .from("robots").select("id, name, role, system_prompt, active, user_id")
      .eq("id", robot_id).maybeSingle();
    if (rErr || !robot) {
      return new Response(JSON.stringify({ error: "Robot not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (robot.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Robot not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!robot.active) {
      return new Response(JSON.stringify({ error: "Robot is inactive" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build message list. Cap history.
    const cleanHistory = Array.isArray(history)
      ? history
          .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-MAX_HISTORY_TURNS)
      : [];
    const messages = [...cleanHistory, { role: "user", content: message }];
    const system = robot.system_prompt || `You are ${robot.name}, an AI assistant.`;

    const { text, usage } = await callClaude(system, messages);

    // Persist conversation. Schema: { user_id, robot_id, messages jsonb }.
    // Upsert on (user_id, robot_id) — append new turns to the rolling thread.
    const newTurns = [
      { role: "user", content: message, ts: new Date().toISOString() },
      { role: "assistant", content: text, ts: new Date().toISOString() },
    ];
    const { data: existing } = await supabase
      .from("robot_conversations")
      .select("id, messages")
      .eq("user_id", userId).eq("robot_id", robot_id)
      .maybeSingle();
    if (existing) {
      const merged = Array.isArray(existing.messages) ? [...existing.messages, ...newTurns] : newTurns;
      // Cap stored history to last 200 turns to keep row size sane
      const capped = merged.slice(-200);
      await supabase.from("robot_conversations")
        .update({ messages: capped, updated_at: new Date().toISOString() })
        .eq("id", existing.id);
    } else {
      await supabase.from("robot_conversations").insert({
        user_id: userId,
        robot_id,
        messages: newTurns,
      });
    }

    return new Response(JSON.stringify({
      response: text,
      meta: { model: MODEL, tokens: usage },
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = String(err && (err as any).message ? (err as any).message : err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
