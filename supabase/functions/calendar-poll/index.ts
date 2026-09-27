// calendar-poll
// Background dispatcher run by pg_cron. Keeps Google Calendar synced while the
// app is closed. Finds every user with an active Google account that has a
// calendar scope, then invokes calendar-sync (service-role) once per user.
//
// Auth: service_role only. Verified by decoding the JWT role (survives key
// rotation) or matching the raw service-role key.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // --- auth: service_role only ---
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const isServiceRole = (() => {
    if (!token) return false;
    if (token === SERVICE_ROLE_KEY) return true;
    try {
      const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload?.role === "service_role";
    } catch { return false; }
  })();
  if (!isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Every active Google account that can do calendar.
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("user_id, scopes, purposes, last_sync_error")
    .eq("provider", "google")
    .eq("is_active", true);
  if (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userIds = [...new Set(
    (accounts || [])
      .filter((a: any) =>
        (a.purposes || []).includes("calendar") ||
        (a.scopes || []).some((s: string) => s.includes("calendar"))
      )
      // Skip accounts already flagged as needing re-auth — nothing to do until the
      // user reconnects; avoids hammering Google with doomed refreshes every run.
      .filter((a: any) => a.last_sync_error !== "REAUTH_REQUIRED")
      .map((a: any) => a.user_id)
  )];

  const results: any[] = [];
  for (const uid of userIds) {
    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/calendar-sync`, {
        method: "POST",
        headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: uid, direction: "both", calendar_id: "primary" }),
      });
      let detail: any = null;
      try { detail = await r.json(); } catch { /* ignore */ }
      results.push({ user_id: uid, status: r.status, ok: detail?.ok ?? null, pulled: detail?.pulled, pushed: detail?.pushed, error: detail?.error });
    } catch (e) {
      results.push({ user_id: uid, error: String(e) });
    }
  }

  return new Response(JSON.stringify({ ok: true, users: userIds.length, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
