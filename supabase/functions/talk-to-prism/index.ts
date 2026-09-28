// talk-to-prism — the brain behind "Talk to Prism", the voice screen.
//
// Dara, 27 Sep 2026: "Can you build an app or widget that I can launch from the
// home screen that I can just speak to for my request?" The screen
// (src/views/TalkToPrism.jsx) turns speech into text and reads the answer
// aloud; this function decides what to do and does it.
//
// SAME ACTIONS, SAME SAFETY AS THE CLAUDE CONNECTOR. The tools are the shared
// definitions in _shared/prismTools.ts, run through a client built from the
// person's own sign-in token — row-level security decides what is visible,
// exactly as in the app. Nothing sends email or texts.
//
// NOTHING CHANGES WITHOUT A YES. When the model wants a tool that changes
// something (readOnlyHint false), this function STOPS and hands the proposed
// action back to the screen, which asks "Shall I…?" and waits for the person
// to say or tap yes. Only the next request, carrying decision: "confirm", runs
// it. Reads run straight away.
//
// Conversation state lives on the phone (the screen sends the recent turns
// each time); nothing about the conversation is stored here. Each model call is
// logged to ai_usage_log against the person (the standing AI-cost rule), and
// each tool call to mcp_calls (who, which tool, did it work — never content).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { TOOLS, INSTRUCTIONS, type Ctx } from "../_shared/prismTools.ts";
import { logAiUsage } from "../_shared/aiUsage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "claude-sonnet-4-6";
const MAX_STEPS = 6;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const isWrite = (name: string) => TOOLS[name] && TOOLS[name].annotations?.readOnlyHint === false;

function systemPrompt(name: string | null) {
  const now = new Date();
  const nyDate = now.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const nyTime = now.toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const iso = now.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  return `${INSTRUCTIONS}

You are "Prism", speaking out loud to ${name || "the signed-in person"} through their phone. It is ${nyDate} (${iso}), ${nyTime} in Tampa.
- Your words are READ ALOUD. Answer in one to three short spoken sentences. No markdown, no bullet points, no emoji, no links, no ids. Say dates like "Tuesday the 30th" and money like "three hundred forty thousand".
- Use the tools to answer; never guess. Find a person with find_contacts before acting on them. If two people match, ask which one.
- To change anything (add a task, a note, tick off or postpone a call, complete a task): in the SAME reply, say in ONE short sentence exactly what you will do, phrased as a question ("Shall I add a task to send Maria the CMA on Thursday the 1st?"), AND call the tool. Never ask in words and wait — the tool call is what shows the person the Yes button, and nothing happens until they press it or say yes. If there is a sensible default (no matching contact: add it unlinked), put the default in your question and still call the tool ("I don't have a Maria in your contacts — shall I add it without linking her?"). Only ask without calling a tool when you truly cannot choose, such as two people matching.
- Postponing: turn "next Tuesday", "after the weekend" or "in two weeks" into a number of days from today.
- If a request needs something you cannot do here (send an email or text, anything outside these tools), say so briefly and suggest the PrismOS screen that does it.`;
}

// Keep the last turns, starting at a plain spoken turn so tool calls and their
// results are never split apart.
function trim(messages: any[]) {
  if (messages.length <= 30) return messages;
  let cut = messages.length - 30;
  while (cut < messages.length && !(messages[cut].role === "user" && (typeof messages[cut].content === "string"
    || (Array.isArray(messages[cut].content) && !messages[cut].content.some((b: any) => b.type === "tool_result"))))) cut++;
  return messages.slice(cut);
}

