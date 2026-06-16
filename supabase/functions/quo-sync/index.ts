// quo-sync
// Two jobs, idempotent:
//  1) Ensure the four Quo webhooks (messages, calls, summaries, transcripts) exist,
//     pointing at quo-webhook?token=... — created once, skipped thereafter.
//  2) Backfill recent messages + calls from the Quo API into quo_messages / quo_calls,
//     so the live feed isn't empty on day one.
//
// Deploy with verify_jwt = true. Callable by a signed-in user, or by a service-role
// caller passing { user_id } (mirrors gmail-send's trusted-internal pattern).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const QUO = "https://api.openphone.com";

async function quo(path: string, key: string, opts: RequestInit = {}) {
  const r = await fetch(`${QUO}${path}`, {
    ...opts,
    headers: { "Authorization": key, "Content-Type": "application/json", "User-Agent": "KhoyiApp/1.0", ...(opts.headers || {}) },
  });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  return { ok: r.ok, status: r.status, json: j };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    const tokenStr = authHeader.replace("Bearer ", "");
    let user = (await supabase.auth.getUser(tokenStr)).data.user;
    if (!user && tokenStr === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") && body?.user_id) user = { id: body.user_id } as any;
    if (!user) return J({ ok: false, error: "Not authenticated" }, 401);

    const apiKey = Deno.env.get("QUO_API_KEY");
    if (!apiKey) return J({ ok: false, error: "QUO_API_KEY missing" }, 500);
    const hookToken = Deno.env.get("QUO_WEBHOOK_TOKEN");
    const hookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/quo-webhook?token=${hookToken}`;

    // ── 1) Ensure webhooks ───────────────────────────────────────────────
    const wantedHooks: Array<{ path: string; events: string[] }> = [
      { path: "/v1/webhooks/messages", events: ["message.received", "message.delivered"] },
      { path: "/v1/webhooks/calls", events: ["call.completed", "call.recording.completed"] },
      { path: "/v1/webhooks/call-summaries", events: ["call.summary.completed"] },
      { path: "/v1/webhooks/call-transcripts", events: ["call.transcript.completed"] },
    ];
    const existing = await quo("/v1/webhooks", apiKey);
    const existingUrls = new Set((existing.json?.data || []).map((w: any) => (w.url || "").split("?")[0]));
    const hookResults: Record<string, string> = {};
    if (!body?.skipHooks) {
      for (const h of wantedHooks) {
        if (existingUrls.has(hookUrl.split("?")[0])) { hookResults[h.path] = "exists"; continue; }
        const r = await quo(h.path, apiKey, {
          method: "POST",
          body: JSON.stringify({ events: h.events, url: hookUrl, resourceIds: ["*"], label: "PrismOS", status: "enabled" }),
        });
        hookResults[h.path] = r.ok ? "created" : `err ${r.status}: ${r.json?.message || ""}`;
      }
      await supabase.from("quo_settings").upsert({ user_id: user.id, webhooks_registered: true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    }

    // ── 2) Backfill ──────────────────────────────────────────────────────
    let msgCount = 0, callCount = 0;
    const nums = await quo("/v1/phone-numbers", apiKey);
    const numbers = nums.json?.data || [];
    const maxConvos = body?.maxConvos || 40;

    for (const n of numbers) {
      const e164 = n.number || n.phoneNumber;
      const pnId = n.id;
      if (!e164 || !pnId) continue;
      const conv = await quo(`/v1/conversations?phoneNumbers=${encodeURIComponent(e164)}&maxResults=${maxConvos}`, apiKey);
      const convos = conv.json?.data || [];
      for (const c of convos) {
        const other = (c.participants || [])[0];
        if (!other) continue;
        // messages
        const m = await quo(`/v1/messages?phoneNumberId=${pnId}&participants=${encodeURIComponent(other)}&maxResults=100`, apiKey);
        const msgs = m.json?.data || [];
        if (msgs.length) {
          const rows = msgs.map((x: any) => ({
            user_id: user.id, op_id: x.id, conversation_id: c.id, phone_number_id: pnId,
            direction: x.direction, from_number: x.from, to_number: (Array.isArray(x.to) ? x.to[0] : x.to) || null,
            body: x.text ?? "", status: x.status || null, op_created_at: x.createdAt || null, raw: x,
          }));
          await supabase.from("quo_messages").upsert(rows, { onConflict: "op_id" });
          msgCount += rows.length;
        }
        // calls
        const ca = await quo(`/v1/calls?phoneNumberId=${pnId}&participants=${encodeURIComponent(other)}&maxResults=100`, apiKey);
        const calls = ca.json?.data || [];
        if (calls.length) {
          const rows = calls.map((x: any) => ({
            user_id: user.id, op_id: x.id, phone_number_id: pnId, direction: x.direction,
            participant: other, status: x.status || null, duration: typeof x.duration === "number" ? x.duration : null,
            answered_at: x.answeredAt || null, completed_at: x.completedAt || null, op_created_at: x.createdAt || null, raw: x,
          }));
          await supabase.from("quo_calls").upsert(rows, { onConflict: "op_id" });
          callCount += rows.length;
        }
      }
    }

    return J({ ok: true, webhooks: hookResults, backfilled: { messages: msgCount, calls: callCount }, numbers: numbers.length });
  } catch (err) {
    return J({ ok: false, error: String(err) }, 500);
  }
});
