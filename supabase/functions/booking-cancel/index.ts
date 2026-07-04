// booking-cancel — public (verify_jwt=false). Cancels a booking via its
// cancel_token: removes the calendar event (from Google + our DB), frees the
// slot, and marks the booking cancelled so the client can rebook.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function refreshToken(refresh_token: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: Deno.env.get("GOOGLE_CLIENT_ID")!, client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!, refresh_token, grant_type: "refresh_token" }),
  });
  return await r.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const token = String(b.cancel_token || "").trim();
    if (!token) return json({ ok: false, error: "missing_token" }, 400);

    const { data: bk } = await admin.from("bookings").select("*").eq("cancel_token", token).maybeSingle();
    if (!bk) return json({ ok: false, error: "not_found" }, 404);
    if (bk.status === "cancelled") return json({ ok: true, already: true, slug: bk.slug });

    // remove the calendar event (Google best-effort, then our row)
    if (bk.event_id) {
      const { data: ev } = await admin.from("events").select("*").eq("id", bk.event_id).maybeSingle();
      if (ev?.google_event_id) {
        try {
          let { data: acct } = await admin.from("email_accounts").select("*")
            .eq("user_id", bk.user_id).eq("provider", "google").eq("is_active", true)
            .order("updated_at", { ascending: false }).limit(1).maybeSingle();
          if (acct?.refresh_token) {
            let accessToken = acct.access_token;
            if (!acct.token_expires_at || new Date(acct.token_expires_at) <= new Date()) {
              const refreshed = await refreshToken(acct.refresh_token);
              accessToken = refreshed.access_token;
              await admin.from("email_accounts").update({ access_token: accessToken, token_expires_at: new Date(Date.now() + ((refreshed.expires_in || 3600) - 60) * 1000).toISOString() }).eq("id", acct.id);
            }
            const calId = ev.google_calendar_id || "primary";
            await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${ev.google_event_id}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } });
          }
        } catch (_e) { /* best-effort */ }
      }
      await admin.from("events").delete().eq("id", bk.event_id);
    }

    await admin.from("bookings").update({ status: "cancelled" }).eq("id", bk.id);
    return json({ ok: true, slug: bk.slug });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
