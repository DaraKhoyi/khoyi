// calendar-delete
// Deletes an event from Google Calendar (the local row is deleted by the client).
// POST { user_id: uuid, event_id: uuid }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status}`);
  return await r.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { event_id } = body || {};
    if (!event_id) throw new Error("event_id required");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // SECURITY: derive user_id from JWT only
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user_id = user.id;

    const { data: ev } = await supabase.from("events").select("*").eq("id", event_id).eq("user_id", user_id).maybeSingle();
    if (!ev || !ev.google_event_id) {
      return new Response(JSON.stringify({ ok: true, note: "no google event to delete" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let { data: account } = await supabase
      .from("email_accounts").select("*")
      .eq("user_id", user_id).eq("provider", "google").eq("is_active", true)
      .contains("purposes", ["calendar"])
      .order("updated_at", { ascending: false }).limit(1).maybeSingle();
    if (!account) {
      const { data: candidates } = await supabase
        .from("email_accounts").select("*")
        .eq("user_id", user_id).eq("provider", "google").eq("is_active", true)
        .order("updated_at", { ascending: false });
      account = (candidates || []).find(a => (a.scopes || []).some((s) => s.includes("calendar"))) || null;
    }
    if (!account?.refresh_token) throw new Error("No Google account for calendar");

    let accessToken = account.access_token;
    if (!account.token_expires_at || new Date(account.token_expires_at) <= new Date()) {
      const refreshed = await refreshAccessToken(account.refresh_token);
      accessToken = refreshed.access_token;
      await supabase.from("email_accounts").update({
        access_token: accessToken,
        token_expires_at: new Date(Date.now() + ((refreshed.expires_in||3600)-60)*1000).toISOString(),
      }).eq("id", account.id);
    }

    const calId = ev.google_calendar_id || "primary";
    const resp = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${ev.google_event_id}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } },
    );
    // 410 = already deleted, treat as success
    if (!resp.ok && resp.status !== 410 && resp.status !== 404) {
      throw new Error(`Delete failed: ${resp.status}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
