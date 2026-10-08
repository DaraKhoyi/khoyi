// quo-webhook
// Public endpoint that Quo (OpenPhone) calls on every message, call, summary
// and transcript event. Writes everything into quo_messages / quo_calls under
// the LINE owner's user_id (_shared/quoOwner.ts).
//
// AUTH (changed 7 Oct 2026). It used to be gated only by a ?token= in the URL,
// and Supabase writes every request URL into the edge logs. Quo signs every
// delivery, so the signature is now the proof:
//   - legacy (v1 webhooks): header openphone-signature: hmac;1;<ms>;<base64>,
//     HMAC-SHA256 over "<ms>.<raw body>" with the base64-decoded signing key;
//   - current API: webhook-id / webhook-timestamp / webhook-signature
//     (Standard Webhooks), HMAC-SHA256 over "<id>.<ts>.<raw body>", key whsec_...
// Keys, in order:
//   1) QUO_WEBHOOK_SIGNING_KEYS, comma-separated (each Quo webhook has its own);
//   2) if that secret is empty (v26, 8 Oct 2026): fetched at runtime from Quo's
//      legacy webhook list (GET /v1/webhooks, which returns each hook's `key`)
//      with QUO_API_KEY, keeping only hooks whose URL is this function's address.
//      Held in memory for 10 min; refreshed once on a signature mismatch (at most
//      once a minute, so forged requests can't make us hammer Quo's API).
//      Keys are never logged or returned — only their count.
// The URL token still works during the cutover; QUO_ALLOW_URL_TOKEN=false ends it.
//
// Deploy with verify_jwt = false (external caller, no Supabase auth header).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { QuoOwners } from "../_shared/quoOwner.ts";

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

// ── Signing keys from Quo's API (only when QUO_WEBHOOK_SIGNING_KEYS is empty) ──
const QUO_API = "https://api.openphone.com";
const KEY_TTL_MS = 10 * 60 * 1000;      // normal cache life
const MIN_REFETCH_MS = 60 * 1000;       // floor between fetches (mismatch refresh or failure retry)
let apiKeys: string[] = [];
let apiKeysAt = 0;                      // when the last successful fetch landed
let lastFetchTry = 0;                   // when we last tried at all (success or not)

