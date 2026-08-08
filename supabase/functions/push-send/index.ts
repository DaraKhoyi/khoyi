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

    // A trusted internal caller presents a service credential. Supabase exposes
    // two forms (legacy service_role JWT and the newer sb_secret_… key); accept
    // either, and also treat an sb_secret_ prefix as service.
    const SB_SECRET = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
    const isService = !!token && (
      token === SERVICE_KEY ||
      token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      (SB_SECRET && SB_SECRET.includes(token)) ||
      token.startsWith("sb_secret_")
    );

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
    if (!subs || subs.length === 0) return json({ sent: 0, failed: 0, pruned: 0, note: "no devices" });

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
      } catch (e: any) {
        failed++;
        const code = e?.statusCode || e?.status;
        // 404/410 = subscription gone; prune it so we stop trying.
        if (code === 404 || code === 410) dead.push(s.id);
        else {
          try { await admin.from("push_subscriptions").update({ last_error: String(e?.message || e).slice(0, 300) }).eq("id", s.id); } catch (_) {}
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

    return json({ sent, failed, pruned });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
