// gmail-discover
// Headers-only discovery sweep: walks up to N years of a connected mailbox and
// records WHO the user corresponds with — never message bodies, never stored content.
//
// Purpose: the CRM knows a fraction of the people the mailbox knows. This builds a
// reviewable queue of proposed contacts (two-way correspondents, ranked) so the user
// can accept the ones worth keeping. Nothing is written to contacts by this function.
//
// Body: { account_id: uuid, years?: number (default 10), pages?: number (default 6),
//         phase?: 'sent'|'inbound' }
//   Each call processes `pages` list-pages (500 ids each) and returns progress.
//   Caller loops until { done: true }. Resume state lives in discovery_runs.
//
// Auth: user JWT (own accounts only) or service-role. Body user_id is ignored.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Automated senders never become proposed contacts. Kept deliberately narrow:
// we exclude role and bulk addresses, not whole corporate domains, so a real
// person at a big company still surfaces.
const NON_HUMAN = [
  /noreply/i, /no-reply/i, /donotreply/i, /^notifications?@/i, /^news(letters?)?@/i,
  /^alerts?@/i, /^updates?@/i, /^digest@/i, /^broadcast@/i, /^mailer/i, /^bounce/i,
  /^support@/i, /^helpdesk@/i, /^marketing@/i, /^billing@/i, /^receipts?@/i,
  /mailchimpapp\.com$/i, /sendgrid\.net$/i, /mailgun\.org$/i, /amazonses\.com$/i,
  /mailjet\.com$/i, /campaignmonitor\.com$/i, /constantcontact\.com$/i, /klaviyo/i,
  /@(e|em|mail|news|email|alerts|updates|click|link|campaign|marketing)\./i,
  /\.(invalid|test|example)$/i,
  // Intake and forwarding addresses: mail the user sends to a tool, not a person.
  /evernote\.com$/i, /addtodropbox\.com$/i, /\.appspotmail\.com$/i,
  /@(docs|drive|calendar|tasks)\.google\.com$/i, /^scan(ner)?@/i, /^fax@/i,
  /@mg\./i, /^postmaster@/i, /^root@/i, /^admin@/i, /^info@/i, /^sales@/i,
];
// Subject words that mark a thread as transaction-shaped. A hit is evidence the
// correspondent was a client or a party to a deal, not an acquaintance.
const TXN = /(under contract|closing|closed on|inspection|appraisal|escrow|title|listing agreement|purchase agreement|addendum|walk[- ]?through|offer accepted|counter offer|settlement statement|closing disclosure)/i;

function isHuman(addr: string): boolean {
  if (!addr || !addr.includes("@")) return false;
  for (const p of NON_HUMAN) if (p.test(addr)) return false;
  return true;
}

