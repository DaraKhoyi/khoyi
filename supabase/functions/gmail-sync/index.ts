// gmail-sync
// Pulls new messages from Gmail and upserts them into email_threads / email_messages.
// Behavior:
//   - On first sync (initial_sync_done=false): pull the most recent 100 messages,
//     then mark initial_sync_done=true and store the latest historyId.
//   - On subsequent syncs: use Gmail history.list with start_history_id to fetch
//     only new/changed messages.
//
// Body options:
//   { account_id?: string }  // sync just this account; otherwise all active accounts for the caller
//   { max_initial?: number } // cap for first-sync (default 100, max 500)
//
// Returns: { synced: [ { account_id, email, new_messages, new_threads, error? } ] }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── helpers ──────────────────────────────────────────────────

async function refreshAccessTokenIfNeeded(supabase, account) {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) {
    return account.access_token; // still valid for at least 2 min
  }
  if (!account.refresh_token) {
    throw new Error("No refresh_token on account — reconnect Gmail.");
  }
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Token refresh failed: ${r.status} ${t.slice(0, 300)}`);
  }
  const tokens = await r.json();
  const newExp = new Date(now + ((tokens.expires_in || 3600) - 60) * 1000).toISOString();
  await supabase
    .from("email_accounts")
    .update({ access_token: tokens.access_token, token_expires_at: newExp })
    .eq("id", account.id);
  return tokens.access_token;
}

function parseAddressList(headerValue) {
  if (!headerValue) return [];
  // Split on commas not inside quotes
  const parts = headerValue.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const m = p.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
      if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
      // bare address
      return { name: null, email: p.replace(/[<>]/g, "").trim().toLowerCase() };
    });
}

function parseFromHeader(headerValue) {
  const list = parseAddressList(headerValue);
  return list[0] || { name: null, email: null };
}

function getHeader(headers, name) {
  if (!headers) return null;
  const h = headers.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : null;
}

function decodeBase64Url(s) {
  if (!s) return "";
  const b = s.replace(/-/g, "+").replace(/_/g, "/");
  try {
    // Add padding
    const padded = b + "=".repeat((4 - (b.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return "";
  }
}

function extractBodies(payload) {
  let text = "";
  let html = "";
  function walk(part) {
    if (!part) return;
    const mt = (part.mimeType || "").toLowerCase();
    if (mt === "text/plain" && part.body && part.body.data) {
      text += decodeBase64Url(part.body.data);
    } else if (mt === "text/html" && part.body && part.body.data) {
      html += decodeBase64Url(part.body.data);
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  }
  walk(payload);
  return { text, html };
}

function extractAttachments(payload) {
  const out = [];
  function walk(part) {
    if (!part) return;
    if (part.filename && part.body && part.body.attachmentId) {
      out.push({
        provider_attachment_id: part.body.attachmentId,
        filename: part.filename,
        mime_type: part.mimeType || null,
        size_bytes: part.body.size || null,
      });
    }
    if (Array.isArray(part.parts)) for (const p of part.parts) walk(p);
  }
  walk(payload);
  return out;
}

async function gmailFetch(accessToken, path, params) {
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Gmail ${path} ${r.status}: ${t.slice(0, 300)}`);
  }
  return r.json();
}

// Build a Gmail search query string based on sync options
function buildGmailQuery(opts) {
  // If the caller provided an explicit override, use it verbatim (still wins).
  if (opts.query_override && typeof opts.query_override === "string" && opts.query_override.trim()) {
    return opts.query_override.trim();
  }
  const parts = ["-in:trash", "-in:spam"];
  if (opts.lookback_days && opts.lookback_days > 0) {
    const epochSeconds = Math.floor(Date.now() / 1000) - (opts.lookback_days * 86400);
    parts.push(`after:${epochSeconds}`);
  }
  if (opts.before_epoch) {
    parts.push(`before:${opts.before_epoch}`);
  }
  if (opts.exclude_categories) {
    // Skip promotional/automated mail — keep what's likely human-to-human
    parts.push("-category:promotions");
    parts.push("-category:updates");
    parts.push("-category:social");
    parts.push("-category:forums");
  }
  if (opts.labels && opts.labels.length > 0) {
    for (const label of opts.labels) parts.push(`label:${label}`);
  }
  return parts.join(" ");
}

