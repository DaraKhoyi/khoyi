// quo-call-process
// Turns completed OpenPhone (Quo) calls into:
//   1) a contact timeline entry (contact_interactions, channel 'call'), and
//   2) AI-extracted, owner-attributed, dated follow-up commitments staged for
//      the user to review & approve before they become real tasks.
//
// Reads quo_calls rows that have a transcript or summary and have not been
// processed yet (processed_at IS NULL). Matches the call to a contact by phone
// (last 10 digits). Adds the timeline entry, then asks Claude to pull the
// commitments out of the transcript. Nothing is turned into a task here — the
// proposed_tasks are stored on the call (review_status='pending') and the user
// approves them in the app.
//
// Invoked by pg_cron (every ~10 min) and on demand from the client.
// verify_jwt=false — does its own auth (anon/service bearer, or a valid user JWT).
//
// POST { user_id?, call_id?, limit? } -> { processed, timelined, actions }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const MODEL = "claude-sonnet-4-6";
const FALLBACKS = ["claude-sonnet-4-5", "claude-haiku-4-5"];

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const digits = (s: any) => String(s || "").replace(/[^0-9]/g, "");
const last10 = (s: any) => { const d = digits(s); return d.length >= 10 ? d.slice(-10) : d; };

// OpenPhone payloads vary: arrays of segments, arrays of strings, or plain text.
function toText(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.map((x) => {
      if (typeof x === "string") return x;
      if (x && typeof x === "object") {
        const who = x.speaker || x.identifier || x.userId || x.role || x.type || "";
        const txt = x.content || x.text || x.transcript || "";
        return who && txt ? `${who}: ${txt}` : (txt || JSON.stringify(x));
      }
      return String(x);
    }).join("\n");
  }
  if (typeof v === "object") {
    if (typeof v.summary === "string") return v.summary;
    if (Array.isArray(v.summary)) return v.summary.join("\n");
    if (typeof v.text === "string") return v.text;
    return JSON.stringify(v);
  }
  return String(v);
}

function estToday(): string {
  // America/New_York date for relative-date resolution.
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

function safeJson(text: string): any {
  let t = (text || "").trim();
  t = t.replace(/^```(json)?/i, "").replace(/```$/i, "").trim();
  const a = t.indexOf("{"); const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return JSON.parse(t);
}

async function callClaude(system: string, userMsg: string): Promise<string> {
  const models = [MODEL, ...FALLBACKS];
  let lastErr = "";
  for (const model of models) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1200, system, messages: [{ role: "user", content: userMsg }] }),
      });
      if (!r.ok) { lastErr = `${model}: ${r.status} ${await r.text()}`; continue; }
      const data = await r.json();
      const txt = (data.content || []).map((c: any) => c.text || "").join("").trim();
      if (txt) return txt;
    } catch (e) { lastErr = `${model}: ${e}`; }
  }
  throw new Error(lastErr || "Claude failed");
}

