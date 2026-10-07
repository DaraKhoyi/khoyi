// quo-webhook
// Public endpoint that Quo (OpenPhone) calls on every message, call, summary
// and transcript event. Writes everything into quo_messages / quo_calls under
// the workspace owner's user_id.
//
// AUTH (changed 7 Oct 2026). It used to be gated only by a ?token= in the URL,
// and Supabase writes every request URL into the edge logs. Quo signs every
// delivery, so the signature is now the proof:
//   - legacy (v1 webhooks): header openphone-signature: hmac;1;<ms>;<base64>,
//     HMAC-SHA256 over "<ms>.<raw body>" with the base64-decoded signing key;
//   - current API: webhook-id / webhook-timestamp / webhook-signature
//     (Standard Webhooks), HMAC-SHA256 over "<id>.<ts>.<raw body>", key whsec_...
// Keys: QUO_WEBHOOK_SIGNING_KEYS, comma-separated (each Quo webhook has its own).
// The URL token still works during the cutover; QUO_ALLOW_URL_TOKEN=false ends it.
//
// Deploy with verify_jwt = false (external caller, no Supabase auth header).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Normalize phone numbers to last-10-digits for matching against contacts.
const _digits = (s: any) => String(s || "").replace(/[^0-9]/g, "");
const _last10 = (s: any) => { const d = _digits(s); return d.length >= 10 ? d.slice(-10) : d; };

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length === 0) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}
async function hmacB64(keyBytes: Uint8Array, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  let bin = ""; for (const c of sig) bin += String.fromCharCode(c);
  return btoa(bin);
}
const MAX_SKEW_MS = 30 * 60 * 1000; // generous: Quo retries; a replay older than this is refused

// Which door did this delivery come through? null = refused.
async function authorize(req: Request, url: URL, raw: string): Promise<"signature" | "url-token" | null> {
  const keys = (Deno.env.get("QUO_WEBHOOK_SIGNING_KEYS") || "").split(",").map((k) => k.trim()).filter(Boolean);
  const now = Date.now();
  if (keys.length) {
    // Legacy OpenPhone scheme.
    const legacy = req.headers.get("openphone-signature");
    if (legacy) {
      const [scheme, version, ts, sig] = legacy.split(";");
      const tsMs = Number(ts);
      if (scheme === "hmac" && version === "1" && sig && Number.isFinite(tsMs) && Math.abs(now - tsMs) <= MAX_SKEW_MS) {
        // Quo's docs say the payload is signed compact; sign both forms so a
        // whitespace difference can never refuse a real delivery.
        let compact = raw; try { compact = JSON.stringify(JSON.parse(raw)); } catch { /* not JSON */ }
        for (const k of keys) {
          let kb: Uint8Array; try { kb = b64ToBytes(k.replace(/^whsec_/, "")); } catch { continue; }
          for (const body of compact === raw ? [raw] : [raw, compact]) {
            if (safeEqual(await hmacB64(kb, `${ts}.${body}`), sig)) return "signature";
          }
        }
      }
    }
    // Current Quo API (Standard Webhooks).
    const wid = req.headers.get("webhook-id"), wts = req.headers.get("webhook-timestamp"), wsig = req.headers.get("webhook-signature");
    if (wid && wts && wsig && Math.abs(now - Number(wts) * 1000) <= MAX_SKEW_MS) {
      const given = wsig.split(" ").map((p) => p.split(",")[1]).filter(Boolean);
      for (const k of keys) {
        let kb: Uint8Array; try { kb = b64ToBytes(k.replace(/^whsec_/, "")); } catch { continue; }
        const want = await hmacB64(kb, `${wid}.${wts}.${raw}`);
        if (given.some((g) => safeEqual(g, want))) return "signature";
      }
    }
  }
  const allowUrlToken = (Deno.env.get("QUO_ALLOW_URL_TOKEN") || "true").toLowerCase() !== "false";
  const legacyToken = Deno.env.get("QUO_WEBHOOK_TOKEN") || "";
  if (allowUrlToken && legacyToken && safeEqual(url.searchParams.get("token") || "", legacyToken)) return "url-token";
  return null;
}

