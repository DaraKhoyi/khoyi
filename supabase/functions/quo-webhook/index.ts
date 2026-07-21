// quo-webhook
// Public endpoint that Quo (OpenPhone) calls on every message, call, summary
// and transcript event. Token-gated via the ?token= query param (matched against
// QUO_WEBHOOK_TOKEN) since Quo can't send a Supabase JWT. Writes everything into
// quo_messages / quo_calls under the workspace owner's user_id.
//
// Deploy with verify_jwt = false (external caller, no Supabase auth header).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Normalize phone numbers to last-10-digits for matching against contacts.
const _digits = (s: any) => String(s || "").replace(/[^0-9]/g, "");
const _last10 = (s: any) => { const d = _digits(s); return d.length >= 10 ? d.slice(-10) : d; };

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

  let evt: any;
  try { evt = await req.json(); } catch { return new Response("bad json", { status: 200 }); }

  const type: string = evt?.type || "";
  const o = evt?.data?.object || {};

  // Resolve owner by the phone LINE the event actually happened on — NOT by
  // "whoever touched settings last". OpenPhone sends phoneNumberId on every
  // message/call; the owner is the user who has that line selected in their
  // quo_settings. This is what prevents one agent's calls/recordings from being
  // filed under another agent's account on a shared workspace.
  let owner: string | null = Deno.env.get("QUO_OWNER_USER_ID") || null;
  const pnId: string | null = o.phoneNumberId || null;
  if (!owner && pnId) {
    const { data: byLine } = await supabase.from("quo_settings")
      .select("user_id").eq("active_phone_number_id", pnId).limit(1).maybeSingle();
    owner = byLine?.user_id || null;
  }
  // Fallback: match by the actual phone NUMBER on the event (from/to) against
  // any user's saved active_number, in case phoneNumberId isn't present.
  if (!owner) {
    const cand = _last10(o.from) || _last10((Array.isArray(o.to) ? o.to[0] : o.to));
    if (cand) {
      const { data: rows } = await supabase.from("quo_settings").select("user_id, active_number");
      const hit = (rows || []).find((r: any) => _last10(r.active_number) === cand);
      owner = hit?.user_id || null;
    }
  }
  // Last resort: if we still can't tell whose line it is, DROP the event rather
  // than misattribute it to an arbitrary account. Silent misfiling (the old
  // "most recent quo_settings" behaviour) is exactly the cross-account leak we're
  // fixing — better to skip than to file a recording under the wrong person.
  if (!owner) {
    console.error("quo-webhook: could not resolve owner for phoneNumberId=", pnId, "— dropping event to avoid misattribution");
    return new Response("no owner for this line — skipped", { status: 200 });
  }

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
      const { data: exists } = await supabase.from("quo_calls").select("id, contact_id, processed_at").eq("op_id", o.callId).maybeSingle();
      if (!exists) {
        await supabase.from("quo_calls").upsert({
          user_id: owner, op_id: o.callId, transcript: o.dialogue ?? null, raw: o,
        }, { onConflict: "op_id" });
      } else if (exists.contact_id && exists.processed_at) {
        // The call was already processed (e.g. from its summary) before this
        // transcript arrived — quo-call-process won't revisit it, so queue a
        // DISC refresh now so the spoken-word signal isn't lost.
        try {
          const { data: pend } = await supabase.from("disc_analysis_queue").select("id").eq("contact_id", exists.contact_id).eq("status", "pending").limit(1);
          if (!pend || !pend.length) await supabase.from("disc_analysis_queue").insert({ user_id: owner, contact_id: exists.contact_id, reason: "call_transcript", priority: 3, status: "pending", queued_at: new Date().toISOString() });
        } catch (_e) { /* best-effort */ }
      }
    } else if (type.startsWith("call.")) {
      const parts = Array.isArray(o.participants) ? o.participants : [];
      const isOut = String(o.direction || "").toLowerCase().includes("out");
      // The external party: OpenPhone orders participants as [caller, callee].
      // Outgoing → owner is first, external is last; Incoming → external is first.
      const external = (parts.length >= 2 ? (isOut ? parts[parts.length - 1] : parts[0]) : parts[0]) || null;
      const fromNum = o.from || (isOut ? (parts[0] || null) : external);
      const toNum = (typeof o.to === "string" ? o.to : (Array.isArray(o.to) ? o.to[0] : null)) || (isOut ? external : (parts[parts.length - 1] || null));
      const row: Record<string, unknown> = {
        user_id: owner,
        op_id: o.id,
        phone_number_id: o.phoneNumberId || null,
        direction: o.direction || null,
        participant: external,
        from_number: fromNum,
        to_number: toNum,
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
      // Link to a contact by phone (last 10 digits) so EVERY call attaches to the
      // right person — even plain calls with no recording/transcript.
      const key10 = _last10(external);
      if (key10) {
        const { data: cs } = await supabase.from("contacts").select("id,phone").eq("user_id", owner).not("phone", "is", null);
        const match = (cs || []).find((c: any) => _last10(c.phone) === key10);
        if (match) row.contact_id = match.id;
      }
      row.updated_at = new Date().toISOString();
      await supabase.from("quo_calls").upsert(row, { onConflict: "op_id" });
    }
  } catch (err) {
    console.error("quo-webhook error", String(err));
  }
  // Always 200 so Quo doesn't retry-storm us.
  return new Response("ok", { status: 200 });
});
