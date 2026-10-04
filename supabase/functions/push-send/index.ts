// push-send — deliver a Web Push notification to a user's subscribed devices.
//
// Contract (matches the client in App.js and the SW handler in public/sw.js):
//   POST body: { title, body, url?, user_id?, tag? }
//   - Called by an authenticated user with NO user_id -> sends to THAT user's
//     own devices (the "Send test notification" button, and self-nudges).
//   - Called with the service-role key AND a user_id -> sends to that user
//     (system triggers: delegation, daily brief, owe-a-reply, etc.).
//   Returns: { sent: number, failed: number, pruned: number } or { error }.
//
// Web Push encryption (aes128gcm) + VAPID signing is handled by npm:web-push,
// the reference implementation. Deno's Node-compat runs its crypto.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/serviceCaller.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:khoyi1234@gmail.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const { title, body: message, url, tag } = body || {};
    if (!title && !message) return json({ error: "title or body required" }, 400);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // A trusted internal caller presents a service credential — checked the one
    // way (_shared/serviceCaller.ts: the exact key, or one PostgREST itself
    // accepts). 29 Sep: this used to accept ANY token starting "sb_secret_" (so
    // anyone could push to anyone), and it rejected the database's own signed
    // service JWT, so every lead-ladder alert from SQL got a 401 and reached no
    // phone at all.
    const isService = await isServiceCaller(req);

    // Resolve the TARGET user.
    let targetUserId: string | null = null;
    if (isService) {
      targetUserId = body.user_id || null;
      if (!targetUserId) return json({ error: "user_id required for service calls" }, 400);
    } else {
      const { data: u } = await admin.auth.getUser(token);
      if (!u?.user) return json({ error: "not authenticated" }, 401);
      const caller = u.user.id;
      if (body.user_id && body.user_id !== caller) {
        const { data: staff } = await admin
          .from("agents").select("role").eq("auth_user_id", caller)
          .in("role", ["owner", "broker_admin"]).maybeSingle();
        targetUserId = staff ? body.user_id : caller;
      } else {
        targetUserId = caller;
      }
    }

    const { data: subs, error: subErr } = await admin
      .from("push_subscriptions").select("id, endpoint, p256dh, auth")
      .eq("user_id", targetUserId);
    if (subErr) return json({ error: subErr.message }, 500);
    // EVERY alert leaves a record: who, what, and whether it reached a device.
    // Without it, "we pushed the agent" and "the agent's phone rang" looked the
    // same, and a lead could wait on a phone that never lit up.
    const logIt = async (sent: number, failed: number, note: string | null) => {
      try { await admin.from("push_log").insert({ user_id: targetUserId, title: title || null, tag: tag || null, sent, failed, note }); } catch (_) {}
    };
    // THE GATE (4 Oct 2026). May this reach a phone NOW? One rule for every
    // sender — public.push_gate() in supabase/sql/2026-10-04e_training_and_triage.sql:
    // the person's quiet hours, their choice of "as they happen" or a few updates
    // a day, and at most one reply reminder an hour. On 4 Oct the broker's phone
    // was found receiving "N people are waiting on you" up to 319 times a day,
    // because that limit lived in one sender and silently never held.
    // Only system pushes are gated: a person's own test or self-nudge always goes.
    // A held notification is kept and delivered later as one; nothing is dropped.
    if (isService && body.digest !== true) {
      try {
        const { data: gate, error: gErr } = await admin.rpc("push_gate", { p_user: targetUserId, p_tag: tag || null });
        if (!gErr && gate && gate.action === "skip") { await logIt(0, 0, String(gate.why || "skipped")); return json({ sent: 0, failed: 0, pruned: 0, skipped: gate.why }); }
        if (!gErr && gate && gate.action === "hold") {
          const cls = String(tag || "untagged").replace(/[-:][0-9a-f]{8}[0-9a-f-]*$/i, "");
          // keep the latest of each kind: replace what is waiting, then add this one
          await admin.from("push_held").delete().eq("user_id", targetUserId).eq("tag_class", cls).is("delivered_at", null);
          const { error: hErr } = await admin.from("push_held").insert({ user_id: targetUserId, tag_class: cls, title: title || null, body: message || null, url: url || null, tag: tag || null, why: String(gate.why || "held") });
          if (!hErr) { await logIt(0, 0, String(gate.why || "held")); return json({ sent: 0, failed: 0, pruned: 0, held: gate.why }); }
          console.error("push_held:", hErr.message);   // could not keep it: send it rather than lose it
        }
        if (gErr) console.error("push_gate:", gErr.message);   // the rule could not be asked: deliver as before
      } catch (e) { console.error("push_gate:", String((e as Error)?.message || e)); }
    }
    if (!subs || subs.length === 0) { await logIt(0, 0, "no devices"); return json({ sent: 0, failed: 0, pruned: 0, note: "no devices" }); }

    const payload = JSON.stringify({
      title: title || "PrismOS",
      body: message || "",
      url: url || "https://darasapp.com/",
      tag: tag || undefined,
    });

    let sent = 0, failed = 0;
    const dead: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          { TTL: 3600, urgency: "normal" },
        );
        sent++;
        // A device that works again must stop reading as broken (29 Sep: the old
        // error stayed forever, so nobody could tell a dead phone from a live one).
        try { await admin.from("push_subscriptions").update({ last_error: null, last_ok_at: new Date().toISOString() }).eq("id", s.id); } catch (_) {}
      } catch (e: any) {
        failed++;
        const code = e?.statusCode || e?.status;
        // 404/410 = subscription gone; prune it so we stop trying.
        if (code === 404 || code === 410) dead.push(s.id);
        else {
          // Keep the status code and the push service's own words — "Received
          // unexpected response code" alone told us nothing about why.
          const why = `${code || "?"} ${String(e?.message || e)} ${String(e?.body || "").slice(0, 160)}`.trim();
          try { await admin.from("push_subscriptions").update({ last_error: why.slice(0, 300), last_error_at: new Date().toISOString() }).eq("id", s.id); } catch (_) {}
        }
      }
    }));

    let pruned = 0;
    if (dead.length) {
      const { error: delErr } = await admin.from("push_subscriptions").delete().in("id", dead);
      if (!delErr) pruned = dead.length;
    }
    // stamp last_used on the survivors
    try { await admin.from("push_subscriptions").update({ last_used_at: new Date().toISOString() }).eq("user_id", targetUserId); } catch (_) {}

    await logIt(sent, failed, sent ? null : "every device refused");
    return json({ sent, failed, pruned });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
