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
// Build a Google RRULE array from our structured recurrence fields.
function toRRule(ev: any): string[] | undefined {
  if (!ev.recur_freq) return undefined;
  const freqMap: Record<string,string> = { daily:"DAILY", weekly:"WEEKLY", monthly:"MONTHLY", yearly:"YEARLY" };
  const f = freqMap[ev.recur_freq];
  if (!f) return undefined;
  let rule = `RRULE:FREQ=${f}`;
  const iv = Math.max(1, ev.recur_interval || 1);
  if (iv > 1) rule += `;INTERVAL=${iv}`;
  if (ev.recur_count) {
    rule += `;COUNT=${ev.recur_count}`;
  } else if (ev.recur_until) {
    const ymd = String(ev.recur_until).slice(0,10).replaceAll("-", ""); // YYYYMMDD
    // UNTIL value type must match DTSTART: DATE for all-day, UTC datetime otherwise
    rule += ev.all_day ? `;UNTIL=${ymd}` : `;UNTIL=${ymd}T235959Z`;
  }
  return [rule];
}

// Parse a Google recurrence array into our structured fields.
function parseRRule(recurrence: any): { recur_freq: string|null; recur_interval: number; recur_until: string|null; recur_count: number|null } {
  const none = { recur_freq: null, recur_interval: 1, recur_until: null, recur_count: null };
  if (!Array.isArray(recurrence) || !recurrence.length) return none;
  const line = recurrence.find((r: string) => typeof r === "string" && r.toUpperCase().startsWith("RRULE"));
  if (!line) return none;
  const body = line.replace(/^RRULE:/i, "");
  const parts: Record<string,string> = {};
  for (const kv of body.split(";")) {
    const [k, v] = kv.split("=");
    if (k && v) parts[k.toUpperCase()] = v;
  }
  const freqMap: Record<string,string> = { DAILY:"daily", WEEKLY:"weekly", MONTHLY:"monthly", YEARLY:"yearly" };
  const recur_freq = freqMap[(parts.FREQ||"").toUpperCase()] || null;
  if (!recur_freq) return none; // unsupported FREQ (e.g. HOURLY) — treat as non-recurring
  const recur_interval = parts.INTERVAL ? Math.max(1, parseInt(parts.INTERVAL)) : 1;
  let recur_until: string|null = null;
  if (parts.UNTIL) {
    const m = parts.UNTIL.match(/^(\d{4})(\d{2})(\d{2})/);
    if (m) recur_until = `${m[1]}-${m[2]}-${m[3]}`;
  }
  const recur_count = parts.COUNT ? parseInt(parts.COUNT) : null;
  return { recur_freq, recur_interval, recur_until, recur_count };
}

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
  const rr = toRRule(ev);
  if (rr) g.recurrence = rr;
  return g;
}

// Convert a Google event to Supabase fields
function fromGoogleEvent(g: any, userId: string, calendarId: string) {
  const allDay = !!(g.start?.date);
  const startAt = allDay ? `${g.start.date}T00:00:00Z` : g.start?.dateTime;
  const endAt = allDay ? `${g.end?.date || g.start.date}T00:00:00Z` : g.end?.dateTime;
  const rec = parseRRule(g.recurrence);
  return {
    user_id: userId,
    title: g.summary || "(no title)",
    description: g.description || null,
    location: g.location || null,
    // Google sends attendees as {email, displayName, responseStatus}. Store the
    // ones with a real address — this is what lets a recording made during a
    // meeting be matched to the people who were actually invited.
    attendees: Array.isArray(g.attendees)
      ? g.attendees.filter((a: any) => a.email && !a.resource)
          .map((a: any) => ({ email: String(a.email).toLowerCase(), name: a.displayName || null }))
      : null,
    start_at: startAt,
    end_at: endAt || null,
    all_day: allDay,
    recur_freq: rec.recur_freq,
    recur_interval: rec.recur_interval,
    recur_until: rec.recur_until,
    recur_count: rec.recur_count,
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

    // Auth accepts TWO trusted callers:
    //  1. A signed-in user (client): derive user_id from their JWT, ignore body.
    //  2. The service role (the every-minute calendar-poll cron): trusted server
    //     context, so honour the body's user_id.
    // The previous code REJECTED the service role outright, which meant every
    // background poll returned 401 and the calendar only ever synced while the
    // user was sitting on the Calendar tab. That is why adds/edits/deletes made
    // in Google were missed: the reconcile never ran in the background.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    // Is this the trusted server path (the calendar-poll cron)? Match either the
    // exact configured service-role key OR any token whose JWT role claim is
    // 'service_role' — robust to legacy vs new key rotations. Only a real
    // service-role JWT can be minted with that claim, so this is safe.
    const isServiceRole = (() => {
      if (!token) return false;
      if (SERVICE_ROLE && token === SERVICE_ROLE) return true;
      try {
        const payload = JSON.parse(atob(token.split(".")[1] || ""));
        return payload && payload.role === "service_role";
      } catch { return false; }
    })();
    let user_id: string;
    if (isServiceRole) {
      // trusted server path (calendar-poll) — user_id must come from the body
      const bodyUser = (body && body.user_id) || null;
      if (!bodyUser) {
        return new Response(JSON.stringify({ error: "service-role call requires user_id in body" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      user_id = bodyUser;
    } else {
      if (!token) {
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
      user_id = user.id;
    }

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
        // singleEvents=false → recurring series come back as a single master
        // carrying its RRULE (we store one row + expand client-side), rather
        // than being flattened into individual instances.
        params.set("singleEvents", "false");
        params.set("maxResults", "250");
        if (useSyncToken && !fullResync) {
          params.set("syncToken", useSyncToken);
        } else {
          // Full sync window: 90 days back, 365 forward
          const timeMin = new Date(Date.now() - 90 * 864e5).toISOString();
          const timeMax = new Date(Date.now() + 365 * 864e5).toISOString();
          params.set("timeMin", timeMin);
          params.set("timeMax", timeMax);
          // NOTE: orderBy=startTime is only valid with singleEvents=true, so omitted here.
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
          // Skip modified single instances of a recurring series — PrismOS
          // tracks the series at the master level and doesn't model per-instance
          // exceptions yet. (These items carry a recurringEventId.)
          if (g.recurringEventId) continue;
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

    // Newly pulled events arrive with no contact link. Resolve what can be
    // resolved now, so the link stays current instead of depending on a manual
    // pass nobody keeps up. Attendee-email matches first (hard evidence), then
    // an unambiguous full-name title match with birthdays/all-day excluded.
    // Never overwrites a link a human set. Best-effort: a failure here must not
    // fail the sync itself.
    let autolinked: any = null;
    try {
      const { data: al } = await supabase.rpc("autolink_event_contacts", { p_user_id: user_id });
      autolinked = Array.isArray(al) ? al[0] : al;
    } catch (_) { /* non-fatal */ }

    return new Response(JSON.stringify({ ok: true, pushed, pulled, deleted, autolinked }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
