// quo-webhook
// Public endpoint that Quo (OpenPhone) calls on every message, call, summary
// and transcript event. Token-gated via the ?token= query param (matched against
// QUO_WEBHOOK_TOKEN) since Quo can't send a Supabase JWT. Writes everything into
// quo_messages / quo_calls under the workspace owner's user_id.
//
// Deploy with verify_jwt = false (external caller, no Supabase auth header).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token || token !== Deno.env.get("QUO_WEBHOOK_TOKEN")) {
    return new Response("forbidden", { status: 403 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve owner: explicit secret first, else the most recent quo_settings row.
  let owner = Deno.env.get("QUO_OWNER_USER_ID") || null;
  if (!owner) {
    const { data } = await supabase.from("quo_settings").select("user_id").order("updated_at", { ascending: false }).limit(1).maybeSingle();
    owner = data?.user_id || null;
  }
  if (!owner) return new Response("no owner configured", { status: 200 });

  let evt: any;
  try { evt = await req.json(); } catch { return new Response("bad json", { status: 200 }); }

  const type: string = evt?.type || "";
  const o = evt?.data?.object || {};

  try {
    if (type.startsWith("message.")) {
      const toArr = Array.isArray(o.to) ? o.to : (o.to ? [o.to] : []);
      const row = {
        user_id: owner,
        op_id: o.id,
        conversation_id: o.conversationId || null,
        phone_number_id: o.phoneNumberId || null,
        direction: o.direction || (type === "message.received" ? "incoming" : "outgoing"),
        from_number: o.from || null,
        to_number: toArr[0] || null,
        body: o.text ?? o.body ?? "",
        status: o.status || null,
        op_created_at: o.createdAt || new Date().toISOString(),
        raw: o,
      };
      await supabase.from("quo_messages").upsert(row, { onConflict: "op_id" });
    } else if (type === "callSummary" || type === "call.summary.completed") {
      await supabase.from("quo_calls").update({
        summary: o.summary ?? null,
        next_steps: o.nextSteps ?? null,
        updated_at: new Date().toISOString(),
      }).eq("op_id", o.callId);
      // If the call row doesn't exist yet, create a stub so the summary isn't lost.
      const { data: exists } = await supabase.from("quo_calls").select("id").eq("op_id", o.callId).maybeSingle();
      if (!exists) {
        await supabase.from("quo_calls").upsert({
          user_id: owner, op_id: o.callId, summary: o.summary ?? null, next_steps: o.nextSteps ?? null, raw: o,
        }, { onConflict: "op_id" });
      }
    } else if (type === "callTranscript" || type === "call.transcript.completed") {
      await supabase.from("quo_calls").update({
        transcript: o.dialogue ?? null,
        updated_at: new Date().toISOString(),
      }).eq("op_id", o.callId);
      const { data: exists } = await supabase.from("quo_calls").select("id").eq("op_id", o.callId).maybeSingle();
      if (!exists) {
        await supabase.from("quo_calls").upsert({
          user_id: owner, op_id: o.callId, transcript: o.dialogue ?? null, raw: o,
        }, { onConflict: "op_id" });
      }
    } else if (type.startsWith("call.")) {
      const parts = Array.isArray(o.participants) ? o.participants : [];
      const row: Record<string, unknown> = {
        user_id: owner,
        op_id: o.id,
        phone_number_id: o.phoneNumberId || null,
        direction: o.direction || null,
        participant: parts[0] || null,
        status: o.status || null,
        duration: typeof o.duration === "number" ? o.duration : null,
        answered_at: o.answeredAt || null,
        completed_at: o.completedAt || null,
        op_created_at: o.createdAt || new Date().toISOString(),
        raw: o,
      };
      // call.recording.completed carries recording media
      const media = o.media || o.recording || o.recordingUrl;
      if (media) row.recording_url = typeof media === "string" ? media : (media.url || media.media || null);
      row.updated_at = new Date().toISOString();
      await supabase.from("quo_calls").upsert(row, { onConflict: "op_id" });
    }
  } catch (err) {
    console.error("quo-webhook error", String(err));
  }
  // Always 200 so Quo doesn't retry-storm us.
  return new Response("ok", { status: 200 });
});