async function getMessageIds(accessToken, opts) {
  // Initial sync: list messages, paginated, up to limit
  const ids = [];
  let pageToken;
  while (ids.length < opts.limit) {
    const params = {
      maxResults: Math.min(500, opts.limit - ids.length),
      q: opts.query || "-in:trash -in:spam",
    };
    if (pageToken) params.pageToken = pageToken;
    const j = await gmailFetch(accessToken, "users/me/messages", params);
    if (Array.isArray(j.messages)) {
      for (const m of j.messages) ids.push(m.id);
    }
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return ids;
}

async function getHistoryDeltas(accessToken, startHistoryId) {
  // history.list returns history records; we collect message IDs that appeared
  const newIds = new Set();
  const deletedIds = new Set();
  let pageToken;
  let latestHistoryId = startHistoryId;
  for (let i = 0; i < 20; i++) {
    const params = { startHistoryId };
    if (pageToken) params.pageToken = pageToken;
    let j;
    try {
      j = await gmailFetch(accessToken, "users/me/history", params);
    } catch (e) {
      // historyId may be too old (>7 days) — caller should fall back to a fresh list
      throw new Error(`history.list failed: ${e.message || e}`);
    }
    if (j.historyId) latestHistoryId = j.historyId;
    if (Array.isArray(j.history)) {
      for (const h of j.history) {
        if (Array.isArray(h.messagesAdded)) {
          for (const ma of h.messagesAdded) newIds.add(ma.message.id);
        }
        if (Array.isArray(h.messagesDeleted)) {
          for (const md of h.messagesDeleted) deletedIds.add(md.message.id);
        }
      }
    }
    if (!j.nextPageToken) break;
    pageToken = j.nextPageToken;
  }
  return { newIds: [...newIds], deletedIds: [...deletedIds], latestHistoryId };
}

async function fetchMessageFull(accessToken, id) {
  return gmailFetch(accessToken, `users/me/messages/${id}`, { format: "full" });
}

async function getProfile(accessToken) {
  return gmailFetch(accessToken, "users/me/profile");
}

async function syncOneAccount(supabase, account, opts) {
  const result = { account_id: account.id, email: account.email_address, new_messages: 0, new_threads: 0, new_inbound: 0 };
  const conciergeCandidates = [];   // new inbound emails to consider for the Lead Concierge
  try {
    const accessToken = await refreshAccessTokenIfNeeded(supabase, account);

    let messageIds = [];
    let latestHistoryId = account.history_id;

    const wantBackfill = opts.force_backfill === true;
    if (!account.initial_sync_done || wantBackfill) {
      // First sync (or explicit backfill) — pull recent N messages with optional filtering.
      // In backfill mode, query for messages OLDER than the oldest we already have,
      // so each call walks further back in time.
      const limit = Math.min(Math.max(opts.max_initial || 100, 1), 5000);
      let beforeEpoch;
      if (wantBackfill) {
        // When backfilling a specific label (e.g. SENT), walk backward through messages
        // with that label, not just any messages. Otherwise initial SENT pulls get the
        // newest SENT (a few items) and then stop, because the "oldest we have" is from INBOX.
        let oldestQ = supabase
          .from("email_messages")
          .select("internal_date,labels")
          .eq("account_id", account.id)
          .order("internal_date", { ascending: true })
          .limit(1);
        if (opts.labels && opts.labels.length === 1) {
          oldestQ = supabase
            .from("email_messages")
            .select("internal_date")
            .eq("account_id", account.id)
            .contains("labels", opts.labels)
            .order("internal_date", { ascending: true })
            .limit(1);
        }
        const { data: oldest } = await oldestQ;
        if (oldest && oldest[0] && oldest[0].internal_date) {
          beforeEpoch = Math.floor(new Date(oldest[0].internal_date).getTime() / 1000);
        }
      }
      const query = buildGmailQuery({
        lookback_days: opts.lookback_days,
        exclude_categories: opts.exclude_categories,
        before_epoch: beforeEpoch,
        labels: opts.labels,
        query_override: opts.query_override,
      });
      messageIds = await getMessageIds(accessToken, { limit, query });
      const prof = await getProfile(accessToken);
      latestHistoryId = prof.historyId;
    } else if (account.history_id) {
      try {
        const delta = await getHistoryDeltas(accessToken, account.history_id);
        messageIds = delta.newIds;
        latestHistoryId = delta.latestHistoryId;
        // Mark deleted messages
        if (delta.deletedIds.length > 0) {
          await supabase
            .from("email_messages")
            .delete()
            .eq("account_id", account.id)
            .in("provider_message_id", delta.deletedIds);
        }
      } catch (e) {
        // history too old — fall back to listing recent messages
        const limit = Math.min(Math.max(opts.max_initial || 100, 1), 5000);
        const query = buildGmailQuery({
          lookback_days: opts.lookback_days,
          exclude_categories: opts.exclude_categories,
        });
        messageIds = await getMessageIds(accessToken, { limit, query });
        const prof = await getProfile(accessToken);
        latestHistoryId = prof.historyId;
      }
    } else {
      // Marked initial done but no history_id — get current
      const prof = await getProfile(accessToken);
      latestHistoryId = prof.historyId;
    }

    // Filter out IDs we already have stored for this account
    let newIds = messageIds;
    if (newIds.length > 0) {
      const { data: existing } = await supabase
        .from("email_messages")
        .select("provider_message_id")
        .eq("account_id", account.id)
        .in("provider_message_id", newIds);
      const existingSet = new Set((existing || []).map((m) => m.provider_message_id));
      newIds = newIds.filter((id) => !existingSet.has(id));
    }

    // Cap per run to avoid timeout. Backfills get a larger cap because the
    // caller knows they'll need multiple runs and will batch.
    const PER_RUN_CAP = opts.force_backfill ? (opts.per_run_cap || 300) : 80;
    const idsToFetch = newIds.slice(0, PER_RUN_CAP);
    const remainingAfter = Math.max(0, newIds.length - idsToFetch.length);
    result.remaining_to_fetch = remainingAfter;
    const ownerEmail = (account.email_address || "").toLowerCase();
    const threadCache = new Map(); // provider_thread_id -> uuid

    for (const mid of idsToFetch) {
      let msg;
      try {
        msg = await fetchMessageFull(accessToken, mid);
      } catch (e) {
        continue; // skip messages we can't fetch (deleted in flight, etc.)
      }
      const headers = (msg.payload && msg.payload.headers) || [];
      const fromHeader = getHeader(headers, "From");
      const toHeader = getHeader(headers, "To");
      const ccHeader = getHeader(headers, "Cc");
      const bccHeader = getHeader(headers, "Bcc");
      const replyTo = getHeader(headers, "Reply-To");
      const subject = getHeader(headers, "Subject");
      const dateHeader = getHeader(headers, "Date");
      const fromObj = parseFromHeader(fromHeader);
      const labels = msg.labelIds || [];
      const isInbound = !labels.includes("SENT") || (fromObj.email && fromObj.email !== ownerEmail);
      const direction = labels.includes("SENT") && fromObj.email === ownerEmail ? "outbound" : (isInbound ? "inbound" : "outbound");
      const bodies = extractBodies(msg.payload);
      const attachments = extractAttachments(msg.payload);
      const internalDate = msg.internalDate
        ? new Date(parseInt(msg.internalDate, 10)).toISOString()
        : (dateHeader ? new Date(dateHeader).toISOString() : null);

      // Upsert thread
      let threadUuid = threadCache.get(msg.threadId);
      const fromParticipant = (fromObj.email || fromObj.name) ? { name: fromObj.name, email: fromObj.email } : null;
      if (!threadUuid) {
        const { data: existingThread } = await supabase
          .from("email_threads")
          .select("id, participants")
          .eq("account_id", account.id)
          .eq("provider_thread_id", msg.threadId)
          .maybeSingle();
        if (existingThread) {
          threadUuid = existingThread.id;
          // Merge this message's sender into participants if not already there
          if (fromParticipant) {
            const existingPs = Array.isArray(existingThread.participants) ? existingThread.participants : [];
            const already = existingPs.some(p => (p.email || '').toLowerCase() === (fromParticipant.email || '').toLowerCase());
            if (!already) {
              await supabase.from("email_threads")
                .update({ participants: [...existingPs, fromParticipant] })
                .eq("id", threadUuid);
            }
          }
        } else {
          const initialParticipants = fromParticipant ? [fromParticipant] : [];
          const { data: newThread } = await supabase
            .from("email_threads")
            .insert({
              user_id: account.user_id,
              account_id: account.id,
              provider_thread_id: msg.threadId,
              subject: subject || "(no subject)",
              snippet: msg.snippet || null,
              message_count: 0,
              participants: initialParticipants,
              labels,
              last_message_at: internalDate,
              has_unread: labels.includes("UNREAD"),
            })
            .select("id")
            .single();
          threadUuid = newThread && newThread.id;
        }
        if (threadUuid) threadCache.set(msg.threadId, threadUuid);
      }

      // Insert message
      const { error: insertErr } = await supabase.from("email_messages").insert({
        user_id: account.user_id,
        account_id: account.id,
        thread_id: threadUuid,
        provider_message_id: msg.id,
        provider_thread_id: msg.threadId,
        from_name: fromObj.name,
        from_address: fromObj.email,
        to_addresses: parseAddressList(toHeader),
        cc_addresses: parseAddressList(ccHeader),
        bcc_addresses: parseAddressList(bccHeader),
        reply_to: parseAddressList(replyTo),
        subject: subject || null,
        snippet: msg.snippet || null,
        body_text: bodies.text || null,
        body_html: bodies.html || null,
        labels,
        is_read: !labels.includes("UNREAD"),
        is_starred: labels.includes("STARRED"),
        has_attachments: attachments.length > 0,
        internal_date: internalDate,
        size_estimate: msg.sizeEstimate || null,
        direction,
      });
      if (insertErr) continue;
      result.new_messages++;
      if (direction === "inbound") {
        result.new_inbound = (result.new_inbound || 0) + 1;
        // stash for the Lead Concierge pass after the loop (email path)
        try {
          conciergeCandidates.push({ from_address: fromObj.email, from_name: fromObj.name, subject: subject || null,
            snippet: (bodies.text || msg.snippet || "").slice(0, 600), provider_message_id: msg.id, provider_thread_id: msg.threadId, labels });
        } catch (_) {}
      }

      // Insert attachment metadata
      if (attachments.length > 0) {
        const { data: justInserted } = await supabase
          .from("email_messages")
          .select("id")
          .eq("account_id", account.id)
          .eq("provider_message_id", msg.id)
          .maybeSingle();
        if (justInserted) {
          await supabase.from("email_attachments").insert(
            attachments.map((a) => ({
              user_id: account.user_id,
              message_id: justInserted.id,
              provider_attachment_id: a.provider_attachment_id,
              filename: a.filename,
              mime_type: a.mime_type,
              size_bytes: a.size_bytes,
            })),
          );
        }
      }

      // Update thread aggregates
      if (threadUuid) {
        await supabase
          .from("email_threads")
          .update({
            snippet: msg.snippet || null,
            last_message_at: internalDate,
            has_unread: labels.includes("UNREAD"),
            labels,
          })
          .eq("id", threadUuid);
      }
    }

    // Update thread message counts where we touched
    for (const threadUuid of threadCache.values()) {
      const { count } = await supabase
        .from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("thread_id", threadUuid);
      if (typeof count === "number") {
        await supabase.from("email_threads").update({ message_count: count }).eq("id", threadUuid);
      }
    }
    result.new_threads = threadCache.size;

    // Recompute last_inbound_at / last_outbound_at on contacts whose email matches
    // any newly synced message. Cheap because we just touched these messages and
    // they're paginated by the per-run cap.
    if (result.new_messages > 0) {
      try {
        // Inbound: contacts whose email = from_address of any of OUR newly synced inbound messages
        await supabase.rpc("recompute_contact_communication", { p_user_id: account.user_id }).then(() => {}, () => {});
        // If RPC doesn't exist, fall back to direct SQL update via separate POST
        // (We define the RPC alongside this deploy.)
      } catch (_) {
        // Non-fatal — backfill remains correct because the SQL backfill above ran once
      }
    }

    // Real-time nudge: if genuinely NEW inbound mail arrived (not a backfill),
    // send ONE consolidated push. Guardrails: skip during a backfill (would spam
    // on first connect), and observe quiet hours (only 8am–9pm in the user's tz)
    // so nobody gets a 3am buzz. Dedupe is automatic — gmail-sync only sees
    // messages past the history cursor, so each inbound is counted once.
    if ((result.new_inbound || 0) > 0 && !opts.force_backfill) {
      try {
        // resolve the user's timezone (fall back to Eastern) for quiet-hours
        let tz = "America/New_York";
        try {
          const { data: prof } = await supabase.from("ari_briefing_prefs").select("tz").eq("user_id", account.user_id).maybeSingle();
          if (prof?.tz) tz = prof.tz;
        } catch (_) {}
        const localHour = parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(new Date()), 10);
        if (localHour >= 8 && localHour < 21) {
          const n = result.new_inbound;
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/push-send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              user_id: account.user_id,
              title: n === 1 ? "New message" : `${n} new messages`,
              body: n === 1 ? "You have a new email that may need a reply." : `You have ${n} new emails that may need a reply.`,
              url: "https://darasapp.com/",
              tag: "owe-reply",
            }),
          }).catch(() => {});
        }
      } catch (_) { /* push is best-effort; never block the sync */ }
    }

    // Persist sync cursor. During a backfill, don't advance historyId until the
    // backfill is complete — otherwise the next normal sync would skip past
    // anything we haven't ingested yet.
    const backfillIncomplete = opts.force_backfill && remainingAfter > 0;
    const updates = {
      initial_sync_done: true,
      last_sync_at: new Date().toISOString(),
      last_sync_error: null,
    };
    if (!backfillIncomplete) {
      updates.history_id = latestHistoryId || account.history_id;
    }
    await supabase
      .from("email_accounts")
      .update(updates)
      .eq("id", account.id);

    // ── 5-Minute Lead Concierge (email path) ────────────────────────────────
    // A new inbound email from someone who isn't an established contact is a lead
    // reaching out. Draft a first reply in the agent's voice + push them. Same
    // speed-to-lead moment as the SMS path, but for the channel the beta actually
    // uses. Skips automated/no-reply senders and anyone we already email with.
    try {
      const seen = new Set();
      for (const c of conciergeCandidates) {
        const addr = (c.from_address || "").toLowerCase().trim();
        if (!addr || seen.has(addr)) continue;
        seen.add(addr);
        // skip obvious non-humans
        if (/no-?reply|do-?not-?reply|notification|mailer-daemon|postmaster|automated|@.*(mailchimp|sendgrid|amazonses|constantcontact)/i.test(addr)) continue;
        if (addr === (account.email_address || "").toLowerCase()) continue;
        // established contact? (we've emailed them, or they're a non-lead type)
        const { data: contact } = await supabase.from("contacts")
          .select("id, name, type, last_outbound_at").eq("user_id", account.user_id)
          .ilike("email", addr).limit(1).maybeSingle();
        const established = contact && (contact.last_outbound_at || (contact.type && !["lead", "prospect", "new"].includes(String(contact.type).toLowerCase())));
        if (established) continue;
        await supabase.functions.invoke("lead-concierge", { body: {
          user_id: account.user_id, contact_id: contact ? contact.id : null,
          lead_name: (contact && contact.name) || c.from_name || null,
          lead_email: c.from_address, channel: "email",
          inbound_text: (c.subject ? "Subject: " + c.subject + "\n\n" : "") + (c.snippet || ""),
          email_context: { account_id: account.id, provider_message_id: c.provider_message_id, provider_thread_id: c.provider_thread_id, subject: c.subject },
        } });
      }
    } catch (_) { /* concierge is best-effort; never block the sync */ }

    return result;
  } catch (err) {
    await supabase
      .from("email_accounts")
      .update({ last_sync_error: String(err).slice(0, 500), last_sync_at: new Date().toISOString() })
      .eq("id", account.id);
    result.error = String(err);
    return result;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const body = await req.json().catch(() => ({}));
    const { account_id, max_initial, lookback_days, exclude_categories, force_backfill, labels, query_override } = body || {};

    // SECURITY: caller identity comes from JWT or service-role only. Body user_id IGNORED.
    // Cron runs use service-role; clients use a user JWT. Body user_id (legacy) is ignored
    // because trusting it lets any logged-in user sync another user's accounts.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const isCronCaller = token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    let callerUserId = null;
    if (!isCronCaller) {
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
      callerUserId = user.id;
    }

    let q = supabase.from("email_accounts").select("*").eq("is_active", true);
    if (account_id) q = q.eq("id", account_id);
    // For user callers, always restrict to their accounts. For cron, allow all.
    if (callerUserId) q = q.eq("user_id", callerUserId);
    const { data: accounts } = await q;
    if (!accounts || accounts.length === 0) {
      return new Response(JSON.stringify({ synced: [], note: "No accounts to sync" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results = [];
    for (const acct of accounts) {
      const r = await syncOneAccount(supabase, acct, {
        max_initial,
        lookback_days,
        exclude_categories,
        force_backfill,
        labels,
        query_override,
      });
      results.push(r);
    }

    return new Response(JSON.stringify({ synced: results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
