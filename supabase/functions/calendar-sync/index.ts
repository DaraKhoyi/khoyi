// calendar-sync
// Bidirectional sync between Supabase `events` and Google Calendar.
// POST { user_id: uuid, direction?: 'both'|'pull'|'push', calendar_id?: string }
//
// Flow:
//   1. Load the user's google account from email_accounts, refresh token if expired.
//   2. PUSH: send local events with sync_status in (pending_push) to Google.
//   3. PULL: fetch Google changes (incremental via syncToken when available),
//      upsert into events.
//   4. Persist the new syncToken.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(refreshToken: string): Promise<{ access_token: string; expires_in: number }> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status} ${(await r.text()).slice(0,200)}`);
  return await r.json();
}

// Convert a Supabase event row to a Google Calendar event resource
function toGoogleEvent(ev: any) {
  const g: any = {
    summary: ev.title,
    description: ev.description || undefined,
    location: ev.location || undefined,
  };
  if (ev.all_day) {
    g.start = { date: ev.start_at.slice(0, 10) };
    g.end = { date: (ev.end_at || ev.start_at).slice(0, 10) };
  } else {
    g.start = { dateTime: new Date(ev.start_at).toISOString() };
    g.end = { dateTime: new Date(ev.end_at || ev.start_at).toISOString() };
  }
  return g;
}