function normUrl(u: string): string {
  try { const x = new URL(u); return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "")}`; }
  catch { return ""; }
}
export function hookAddress(): string {
  return normUrl(`${Deno.env.get("SUPABASE_URL") || ""}/functions/v1/quo-webhook`);
}
async function fetchApiKeys(): Promise<void> {
  lastFetchTry = Date.now();
  const apiKey = Deno.env.get("QUO_API_KEY") || "";
  if (!apiKey) { console.warn("quo-webhook keys: QUO_API_KEY missing; signature check unavailable"); return; }
  try {
    const r = await fetch(`${QUO_API}/v1/webhooks`, {
      headers: { Authorization: apiKey, "User-Agent": "KhoyiApp/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) { try { await r.body?.cancel(); } catch { /* */ } console.warn(`quo-webhook keys: Quo list returned ${r.status}; keeping ${apiKeys.length} cached`); return; }
    const j: any = await r.json().catch(() => null);
    const mine = hookAddress();
    const keys = (Array.isArray(j?.data) ? j.data : [])
      .filter((w: any) => w && typeof w.key === "string" && w.key && normUrl(String(w.url || "")) === mine)
      .map((w: any) => String(w.key).trim());
    apiKeys = [...new Set(keys)] as string[];
    apiKeysAt = Date.now();
    console.log(`quo-webhook keys: loaded ${apiKeys.length} from Quo API`);
  } catch (e) {
    console.warn(`quo-webhook keys: Quo list failed (${(e as Error)?.name || "error"}); keeping ${apiKeys.length} cached`);
  }
}
// force=true: a signature didn't match; refresh unless we fetched very recently.
async function getApiKeys(force = false): Promise<{ keys: string[]; refreshed: boolean }> {
  const now = Date.now();
  const stale = !apiKeysAt || now - apiKeysAt > KEY_TTL_MS;
  const allowed = now - lastFetchTry >= MIN_REFETCH_MS;
  if ((stale || force) && (allowed || !lastFetchTry)) { await fetchApiKeys(); return { keys: apiKeys, refreshed: true }; }
  return { keys: apiKeys, refreshed: false };
}
// Test hook only: lets the offline tests start each case with an empty cache.
export function _resetKeyCache() { apiKeys = []; apiKeysAt = 0; lastFetchTry = 0; }

async function signatureMatches(req: Request, raw: string, keys: string[]): Promise<boolean> {
  if (!keys.length) return false;
  const now = Date.now();
  // Legacy OpenPhone scheme.
  const legacy = req.headers.get("openphone-signature");
  if (legacy) {
    const [scheme, version, ts, sig] = legacy.split(";");
    const tsMs = Number(ts);
    if (scheme === "hmac" && version === "1" && sig && Number.isFinite(tsMs) && Math.abs(now - tsMs) <= MAX_SKEW_MS) {
      // Quo's docs say the payload is signed compact; sign both forms so a
      // whitespace difference can never refuse a real delivery.
      let compact = raw; try { compact = JSON.stringify(JSON.parse(raw)); } catch { /* not JSON */ }
      // "Future versions may include multiple signatures separated by commas."
      const given = sig.split(",").map((s) => s.trim()).filter(Boolean);
      for (const k of keys) {
        let kb: Uint8Array; try { kb = b64ToBytes(k.replace(/^whsec_/, "")); } catch { continue; }
        for (const body of compact === raw ? [raw] : [raw, compact]) {
          const want = await hmacB64(kb, `${ts}.${body}`);
          if (given.some((g) => safeEqual(want, g))) return true;
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
      if (given.some((g) => safeEqual(g, want))) return true;
    }
  }
  return false;
}

type Via = "signature" | "url-token";
// Which door did this delivery come through? null = refused.
async function authorize(req: Request, url: URL, raw: string): Promise<{ via: Via; keys?: "env" | "api" } | null> {
  const hasSig = !!(req.headers.get("openphone-signature") || req.headers.get("webhook-signature"));
  if (hasSig) {
    const envKeys = (Deno.env.get("QUO_WEBHOOK_SIGNING_KEYS") || "").split(",").map((k) => k.trim()).filter(Boolean);
    if (envKeys.length) {
      if (await signatureMatches(req, raw, envKeys)) return { via: "signature", keys: "env" };
    } else {
      const first = await getApiKeys(false);
      if (await signatureMatches(req, raw, first.keys)) return { via: "signature", keys: "api" };
      // Mismatch: a webhook may have been created since we cached. Refresh once.
      if (!first.refreshed) {
        const again = await getApiKeys(true);
        if (again.refreshed && await signatureMatches(req, raw, again.keys)) return { via: "signature", keys: "api" };
      }
    }
  }
  const allowUrlToken = (Deno.env.get("QUO_ALLOW_URL_TOKEN") || "true").toLowerCase() !== "false";
  const legacyToken = Deno.env.get("QUO_WEBHOOK_TOKEN") || "";
  if (allowUrlToken && legacyToken && safeEqual(url.searchParams.get("token") || "", legacyToken)) return { via: "url-token" };
  return null;
}

serve(async (req) => {
  const url = new URL(req.url);
  // The signature covers the exact bytes, so read them before parsing.
  const raw = await req.text();
  const auth = await authorize(req, url, raw);
  if (!auth) {
    console.warn("quo-webhook: refused (no valid signature or URL token)");
    return new Response("forbidden", { status: 403 });
  }
  // url=token|bare says which webhook delivered it (the token's VALUE is never logged).
  // keys=env|api says where the signing key came from. Both drive the cutover checks.
  const urlKind = url.searchParams.has("token") ? "token" : "bare";
  console.log(`quo-webhook auth=${auth.via}${auth.keys ? ` keys=${auth.keys}` : ""} url=${urlKind}`);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 200 }); }

  const type: string = evt?.type || "";
  const o = evt?.data?.object || {};

  // Resolve owner by the phone LINE the event actually happened on — NOT by
  // "whoever touched settings last" and never by who happens to be signed in.
  // One rule shared with quo-sync (_shared/quoOwner.ts, 8 Oct 2026): the user
  // who has the line selected in quo_settings, then a saved active_number
  // match, then QUO_OWNER_USER_ID. A row that already exists keeps its owner
  // (the quo_keep_owner trigger refuses to change user_id on update).
  const pnId: string | null = o.phoneNumberId || null;
  const who = await new QuoOwners(supabase).resolve(pnId, [o.from, Array.isArray(o.to) ? o.to[0] : o.to]);
  const owner = who.owner;
  if (who.via === "fallback") console.warn("quo-webhook: no line mapping for phoneNumberId=", pnId, "— falling back to QUO_OWNER_USER_ID. Map this line in quo_settings.");
  // Last resort: if we still can't tell whose line it is, DROP the event rather
  // than misattribute it to an arbitrary account.
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
      // v26: decided by the database, atomically. During the swap the old and the
      // new webhook deliver the SAME event within milliseconds; the v25 "select,
      // then upsert" let both see "not seen" and could draft two replies. Insert
      // with ON CONFLICT DO NOTHING: exactly one delivery gets the row back.
      let seen = false;
      const ins = await supabase.from("quo_messages").upsert(row, { onConflict: "op_id", ignoreDuplicates: true }).select("op_id");
      if (ins.error) {
        // Fall back to the v25 path rather than lose the message.
        const { data: s } = await supabase.from("quo_messages").select("op_id").eq("op_id", o.id).maybeSingle();
        seen = !!s;
        await supabase.from("quo_messages").upsert(row, { onConflict: "op_id" });
      } else if (!ins.data || ins.data.length === 0) {
        seen = true;
        // Already there (retry, overlap, or backfill): refresh its fields as v25 did.
        await supabase.from("quo_messages").upsert(row, { onConflict: "op_id" });
      }

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