function parseAddrs(v: string | undefined): { addr: string; name: string }[] {
  if (!v) return [];
  const out: { addr: string; name: string }[] = [];
  for (const part of v.split(",")) {
    const m = part.match(/<([^>]+)>/);
    const addr = (m ? m[1] : part).trim().toLowerCase().replace(/^["']|["']$/g, "");
    if (!addr.includes("@")) continue;
    let name = m ? part.slice(0, part.indexOf("<")).trim().replace(/^["']|["']$/g, "") : "";
    if (name.toLowerCase() === addr) name = "";
    out.push({ addr, name });
  }
  return out;
}

async function refreshAccessTokenIfNeeded(supabase: any, account: any) {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) return account.access_token;
  if (!account.refresh_token) throw new Error("No refresh_token on account — reconnect Gmail.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID") as string,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET") as string,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error("Token refresh failed: " + r.status + " " + (await r.text()).slice(0, 200));
  const t = await r.json();
  await supabase.from("email_accounts")
    .update({ access_token: t.access_token, token_expires_at: new Date(now + ((t.expires_in || 3600) - 60) * 1000).toISOString() })
    .eq("id", account.id);
  return t.access_token;
}

// Gmail's batch endpoint: up to 100 message.get calls in one HTTP request.
// Doing these one at a time is ~10x slower and burns the function's time budget.
async function batchMetadata(token: string, ids: string[]) {
  const boundary = "b" + crypto.randomUUID().replace(/-/g, "");
  let body = "";
  for (const id of ids) {
    body += "--" + boundary + "\r\nContent-Type: application/http\r\n\r\n";
    body += "GET /gmail/v1/users/me/messages/" + id +
      "?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject\r\n\r\n";
  }
  body += "--" + boundary + "--";
  const r = await fetch("https://gmail.googleapis.com/batch/gmail/v1", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "multipart/mixed; boundary=" + boundary },
    body,
  });
  const text = await r.text();
  const out: any[] = [];
  for (const chunk of text.split(/--batch[^\r\n]*/)) {
    const i = chunk.indexOf("{");
    if (i < 0) continue;
    try {
      const obj = JSON.parse(chunk.slice(i, chunk.lastIndexOf("}") + 1));
      if (obj && obj.id) out.push(obj);
    } catch (_) { /* a malformed part is a skipped message, not a failed run */ }
  }
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL") as string, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string);
    const body = await req.json().catch(() => ({}));
    const accountId = body.account_id;
    const years = Math.min(Math.max(body.years || 10, 1), 20);
    const pages = Math.min(Math.max(body.pages || 2, 1), 3);
    let phase = body.phase === "inbound" ? "inbound" : body.phase === "sent" ? "sent" : "";

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    const qcp = req.headers.get("x-qcp-token") || "";
    // pg_cron drives the sweep to completion: a browser-driven loop dies with the tab.
    const isCron = qcp && qcp === Deno.env.get("QCP_TOKEN");
    const isService = isCron || (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    let callerUserId: string | null = null;
    if (!isService) {
      if (!token) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const { data: { user } } = await supabase.auth.getUser(token);
      if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      callerUserId = user.id;
    }

    let resumeRun: any = null;
    if (isCron && !accountId) {
      const { data: open } = await supabase.from("discovery_runs")
        .select("*").eq("status", "running").order("started_at", { ascending: true }).limit(1);
      resumeRun = open && open[0];
      if (!resumeRun) {
        return new Response(JSON.stringify({ ok: true, idle: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    let aq = supabase.from("email_accounts").select("*").eq("is_active", true).limit(1);
    if (accountId) aq = aq.eq("id", accountId);
    else if (resumeRun) aq = aq.eq("id", resumeRun.account_id);
    if (callerUserId) aq = aq.eq("user_id", callerUserId);
    const { data: accounts, error: aerr } = await aq;
    if (aerr) throw aerr;
    const account = accounts && accounts[0];
    if (!account) return new Response(JSON.stringify({ error: "No matching email account" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const accessToken = await refreshAccessTokenIfNeeded(supabase, account);

    if (!phase) {
      const { data: prior } = await supabase.from("discovery_runs")
        .select("phase,status").eq("user_id", account.user_id).eq("account_id", account.id);
      const doneSet = new Set((prior || []).filter((r: any) => r.status === "done").map((r: any) => r.phase));
      phase = doneSet.has("sent") ? "inbound" : "sent";
      if (doneSet.has("sent") && doneSet.has("inbound")) {
        return new Response(JSON.stringify({ ok: true, idle: true, all_phases_done: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Resume state
    const { data: runs } = await supabase.from("discovery_runs")
      .select("*").eq("user_id", account.user_id).eq("account_id", account.id)
      .eq("phase", phase).eq("status", "running").order("started_at", { ascending: false }).limit(1);
    let run = runs && runs[0];
    if (!run) {
      const { data: ins, error: ierr } = await supabase.from("discovery_runs")
        .insert({ user_id: account.user_id, account_id: account.id, phase }).select().single();
      if (ierr) throw ierr;
      run = ins;
    }

    const after = Math.floor(Date.now() / 1000) - years * 365 * 86400;
    const q = phase === "sent"
      ? "in:sent after:" + after + " -in:chats"
      : "after:" + after + " -in:chats -in:sent -category:promotions -category:updates -category:social -category:forums";

    const agg = new Map<string, any>();
    let pageToken = run.page_token || undefined;
    let listed = 0, fetched = 0, missed = 0, done = false, quotaPaused = false;

    // The runtime cuts a request off at 150s. A page is ~500 messages and takes
    // 25-40s, and breaking mid-page would double-count on resume (the page token
    // only advances on a completed page), so stop cleanly between pages.
    const deadline = Date.now() + 60000;
    for (let p = 0; p < pages; p++) {
      if (Date.now() > deadline) break;
      const params = new URLSearchParams({ q, maxResults: "500" });
      if (pageToken) params.set("pageToken", pageToken);
      let lr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?" + params.toString(), { headers: { Authorization: "Bearer " + accessToken } });
      for (let a = 0; a < 3 && (lr.status === 429 || lr.status === 403); a++) {
        // Gmail meters per-user units per MINUTE. Hitting the ceiling is pacing,
        // not failure: wait it out rather than losing the slice.
        await new Promise((r) => setTimeout(r, 15000));
        lr = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?" + params.toString(), { headers: { Authorization: "Bearer " + accessToken } });
      }
      if (lr.status === 429 || lr.status === 403) { quotaPaused = true; break; }
      if (!lr.ok) throw new Error("Gmail list " + lr.status + ": " + (await lr.text()).slice(0, 200));
      const lj = await lr.json();
      const ids = (lj.messages || []).map((m: any) => m.id);
      listed += ids.length;
      for (let i = 0; i < ids.length; i += 50) {
        const slice = ids.slice(i, i + 50);
        let msgs = await batchMetadata(accessToken, slice);
        // Gmail rate-limits inside a batch: some sub-requests come back 429 with no
        // message body. Silently accepting the short result would report a clean
        // sweep that quietly skipped a third of the mail, so retry what is missing.
        for (let attempt = 0; attempt < 3; attempt++) {
          const got = new Set(msgs.map((m: any) => m.id));
          const missing = slice.filter((id: string) => !got.has(id));
          if (!missing.length) break;
          await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
          const more = await batchMetadata(accessToken, missing);
          msgs = msgs.concat(more);
        }
        // Gmail allows ~15,000 quota units per user per minute and a metadata get costs
        // 5, so ~3,000 messages/minute is the ceiling. Pace to stay under it: going
        // faster just converts messages into 429s that look like a clean sweep.
        await new Promise((r) => setTimeout(r, 1200));
        missed += slice.length - msgs.length;
        fetched += msgs.length;
        for (const m of msgs) {
          const h: Record<string, string> = {};
          for (const x of (m.payload?.headers || [])) h[x.name.toLowerCase()] = x.value;
          const when = new Date(Number(m.internalDate || 0)).toISOString();
          const subj = h.subject || "";
          const txn = TXN.test(subj) ? 1 : 0;
          const people = phase === "sent"
            ? [...parseAddrs(h.to), ...parseAddrs(h.cc)]
            : parseAddrs(h.from);
          for (const person of people) {
            if (!isHuman(person.addr)) continue;
            if (person.addr === (account.email_address || "").toLowerCase()) continue;
            const cur = agg.get(person.addr) || { address: person.addr, display_name: person.name || null, sent: 0, inbound: 0, first: when, last: when, txn: 0, subjects: [] as string[] };
            if (phase === "sent") cur.sent++; else cur.inbound++;
            if (person.name && !cur.display_name) cur.display_name = person.name;
            if (when < cur.first) cur.first = when;
            if (when > cur.last) cur.last = when;
            cur.txn += txn;
            if (txn && cur.subjects.length < 3) cur.subjects.push(subj.slice(0, 140));
            agg.set(person.addr, cur);
          }
        }
      }
      pageToken = lj.nextPageToken;
      if (!pageToken) { done = true; break; }
    }

    // Merge this slice into the queue. Counters accumulate across calls, so a
    // resumed run adds to what earlier slices found rather than replacing it.
    const addrs = [...agg.keys()];
    if (addrs.length) {
      const existing: any[] = [];
      for (let i = 0; i < addrs.length; i += 100) {
        const { data: part, error: eerr } = await supabase.from("discovered_correspondents")
          .select("id,address,sent_count,inbound_count,first_seen,last_seen,txn_hits,sample_subjects,display_name,status")
          .eq("user_id", account.user_id).in("address", addrs.slice(i, i + 100));
        if (eerr) throw eerr;
        if (part) existing.push(...part);
      }
      const byAddr = new Map(existing.map((r: any) => [r.address, r]));
      const rows: any[] = [];
      for (const [addr, v] of agg) {
        const e: any = byAddr.get(addr);
        // No id in the row: the unique (user_id,address) conflict target does the
        // matching. Mixing rows with and without id makes PostgREST fill the gap
        // with null and the insert fails the not-null constraint.
        rows.push({
          user_id: account.user_id,
          account_id: account.id,
          address: addr,
          display_name: e?.display_name || v.display_name,
          sent_count: (e?.sent_count || 0) + v.sent,
          inbound_count: (e?.inbound_count || 0) + v.inbound,
          first_seen: e?.first_seen && e.first_seen < v.first ? e.first_seen : v.first,
          last_seen: e?.last_seen && e.last_seen > v.last ? e.last_seen : v.last,
          txn_hits: (e?.txn_hits || 0) + v.txn,
          sample_subjects: (e?.sample_subjects?.length ? e.sample_subjects : v.subjects),
          status: e?.status || "proposed",
          updated_at: new Date().toISOString(),
        });
      }
      for (let i = 0; i < rows.length; i += 200) {
        const slice = rows.slice(i, i + 200);
        const { error: uerr } = await supabase.from("discovered_correspondents").upsert(slice, { onConflict: "user_id,address" });
        if (uerr) throw uerr;   // a silent failure here would report a sweep that stored nothing
      }
    }

    const { error: rerr } = await supabase.from("discovery_runs").update({
      page_token: done ? null : pageToken,
      listed: (run.listed || 0) + listed,
      fetched: (run.fetched || 0) + fetched,
      status: done ? "done" : "running",
      finished_at: done ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }).eq("id", run.id);
    if (rerr) throw rerr;

    return new Response(JSON.stringify({
      ok: true, phase, done, quota_paused: quotaPaused, listed_this_call: listed, fetched_this_call: fetched,
      people_touched: agg.size, missed_this_call: missed, total_listed: (run.listed || 0) + listed, total_fetched: (run.fetched || 0) + fetched,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    const msg = (err && (err.message || err.error_description || err.hint || err.details)) ? [err.message, err.details, err.hint, err.code].filter(Boolean).join(" | ") : String(err);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