async function runTool(name: string, input: any, ctx: Ctx, admin: any) {
  const tool = TOOLS[name];
  if (!tool || (tool.staffOnly && !ctx.staff)) return { content: `Unknown tool ${name}`, is_error: true };
  const started = Date.now();
  let out: unknown = null, failed: string | null = null;
  try { out = await tool.run(input || {}, ctx); } catch (e) { failed = (e as Error)?.message || String(e); }
  try { await admin.from("mcp_calls").insert({ user_id: ctx.userId, client_id: "talk-to-prism", tool: name, ok: !failed, error: failed ? failed.slice(0, 300) : null, ms: Date.now() - started }); } catch { /* best-effort */ }
  return failed ? { content: failed, is_error: true } : { content: JSON.stringify(out) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Who is speaking: verified by the auth server from the app's own session.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const { data: u } = token ? await admin.auth.getUser(token) : { data: null } as any;
  if (!u?.user) return json({ error: "Sign in to PrismOS first." }, 401);
  const db = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: allowed } = await db.rpc("mcp_access_allowed");
  if (allowed !== true) return json({ error: "Talk to Prism is not switched on for your account yet. Ask Dara." }, 403);
  const { data: staff } = await db.rpc("is_brokerage_staff");
  const ctx: Ctx = { db, admin, userId: u.user.id, staff: staff === true, via: "Talk to Prism" };
  const { data: me } = await db.from("agents").select("name").eq("auth_user_id", u.user.id).maybeSingle();
  const firstName = me?.name ? String(me.name).split(/\s+/)[0] : null;

  const body = await req.json().catch(() => ({}));
  let messages: any[] = Array.isArray(body.messages) ? trim(body.messages) : [];
  const tools = Object.entries(TOOLS).filter(([, t]) => !t.staffOnly || ctx.staff)
    .map(([name, t]) => ({ name, description: t.description, input_schema: t.inputSchema }));

  // A decision on the action proposed last time.
  if (body.decision === "confirm" || body.decision === "cancel") {
    const last = messages[messages.length - 1];
    const uses = last && last.role === "assistant" && Array.isArray(last.content) ? last.content.filter((b: any) => b.type === "tool_use") : [];
    if (!uses.length) return json({ error: "Nothing is waiting for a yes." }, 400);
    const results = [];
    for (const b of uses) {
      if (isWrite(b.name) && body.decision === "cancel") {
        results.push({ type: "tool_result", tool_use_id: b.id, content: "The person said no. Do not do it; acknowledge briefly." });
      } else {
        const r = await runTool(b.name, b.input, ctx, admin);
        results.push({ type: "tool_result", tool_use_id: b.id, content: r.content, ...(r.is_error ? { is_error: true } : {}) });
      }
    }
    messages.push({ role: "user", content: results });
  } else {
    const text = String(body.text || "").trim();
    if (!text) return json({ error: "Say something first." }, 400);
    // Said something else instead of yes or no: the proposed action is dropped
    // (the model needs an answer for every tool call it made, or it errors).
    const last = messages[messages.length - 1];
    const dangling = last && last.role === "assistant" && Array.isArray(last.content) ? last.content.filter((b: any) => b.type === "tool_use") : [];
    if (dangling.length) {
      messages.push({ role: "user", content: [
        ...dangling.map((b: any) => ({ type: "tool_result", tool_use_id: b.id, content: "Not done: the person did not say yes and moved on to something else." })),
        { type: "text", text: text.slice(0, 2000) },
      ] });
    } else messages.push({ role: "user", content: text.slice(0, 2000) });
  }

  for (let step = 0; step < MAX_STEPS; step++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system: systemPrompt(firstName), tools, messages }),
    });
    const data = await r.json();
    try { await logAiUsage(admin, { userId: ctx.userId, fn: "talk-to-prism", model: MODEL, usage: data?.usage, usedOwn: false }); } catch { /* logged best-effort */ }
    if (!r.ok) return json({ error: "Prism could not think just now. Try again in a moment.", detail: data?.error?.message || r.status }, 502);
    const content = data.content || [];
    messages.push({ role: "assistant", content });
    const said = content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ").trim();
    const uses = content.filter((b: any) => b.type === "tool_use");
    if (data.stop_reason !== "tool_use" || !uses.length) return json({ messages, reply: said || "Done." });

    const change = uses.find((b: any) => isWrite(b.name));
    if (change) {
      // Stop and ask. The screen shows this and waits for a yes.
      const t = TOOLS[change.name];
      return json({ messages, reply: said || `Shall I ${t.title.toLowerCase()}?`,
        pending: { tool: change.name, title: t.title, input: change.input, say: said || t.title } });
    }
    const results = [];
    for (const b of uses) {
      const res = await runTool(b.name, b.input, ctx, admin);
      results.push({ type: "tool_result", tool_use_id: b.id, content: res.content, ...(res.is_error ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  return json({ messages, reply: "That took more steps than I expected. Could you ask it a simpler way?" });
});
