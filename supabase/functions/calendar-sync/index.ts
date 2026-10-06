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
import { isServiceCaller } from "../_shared/serviceCaller.ts";

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

// `isUpdate`: the event already exists in Google and is being changed.
function toGoogleEvent(ev: any, tz: string, isUpdate: boolean) {
  const g: any = {
    summary: ev.title,
    description: ev.description || undefined,
    location: ev.location || undefined,
  };
  if (ev.all_day) {
    // Stored as dates in UTC: start = first day, end = the day after the last.
    const first = new Date(ev.start_at).toISOString().slice(0, 10);
    let after = new Date(ev.end_at || ev.start_at).toISOString().slice(0, 10);
    if (after <= first) after = new Date(Date.parse(first + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);   // Google refuses an all-day event that ends on its own first day
    g.start = { date: first };
    g.end = { date: after };
    // "Free" unless the person closed the day to bookings in PrismOS.
    g.transparency = ev.blocks_time === true ? "opaque" : "transparent";
  } else {
    // Google requires a named timezone on a repeating event, and it is what
    // keeps "10:00 every Tuesday" at 10:00 when the clocks change.
    g.start = { dateTime: new Date(ev.start_at).toISOString(), timeZone: tz };
    g.end = { dateTime: new Date(ev.end_at || ev.start_at).toISOString(), timeZone: tz };
  }
  // The repeat rule. When PrismOS holds Google's own rule (recur_rule), a
  // change to the event must NOT send a rule at all: PrismOS only knows the
  // plain form (how often, until when), and sending that replaced "Monday,
  // Wednesday and Friday" with "weekly" in Google. Leaving the field out of an
  // update keeps Google's rule. A rule is sent only when the person set the
  // repeat here (the app clears recur_rule when they do).
  if (Array.isArray(ev.recur_rule) && ev.recur_rule.length) { if (!isUpdate) g.recurrence = ev.recur_rule; }
  else { const rr = toRRule(ev); if (rr) g.recurrence = rr; else if (isUpdate) g.recurrence = []; }
  return g;
}

// Why Google refused, in a person's words, and whether trying again can help.
function pushProblem(status: number, body: string, isUpdate: boolean): { why: string; give_up: boolean } {
  const reason = (() => { try { const j = JSON.parse(body); return String(j?.error?.errors?.[0]?.reason || j?.error?.message || ""); } catch (_) { return ""; } })();
  if (status === 403 && /forbiddenForNonOrganizer|forbidden/i.test(reason + body)) return { why: "Google did not accept this change: the event belongs to someone else's calendar, and only they can change it.", give_up: true };
  if ((status === 404 || status === 410) && isUpdate) return { why: "This event no longer exists in Google Calendar, so the change could not be sent.", give_up: true };
  if (status === 400) return { why: "Google did not accept this event (" + (reason || "it was not valid") + "). Open it, check the dates and times, and save it again.", give_up: true };
  if (status === 401 || status === 403) return { why: "Google would not let PrismOS write to the calendar. Reconnect the calendar account in Settings.", give_up: false };
  return { why: "Google Calendar did not answer (" + status + "). PrismOS will try again.", give_up: false };
}

// Convert a Google event to Supabase fields
function fromGoogleEvent(g: any, userId: string, calendarId: string) {
  const allDay = !!(g.start?.date);
  const startAt = allDay ? `${g.start.date}T00:00:00Z` : g.start?.dateTime;
  const endAt = allDay ? `${g.end?.date || g.start.date}T00:00:00Z` : g.end?.dateTime;
  const rec = parseRRule(g.recurrence);
  // Keep Google's own lines (RRULE, EXDATE) exactly; src/recurrence.js reads them.
  const rule = Array.isArray(g.recurrence) && g.recurrence.some((r: any) => typeof r === "string" && /^RRULE:/i.test(r)) ? g.recurrence.filter((r: any) => typeof r === "string") : null;
  return {
    recur_rule: rule,
    push_error: null,
    // An all-day "out of office" closes the day; nothing else all-day does unless ticked in PrismOS.
    ...(allDay && g.eventType === "outOfOffice" ? { blocks_time: true } : {}),
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
    // Is this the trusted server path (the calendar-poll cron)? VERIFIED, not
    // decoded. Until 27 Sep this read the JWT's role claim without checking its
    // signature — with verify_jwt off, anyone could type {"role":"service_role"}
    // and name any agent's user_id below. See _shared/serviceCaller.ts.
    const isServiceRole = !!token && await isServiceCaller(req);
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

    const { data: tzRow } = await supabase.from("user_settings").select("timezone").eq("user_id", user_id).maybeSingle();
    const tz = (tzRow && tzRow.timezone) || "America/New_York";

    const gcalBase = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendar_id)}/events`;
    const authHeaders = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };

    let pushed = 0, pulled = 0, deleted = 0, failed = 0;

    // ---------- PUSH ----------
    if (direction === "both" || direction === "push") {
      const { data: pendingEvents } = await supabase
        .from("events")
        .select("*")
        .eq("user_id", user_id)
        .eq("sync_status", "pending_push");

      for (const ev of pendingEvents || []) {
        // A change that does not reach Google is SAID, on the event. Until
        // 6 Oct 2026 a refusal was skipped in silence and the row stayed
        // "pending" for good: it never went up, and because pending rows are
        // protected from the pull, Google's later changes never came down.
        const isUpdate = !!ev.google_event_id;
        let problem: { why: string; give_up: boolean } | null = null;
        try {
          const gEvent = toGoogleEvent(ev, tz, isUpdate);
          const resp = isUpdate
            ? await fetch(`${gcalBase}/${ev.google_event_id}`, { method: "PATCH", headers: authHeaders, body: JSON.stringify(gEvent) })
            : await fetch(gcalBase, { method: "POST", headers: authHeaders, body: JSON.stringify(gEvent) });
          if (resp.ok) {
            const created = await resp.json();
            const { error: upErr } = await supabase.from("events").update({
              google_event_id: created.id,
              google_calendar_id: ev.google_calendar_id || calendar_id,
              google_etag: created.etag,
              sync_status: "synced",
              push_error: null,
              last_synced_at: new Date().toISOString(),
            }).eq("id", ev.id);
            if (upErr) console.error("calendar-sync: pushed but could not mark synced", ev.id, upErr.message);
            pushed++;
            continue;
          }
          problem = pushProblem(resp.status, (await resp.text()).slice(0, 600), isUpdate);
        } catch (e) { problem = { why: "Google Calendar could not be reached (" + String((e as Error)?.message || e).slice(0, 80) + "). PrismOS will try again.", give_up: false }; }
        failed++;
        // give_up: trying again cannot help, so stop holding the row as pending.
        // Otherwise it stays pending (and is retried) with the reason shown.
        const { error: fErr } = await supabase.from("events").update({ push_error: problem!.why, ...(problem!.give_up ? { sync_status: "push_failed" } : {}) }).eq("id", ev.id);
        if (fErr) console.error("calendar-sync: could not record a failed push", ev.id, fErr.message);
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
      // RULES_VERSION: raise it when the pull starts keeping something new, and
      // every calendar is re-read in full once so rows already here get it.
      //   2 (6 Oct 2026): Google's own repeat rule, and single occurrences
      //   cancelled or moved out of a series.
      const RULES_VERSION = 2;
      const behind = (syncState?.rules_version ?? 0) < RULES_VERSION;
      let useSyncToken = behind ? undefined : (syncState?.sync_token || undefined);
      let fullResync = behind;
      // Single occurrences taken out of their series: master google id -> start times.
      const lifted = new Map<string, string[]>();

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
          // One occurrence of a repeating event that was cancelled or moved.
          // The series must stop showing it at its original time; a moved one
          // is then kept below as an event of its own.
          if (g.recurringEventId) {
            const orig = g.originalStartTime?.dateTime || (g.originalStartTime?.date ? `${g.originalStartTime.date}T00:00:00Z` : null);
            if (orig) lifted.set(g.recurringEventId, [...(lifted.get(g.recurringEventId) || []), new Date(orig).toISOString()]);
          }
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
              const { error: uErr } = await supabase.from("events").update(row).eq("id", existing.id);
              if (uErr) console.error("calendar-sync: pull update failed", g.id, uErr.message); else pulled++;
            }
          } else {
            const { error: iErr } = await supabase.from("events").insert(row);
            if (iErr) console.error("calendar-sync: pull insert failed", g.id, iErr.message); else pulled++;
          }
        }

        pageToken = listData.nextPageToken;
        if (listData.nextSyncToken) nextSyncToken = listData.nextSyncToken;
      } while (pageToken);

      // Take the lifted occurrences out of their series (after every page is
      // in, so the series row exists whichever order Google sent them in).
      for (const [masterGid, times] of lifted) {
        const { data: master } = await supabase.from("events").select("id, recur_exdates")
          .eq("user_id", user_id).eq("google_calendar_id", calendar_id).eq("google_event_id", masterGid).maybeSingle();
        if (!master) continue;
        const have = new Set((master.recur_exdates || []).map((t: string) => new Date(t).getTime()));
        const add = times.filter((t) => !have.has(new Date(t).getTime()));
        if (!add.length) continue;
        const { error: xErr } = await supabase.from("events").update({ recur_exdates: [...(master.recur_exdates || []), ...add] }).eq("id", master.id);
        if (xErr) console.error("calendar-sync: could not lift an occurrence", masterGid, xErr.message);
      }

      // Persist syncToken
      if (nextSyncToken) {
        const upsert = {
          user_id,
          google_calendar_id: calendar_id,
          sync_token: nextSyncToken,
          rules_version: RULES_VERSION,
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

    return new Response(JSON.stringify({ ok: true, pushed, pulled, deleted, failed, autolinked }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
