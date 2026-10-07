// calendar-poll
// Background dispatcher run by pg_cron. Keeps Google Calendar synced while the
// app is closed. Finds every user with an active Google account that has a
// calendar scope, then invokes calendar-sync (service-role) once per user.
//
// Auth: service_role only. Verified by decoding the JWT role (survives key
// rotation) or matching the raw service-role key.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/serviceCaller.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// A revoked Google grant cannot fix itself; only the person reconnecting can.
function needsReauth(a: any): boolean {
  if (a.reauth_required_at) return true;
  const e = String(a.last_sync_error || "");
  return e.startsWith("REAUTH_REQUIRED") || /invalid_grant/.test(e);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // --- auth: service_role only ---
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  // Verified, not decoded — see _shared/serviceCaller.ts.
  const isServiceRole = !!token && await isServiceCaller(req);
  if (!isServiceRole) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Every active Google account that can do calendar.
  const { data: accounts, error } = await supabase
    .from("email_accounts")
    .select("user_id, scopes, purposes, last_sync_error, reauth_required_at")
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
      // FIX 7 Oct 2026: this used to compare last_sync_error to the exact string
      // "REAUTH_REQUIRED", which nothing ever writes. google-connection-watch
      // writes "REAUTH_REQUIRED: <detail>" plus reauth_required_at, and gmail-sync
      // then overwrites last_sync_error with "Error: Token refresh failed: 400
      // invalid_grant". So two revoked accounts were retried every 2 minutes and
      // made 28% of all calendar-sync calls return 500. reauth_required_at is the
      // durable flag: connection-watch clears it when a probe succeeds and the
      // OAuth callback clears it on reconnect, so sync resumes on its own.
      .filter((a: any) => !needsReauth(a))
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