// Convert a Google event to Supabase fields
function fromGoogleEvent(g: any, userId: string, calendarId: string) {
  const allDay = !!(g.start?.date);
  const startAt = allDay ? `${g.start.date}T00:00:00Z` : g.start?.dateTime;
  const endAt = allDay ? `${g.end?.date || g.start.date}T00:00:00Z` : g.end?.dateTime;
  return {
    user_id: userId,
    title: g.summary || "(no title)",
    description: g.description || null,
    location: g.location || null,
    start_at: startAt,
    end_at: endAt || null,
    all_day: allDay,
    google_event_id: g.id,
    google_calendar_id: calendarId,
    google_etag: g.etag || null,
    sync_status: "synced",
    last_synced_at: new Date().toISOString(),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { direction = "both", calendar_id = "primary" } = body || {};

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // SECURITY: derive user_id from JWT only; body user_id ignored
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

    // Load the account designated for CALENDAR. Prefer purposes @> {calendar},
    // fall back to any active google account with a calendar scope.
    let { data: account, error: accErr } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("user_id", user_id)
      .eq("provider", "google")
      .eq("is_active", true)
      .contains("purposes", ["calendar"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (accErr) throw accErr;
    if (!account) {
      // Fallback: any active google account whose scopes include calendar
      const { data: candidates } = await supabase
        .from("email_accounts")
        .select("*")
        .eq("user_id", user_id)
        .eq("provider", "google")
        .eq("is_active", true)
        .order("updated_at", { ascending: false });
      account = (candidates || []).find(a => (a.scopes || []).some((s) => s.includes("calendar"))) || null;
    }
    if (!account) throw new Error("No Google account connected for calendar");
    if (!account.refresh_token) throw new Error("No refresh token; please reconnect the calendar account");

    // Ensure access token is fresh
    let accessToken = account.access_token;
    const expired = !account.token_expires_at || new Date(account.token_expires_at) <= new Date();
    if (expired) {
      const refreshed = await refreshAccessToken(account.refresh_token);
      accessToken = refreshed.access_token;
      const newExpiry = new Date(Date.now() + ((refreshed.expires_in || 3600) - 60) * 1000).toISOString();
      await supabase.from("email_accounts")
        .update({ access_token: accessToken, token_expires_at: newExpiry })
        .eq("id", account.id);
    }

    const gcalBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`;
    const authHeaders = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    let pushed = 0, pulled = 0, deleted = 0;

    // ---------- PUSH ----------
    if (direction === "both" || direction === "push") {
      const { data: pendingEvents } = await supabase
        .from("events")
        .select("*")
        .eq("user_id", user_id)
        .eq("sync_status", "pending_push");

      for (const ev of pendingEvents || []) {
        try {
          const gEvent = toGoogleEvent(ev);
          let resp;
          if (ev.google_event_id) {
            resp = await fetch(`${gcalBase}/${ev.google_event_id}`, {
              method: "PATCH", headers: authHeaders, body: JSON.stringify(gEvent),
            });
          } else {
            resp = await fetch(gcalBase, {
              method: "POST", headers: authHeaders, body: JSON.stringify(gEvent),
            });
          }
          if (resp.ok) {
            const created = await resp.json();
            await supabase.from("events").update({
              google_event_id: created.id,
              google_etag: created.etag,
              sync_status: "synced",
              last_synced_at: new Date().toISOString(),
            }).eq("id", ev.id);
            pushed++;
          }
        } catch (_) { /* skip individual failures */ }
      }

      // Handle local deletes flagged as pending (title prefix convention not used; rely on a tombstone table later)
    }

    // ---------- PULL ----------
    if (direction === "both" || direction === "pull") {
      // Get stored syncToken
      const { data: syncState } = await supabase
        .from("calendar_sync_state")
        .select("*")
        .eq("user_id", user_id)
        .eq("google_calendar_id", calendar_id)
        .maybeSingle();

      let pageToken: string | undefined;
      let nextSyncToken: string | undefined;
      let useSyncToken = syncState?.sync_token || undefined;
      let fullResync = false;

      do {
        const params = new URLSearchParams();
        params.set("singleEvents", "true");
        params.set("maxResults", "250");
        if (useSyncToken && !fullResync) {
          params.set("syncToken", useSyncToken);
        } else {
          // Full sync window: 90 days back, 365 forward
          const timeMin = new Date(Date.now() - 90 * 864e5).toISOString();
          const timeMax = new Date(Date.now() + 365 * 864e5).toISOString();
          params.set("timeMin", timeMin);
          params.set("timeMax", timeMax);
          params.set("orderBy", "startTime");
        }
        if (pageToken) params.set("pageToken", pageToken);

        const listResp = await fetch(`${gcalBase}?${params.toString()}`, { headers: authHeaders });
        if (listResp.status === 410) {
          // syncToken expired — do a full resync
          fullResync = true;
          useSyncToken = undefined;
          pageToken = undefined;
          continue;
        }
        if (!listResp.ok) throw new Error(`List events failed: ${listResp.status} ${(await listResp.text()).slice(0,200)}`);
        const listData = await listResp.json();

        for (const g of listData.items || []) {
          if (g.status === "cancelled") {
            // Deleted in Google — remove locally
            const { error: delErr } = await supabase
              .from("events")
              .delete()
              .eq("user_id", user_id)
              .eq("google_calendar_id", calendar_id)
              .eq("google_event_id", g.id);
            if (!delErr) deleted++;
            continue;
          }
          if (!g.start) continue; // skip malformed
          const row = fromGoogleEvent(g, user_id, calendar_id);
          // Upsert on (user_id, google_calendar_id, google_event_id)
          const { data: existing } = await supabase
            .from("events")
            .select("id, sync_status")
            .eq("user_id", user_id)
            .eq("google_calendar_id", calendar_id)
            .eq("google_event_id", g.id)
            .maybeSingle();
          if (existing) {
            // Don't clobber a local pending_push edit
            if (existing.sync_status !== "pending_push") {
              await supabase.from("events").update(row).eq("id", existing.id);
              pulled++;
            }
          } else {
            await supabase.from("events").insert(row);
            pulled++;
          }
        }

        pageToken = listData.nextPageToken;
        if (listData.nextSyncToken) nextSyncToken = listData.nextSyncToken;
      } while (pageToken);

      // Persist syncToken
      if (nextSyncToken) {
        const upsert = {
          user_id,
          google_calendar_id: calendar_id,
          sync_token: nextSyncToken,
          last_incremental_sync_at: new Date().toISOString(),
          ...(fullResync || !syncState ? { last_full_sync_at: new Date().toISOString() } : {}),
        };
        if (syncState) {
          await supabase.from("calendar_sync_state").update(upsert).eq("id", syncState.id);
        } else {
          await supabase.from("calendar_sync_state").insert(upsert);
        }
      }
    }

    // Update account last_sync
    await supabase.from("email_accounts")
      .update({ last_sync_at: new Date().toISOString(), last_sync_error: null })
      .eq("id", account.id);

    return new Response(JSON.stringify({ ok: true, pushed, pulled, deleted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