const SYSTEM = `You extract concrete follow-up commitments from a phone call transcript for a real estate broker named Dara ("me"). Output STRICT JSON only — no prose, no markdown.

Shape:
{
  "call_summary": "one or two sentence summary of what the call was about and where it landed",
  "action_items": [
    {
      "owner": "me" | "them",
      "title": "short imperative task, e.g. 'Send the listing agreement to Maria'",
      "due_date": "YYYY-MM-DD or null",
      "priority": "high" | "medium" | "low",
      "note": "brief context, optional"
    }
  ]
}

Rules:
- Only include real commitments or clearly-implied next steps. If nothing was committed, return "action_items": [].
- "owner":"me" = something Dara agreed to do. "owner":"them" = something the other person agreed to do (Dara should track/expect it).
- Resolve relative dates ("by Friday", "next week", "tomorrow") to an absolute YYYY-MM-DD using the provided current date. If no timeframe was given, use null.
- Keep titles short and actionable. Do not invent commitments that were not discussed.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const admin = createClient(SUPABASE_URL, SERVICE);

    // Auth: internal token header (cron) processes all; otherwise a valid user JWT (client) scopes to that user.
    const internalTok = req.headers.get("x-internal-token") || "";
    const INTERNAL = Deno.env.get("QCP_TOKEN") || "";
    let scopedUser: string | null = null;
    if (!(INTERNAL && internalTok === INTERNAL)) {
      if (!token) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      const { data: { user } } = await admin.auth.getUser(token);
      if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
      scopedUser = user.id;
    }

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit) || 25, 50);
    const today = estToday();

    let q = admin.from("quo_calls").select("*").is("processed_at", null).order("op_created_at", { ascending: false }).limit(limit);
    if (body.call_id) q = admin.from("quo_calls").select("*").eq("id", body.call_id).limit(1);
    if (scopedUser) q = q.eq("user_id", scopedUser);
    else if (body.user_id) q = q.eq("user_id", body.user_id);
    const { data: calls, error: callsErr } = await q;
    if (callsErr) throw callsErr;

    let processed = 0, timelined = 0, actions = 0;
    const contactCache: Record<string, any[]> = {};

    for (const call of (calls || [])) {
      const transcript = toText(call.transcript);
      const summary = toText(call.summary);
      const nextSteps = toText(call.next_steps);
      // Need at least something to work with.
      if (!transcript && !summary) continue;

      // ---- match contact by phone (last 10 digits) ----
      const other = call.participant || (String(call.direction || "").toLowerCase().includes("out") ? call.to_number : call.from_number) || call.from_number || call.to_number;
      const key10 = last10(other);
      let contact: any = null;
      if (key10) {
        if (!contactCache[call.user_id]) {
          const { data: cs } = await admin.from("contacts").select("id,name,phone,last_contact_at").eq("user_id", call.user_id).not("phone", "is", null);
          contactCache[call.user_id] = cs || [];
        }
        contact = (contactCache[call.user_id] || []).find((c) => last10(c.phone) === key10) || null;
      }

      const occurredAt = call.completed_at || call.answered_at || call.op_created_at || new Date().toISOString();
      const dir = String(call.direction || "").toLowerCase().includes("out") ? "outbound" : "inbound";
      const durMin = call.duration ? Math.max(1, Math.round(call.duration / 60)) : null;

      // ---- timeline entry (only if matched + not already created) ----
      let interactionId = call.interaction_id || null;
      if (contact && !interactionId) {
        const briefLine = (summary || transcript).split("\n").map((s) => s.trim()).filter(Boolean)[0]?.slice(0, 180) || "Phone call";
        const bodyText = [
          summary ? `Summary:\n${summary}` : "",
          nextSteps ? `Next steps (OpenPhone):\n${nextSteps}` : "",
          transcript ? `Transcript:\n${transcript}` : "",
          call.recording_url ? `Recording: ${call.recording_url}` : "",
        ].filter(Boolean).join("\n\n");
        const { data: ins, error: insErr } = await admin.from("contact_interactions").insert({
          user_id: call.user_id, contact_id: contact.id, channel: "call", direction: dir,
          kind: "call", occurred_at: occurredAt, duration_minutes: durMin,
          brief: `Call (${durMin ? durMin + "m" : "via Quo"}) — ${briefLine}`, body: bodyText,
          entity_type: "quo_call", entity_id: call.id,
        }).select("id").single();
        if (!insErr && ins) {
          interactionId = ins.id; timelined++;
          if (!contact.last_contact_at || new Date(occurredAt) > new Date(contact.last_contact_at)) {
            await admin.from("contacts").update({ last_contact_at: occurredAt }).eq("id", contact.id);
            contact.last_contact_at = occurredAt;
          }
        }
      }

      // ---- extract commitments ----
      let proposed: any[] = [];
      try {
        const userMsg = [
          `Current date: ${today} (America/New_York).`,
          `Call direction: ${dir}. ${contact ? `Other party (contact): ${contact.name}.` : "Other party is not a known contact."}`,
          summary ? `\nOpenPhone summary:\n${summary}` : "",
          nextSteps ? `\nOpenPhone next steps:\n${nextSteps}` : "",
          transcript ? `\nTranscript:\n${transcript.slice(0, 12000)}` : "",
        ].filter(Boolean).join("\n");
        const out = safeJson(await callClaude(SYSTEM, userMsg));
        if (Array.isArray(out.action_items)) {
          proposed = out.action_items
            .filter((a: any) => a && a.title)
            .map((a: any) => ({
              owner: a.owner === "them" ? "them" : "me",
              title: String(a.title).slice(0, 200),
              due_date: /^\d{4}-\d{2}-\d{2}$/.test(a.due_date || "") ? a.due_date : null,
              priority: ["high", "medium", "low"].includes(a.priority) ? a.priority : "medium",
              note: a.note ? String(a.note).slice(0, 400) : "",
              status: "pending",
            }));
        }
      } catch (_e) { /* extraction optional — timeline still recorded */ }

      actions += proposed.length;
      const reviewStatus = proposed.length ? "pending" : "done";
      await admin.from("quo_calls").update({
        contact_id: contact ? contact.id : null,
        interaction_id: interactionId,
        proposed_tasks: proposed,
        review_status: reviewStatus,
        processed_at: new Date().toISOString(),
      }).eq("id", call.id);
      processed++;
    }

    return new Response(JSON.stringify({ processed, timelined, actions }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
