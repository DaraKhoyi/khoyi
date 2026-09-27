// task-email-ingest
// Scans inbound email replies that belong to email-assigned tracker tasks,
// classifies each with Claude (completed/rejected/update/question/unclear),
// logs them to tracker.task_messages, and applies high-confidence status
// changes. Ambiguous replies are flagged needs_review (no status change).
// Invoked by cron every 5 minutes (no body required).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const CONF = 0.8; // confidence threshold for auto-applying a status change

// Strip quoted history / signatures so Claude sees only the new reply text.
function topReply(text: string): string {
  if (!text) return "";
  const lines = text.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  const stop = [
    /^On .*wrote:$/i, /^-----Original Message-----/i, /^From: .*/i,
    /^Sent from my /i, /^________________________________/, /^>.*/,
  ];
  for (const ln of lines) {
    if (stop.some((re) => re.test(ln.trim()))) break;
    out.push(ln);
  }
  let r = out.join("\n").trim();
  // Drop a trailing signature after a "-- " delimiter
  const sig = r.indexOf("\n-- ");
  if (sig > 0) r = r.slice(0, sig).trim();
  return r.slice(0, 4000);
}

async function classify(taskTitle: string, replyText: string) {
  const sys =
    "You read a single email reply about a work task and classify the sender's intent. " +
    "Respond ONLY with compact JSON, no prose, no markdown. " +
    'Schema: {"intent":"completed|rejected|update|question|unclear","confidence":0..1,"note":"one short sentence summarizing what they said"}. ' +
    "completed = they indicate the task is done. rejected = they decline or cannot/will not do it. " +
    "update = progress or status info but not done. question = they ask something or need info. " +
    "unclear = anything ambiguous. Be conservative: if not clearly done or clearly declined, do not use completed/rejected.";
  const user = `Task: ${taskTitle}\n\nTheir reply:\n${replyText}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system: sys,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  let txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
  txt = txt.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(txt);
  return {
    intent: String(parsed.intent || "unclear"),
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
    note: String(parsed.note || "").slice(0, 500),
    usage: j?.usage || null,   // returned, not stored globally: billed per task owner by the caller
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const result = { processed: 0, applied: 0, flagged: 0, tasks_scanned: 0, errors: [] as string[] };

  try {
    // Email-assigned tasks that still have a live thread and aren't closed out.
    const { data: tasks, error: te } = await supabase
      .schema("tracker").from("tasks")
      .select("id,title,status,email_thread_id,assignee_email,created_by")
      .eq("assignment_method", "email")
      .not("email_thread_id", "is", null);
    if (te) throw te;
    result.tasks_scanned = (tasks || []).length;

    for (const t of tasks || []) {
      if (!t.email_thread_id || !t.assignee_email) continue;
      // Their replies in this thread (sender match = verification + inbound filter)
      const { data: msgs } = await supabase
        .from("email_messages")
        .select("provider_message_id,provider_thread_id,from_address,subject,body_text,snippet,internal_date")
        .eq("provider_thread_id", t.email_thread_id)
        .ilike("from_address", `%${t.assignee_email}%`)
        .order("internal_date", { ascending: true });
      if (!msgs || !msgs.length) continue;

      // Which have we already logged?
      const { data: seen } = await supabase
        .schema("tracker").from("task_messages")
        .select("email_message_id").eq("task_id", t.id).eq("direction", "in");
      const seenIds = new Set((seen || []).map((s: any) => s.email_message_id));

      for (const m of msgs) {
        if (seenIds.has(m.provider_message_id)) continue;
        const reply = topReply(m.body_text || m.snippet || "");
        let ai: any = { intent: "unclear", confidence: 0, note: "" };
        try {
          ai = await classify(t.title, reply);
          // Cost attribution (added 26 Sep): billed to whoever assigned the task.
          await logAiUsage(supabase, { userId: t.created_by, fn: "task-email-ingest", model: MODEL, usage: ai.usage, usedOwn: false });
        }
        catch (e) { result.errors.push(`classify ${t.id}: ${String(e).slice(0, 120)}`); }

        let applied = false, needsReview = false, newStatus: string | null = null;
        if (ai.intent === "completed" && ai.confidence >= CONF) { newStatus = "done"; applied = true; needsReview = true; }
        else if (ai.intent === "rejected" && ai.confidence >= CONF) { newStatus = "rejected"; applied = true; needsReview = true; }
        else if (ai.intent === "update" && ai.confidence >= CONF) { newStatus = (t.status === "todo" ? "in_progress" : null); applied = true; }
        else { needsReview = true; } // question / unclear / low-confidence -> review queue

        await supabase.schema("tracker").from("task_messages").insert({
          task_id: t.id, direction: "in", email_message_id: m.provider_message_id,
          thread_id: m.provider_thread_id, from_address: m.from_address, subject: m.subject,
          body_excerpt: reply.slice(0, 600), ai_intent: ai.intent, ai_confidence: ai.confidence,
          ai_note: ai.note, applied, needs_review: needsReview,
        });

        const patch: any = { last_reply_at: new Date().toISOString(), last_reply_excerpt: reply.slice(0, 300) };
        if (newStatus) patch.status = newStatus;
        await supabase.schema("tracker").from("tasks").update(patch).eq("id", t.id);

        result.processed++;
        if (applied && newStatus) result.applied++;
        if (needsReview) result.flagged++;
        seenIds.add(m.provider_message_id);
      }
    }

    // ---- public.tasks assigned by email (personal tasks) ----
    const { data: ptasks } = await supabase.from("tasks")
      .select("id,title,email_thread_id,assignee_email,last_processed_message_id,user_id")
      .eq("assignment_method", "email").not("email_thread_id", "is", null);
    for (const t of ptasks || []) {
      if (!t.email_thread_id || !t.assignee_email) continue;
      const { data: msgs } = await supabase.from("email_messages")
        .select("provider_message_id,from_address,body_text,snippet,internal_date")
        .eq("provider_thread_id", t.email_thread_id)
        .ilike("from_address", `%${t.assignee_email}%`)
        .order("internal_date", { ascending: true });
      if (!msgs || !msgs.length) continue;
      const last = msgs[msgs.length - 1];
      if (last.provider_message_id === t.last_processed_message_id) continue; // already handled
      const reply = topReply(last.body_text || last.snippet || "");
      let ai: any = { intent: "unclear", confidence: 0, note: "" };
      try {
        ai = await classify(t.title, reply);
        await logAiUsage(supabase, { userId: t.user_id, fn: "task-email-ingest", model: MODEL, usage: ai.usage, usedOwn: false });
      }
      catch (e) { result.errors.push(`pub classify ${t.id}: ${String(e).slice(0,120)}`); }
      // Personal tasks: suggest-and-confirm only (never silently change the board).
      await supabase.from("tasks").update({
        last_reply_at: new Date().toISOString(),
        last_reply_excerpt: reply.slice(0, 300),
        reply_intent: ai.intent, reply_confidence: ai.confidence,
        reply_needs_review: true, last_processed_message_id: last.provider_message_id,
      }).eq("id", t.id);
      result.processed++; result.flagged++;
    }

    return new Response(JSON.stringify({ ok: true, ...result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err), ...result }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