serve(async (req) => {
  const url = new URL(req.url);
  // The signature covers the exact bytes, so read them before parsing.
  const raw = await req.text();
  const via = await authorize(req, url, raw);
  if (!via) {
    console.warn("quo-webhook: refused (no valid signature or URL token)");
    return new Response("forbidden", { status: 403 });
  }
  console.log(`quo-webhook auth=${via}`);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 200 }); }

  const type: string = evt?.type || "";
  const o = evt?.data?.object || {};

  // Resolve owner by the phone LINE the event actually happened on — NOT by
  // "whoever touched settings last". OpenPhone sends phoneNumberId on every
  // message/call; the owner is the user who has that line selected in their
  // quo_settings. This is what prevents one agent's calls/recordings from being
  // filed under another agent's account on a shared workspace.
  //
  // ORDER MATTERS. QUO_OWNER_USER_ID used to be read FIRST, which silently
  // defeated all of the per-line logic below — every event on every line landed
  // in one account no matter whose line it was. It is now the LAST resort, used
  // only when we genuinely cannot tell which line an event came in on (e.g.
  // traffic from a line that has since been deleted from the workspace, which
  // has really happened here). Per-line attribution wins whenever it can answer.
  let owner: string | null = null;
  const pnId: string | null = o.phoneNumberId || null;
  if (pnId) {
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
  // Configured fallback — an explicit "when in doubt, file it here" for a single
  // -operator workspace. Logged loudly, because if this fires often it means a
  // line needs mapping in quo_settings, not that the fallback is doing its job.
  if (!owner) {
    owner = Deno.env.get("QUO_OWNER_USER_ID") || null;
    if (owner) console.warn("quo-webhook: no line mapping for phoneNumberId=", pnId, "— falling back to QUO_OWNER_USER_ID. Map this line in quo_settings.");
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
      // Seen before? (Quo retries, and during the webhook cutover the old and the
      // new webhook both deliver.) A repeat must not draft a second first reply.
      const { data: seen } = await supabase.from("quo_messages").select("op_id").eq("op_id", o.id).maybeSingle();
      await supabase.from("quo_messages").upsert(row, { onConflict: "op_id" });

      // ── 5-Minute Lead Concierge ──────────────────────────────────────────
      // A brand-new inbound (a lead reaching out) is the speed-to-lead moment.
      // Fire the concierge: draft a first reply in the agent's voice + push them.
      // Only on genuine INCOMING messages, and only for numbers that aren't an
      // established contact (a known client texting isn't a "new lead").
      if (!seen && row.direction === "incoming" && row.from_number) {
        try {
          const last10 = String(row.from_number).replace(/\D/g, "").slice(-10);
          let contactId: string | null = null, leadName: string | null = null, isEstablished = false;
          if (last10.length === 10) {
            const { data: c } = await supabase.from("contacts")
              .select("id, name, type, created_at, last_outbound_at")
              .eq("user_id", owner).ilike("phone", "%" + last10 + "%").limit(1).maybeSingle();
            if (c) {
              contactId = c.id; leadName = c.name || null;
              // "established" = we've reached out before, or it's a non-lead type
              isEstablished = !!c.last_outbound_at || (c.type && !["lead", "prospect", "new"].includes(String(c.type).toLowerCase()));
            }
          }
          // ONE VERDICT FOR A TEXT (sms_lead_verdict): machines are never leads —
          // two Roomvu Zoom reminders became "new lead" cards with a drafted
          // "wrong number" reply addressed to a robot; a number marked "not a
          // lead" stays marked (texts never checked before); and a text to the
          // broker's own line is routed to the brokerage queue only when it states
          // real-estate intent, never made into a personal card.
          let verdict: any = { action: "card" };
          if (!isEstablished) {
            const { data: v } = await supabase.rpc("sms_lead_verdict", { p_user: owner, p_from: row.from_number, p_body: row.body || "" });
            if (v) verdict = v;
            if (verdict.action === "route") {
              const { error: rErr } = await supabase.from("brokerage_leads").upsert({
                received_by: owner, source: "Text to the broker", channel: "sms",
                lead_name: leadName, lead_phone: row.from_number, subject: "Text message",
                excerpt: String(row.body || "").slice(0, 700), provider_message_id: "sms:" + row.op_id,
              }, { onConflict: "provider_message_id", ignoreDuplicates: true });
              if (rErr) console.error("[brokerage_leads] sms route failed", rErr.message);
            }
          }
          if (!isEstablished && verdict.action === "card") {
            await supabase.functions.invoke("lead-concierge", { body: {
              user_id: owner, contact_id: contactId, lead_name: leadName,
              lead_phone: row.from_number, channel: "sms", inbound_text: row.body || null,
            } });
          }
        } catch (_e) { /* concierge is best-effort; never block the webhook */ }
      }
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
      // call.recording.completed carries the audio. Quo/OpenPhone sends it as
      // `recordings` — PLURAL, an ARRAY of { id, url, type, duration, startTime }.
      // We used to look for `media` / `recording` / `recordingUrl`, none of which
      // Quo has ever sent, so recording_url was NULL on every row ever written
      // while the URL sat unread in raw.recordings[0].url. Keep the singular
      // fallbacks for safety, but read the real field FIRST.
      const recArr = Array.isArray(o.recordings) ? o.recordings : null;
      const media = (recArr && recArr.length ? recArr[0] : null) || o.media || o.recording || o.recordingUrl;
      const mediaUrl = typeof media === "string" ? media : (media?.url || media?.media || null);
      // Only WRITE the url when we have one. A later call.* event for the same
      // call (e.g. call.completed arriving after call.recording.completed) must
      // not blank out a recording we already captured.
      if (mediaUrl) row.recording_url = mediaUrl;
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
