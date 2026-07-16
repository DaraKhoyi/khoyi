// Detects bounced ("Delivery Status Notification (Failure)") emails and records them.
//
// WHY THIS EXISTS: the Gmail API returns 200 OK the moment it ACCEPTS a send. Delivery
// failure arrives seconds-to-minutes later as a separate mailer-daemon message. So the
// app happily says "Sent." for an email that nobody received. That is the worst class of
// bug: silent, and it looks like success.
//
// MATCHING: we do NOT rely on linking back to our stored sent row — email_messages.
// raw_headers is empty, the bounce lands in its own Gmail thread, and when a send fails
// at SMTP auth the original may never be indexed at all. Instead we parse the bounce,
// which is self-contained: RFC 3464 puts the failed address in X-Failed-Recipients and
// the original's headers in a text/rfc822-headers part. Gmail emits ONE bounce PER failed
// recipient, so we group by the original Message-ID and accumulate the recipients.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const INGEST = Deno.env.get("INGEST_TOKEN") || "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function accessToken(admin: any, account: any) {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120000) return account.access_token;
  if (!account.refresh_token) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) return null;
  const t = await r.json();
  await admin.from("email_accounts").update({
    access_token: t.access_token,
    token_expires_at: new Date(now + ((t.expires_in || 3600) - 60) * 1000).toISOString(),
  }).eq("id", account.id);
  return t.access_token;
}

// Classify the failure into something a human can act on. Order matters: the alias
// check must come first, because an auth failure also mentions generic delivery words.
function classify(text: string): { code: string; fix: string } {
  const t = (text || "").toLowerCase();
  if (/send mail as|customfromdenied|sasl_auth_failure|link not found|account credentials|smtp.*(username|password)/.test(t))
    return { code: "alias_misconfigured", fix: "The “Send mail as” alias you sent from can’t sign in to its mail provider. Re-enter its credentials in Gmail → Settings → Accounts and Import → Send mail as. Yahoo/Outlook aliases need an app-specific password, not your normal one. Nothing reached anyone — resend once it’s fixed." };
  if (/5\.1\.1|address not found|user unknown|no such user|does not exist|recipient rejected|unknown recipient/.test(t))
    return { code: "address_not_found", fix: "That address doesn’t exist at the receiving server — almost always a typo or a person who’s left. Check the spelling and resend." };
  if (/5\.2\.2|quota|mailbox (is )?full|over.?quota|insufficient storage/.test(t))
    return { code: "mailbox_full", fix: "Their mailbox is full. Try a different address for them, or call — this one is on their side." };
  if (/5\.7\.1|spam|blocked|blacklist|reputation|policy|reject.*content|dmarc|spf|dkim/.test(t))
    return { code: "blocked_spam", fix: "The receiving server rejected it as spam or on policy. Don’t just resend the same message — reword it, drop links/attachments, or reach them another way." };
  if (/message.*too large|exceeds.*size|5\.3\.4/.test(t))
    return { code: "too_large", fix: "The message was too big for their server. Send the attachment as a link instead." };
  if (/5\.1\.2|domain.*not found|dns|mx record|host.*not found/.test(t))
    return { code: "domain_not_found", fix: "Their whole email domain couldn’t be found — check the part after the @, it may be misspelled or the domain may be gone." };
  return { code: "unknown", fix: "This message was not delivered. Review the reason below and resend or reach them another way." };
}

// Minimal MIME walker — we only need headers of specific parts, so a full parser is overkill.
function decodeB64Url(s: string) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
// Decode RFC 2047 encoded-words ( =?UTF-8?B?..?= / =?UTF-8?Q?..?= ). The original
// subject arrives encoded inside the bounce, so we must decode it or we'd store
// gibberish — the exact class of bug this whole session was about.
function decodeWords(input: string | null): string | null {
  if (!input) return input;
  let s = String(input);
  // Adjacent encoded-words separated only by whitespace fold into one run.
  s = s.replace(/\?=[ \t]*\r?\n?[ \t]*=\?/g, "?==?");
  return s.replace(/=\?([A-Za-z0-9_-]+)\?([BbQq])\?([^?]*)\?=/g, (_m, cs, enc, txt) => {
    try {
      let bytes: Uint8Array;
      if (enc.toUpperCase() === "B") {
        const bin = atob(txt);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      } else {
        const t = String(txt).replace(/_/g, " ");
        const out: number[] = [];
        for (let i = 0; i < t.length; i++) {
          if (t[i] === "=" && i + 2 < t.length) { out.push(parseInt(t.slice(i + 1, i + 3), 16)); i += 2; }
          else out.push(t.charCodeAt(i));
        }
        bytes = new Uint8Array(out);
      }
      const label = String(cs).toLowerCase();
      const dec = new TextDecoder(label === "utf-8" || label === "utf8" ? "utf-8" : label);
      return dec.decode(bytes);
    } catch (_) { return _m; }
  });
}

function headerVal(block: string, name: string): string | null {
  const re = new RegExp("^" + name + ":[ \\t]*([\\s\\S]*?)(?=\\r?\\n[^ \\t]|$)", "im");
  const m = block.match(re);
  return m ? m[1].replace(/\r?\n[ \t]+/g, " ").trim() : null;
}

async function scanUser(admin: any, userId: string, days: number) {
  const { data: accounts } = await admin.from("email_accounts").select("*").eq("user_id", userId).neq("is_active", false);
  let found = 0, recorded = 0;
  for (const acc of accounts || []) {
    const tok = await accessToken(admin, acc);
    if (!tok) continue;
    const H = { Authorization: `Bearer ${tok}` };
    const q = `(from:mailer-daemon OR from:postmaster) newer_than:${days}d`;
    const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=50`, { headers: H });
    if (!list.ok) continue;
    const msgs = (await list.json()).messages || [];
    // group by the original Message-ID: Gmail sends one bounce per failed recipient
    const groups: Record<string, any> = {};
    for (const m of msgs) {
      const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=raw`, { headers: H });
      if (!r.ok) continue;
      const raw = decodeB64Url((await r.json()).raw);
      const headBlock = raw.split(/\r?\n\r?\n/)[0] || "";
      const ct = headerVal(headBlock, "Content-Type") || "";
      const autoSub = headerVal(headBlock, "Auto-Submitted") || "";
      // RFC 3464 delivery reports are the definitive signature.
      if (!/report-type=delivery-status/i.test(ct) && !/auto-replied/i.test(autoSub)) continue;
      found++;
      let failed = (headerVal(headBlock, "X-Failed-Recipients") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (!failed.length) {
        // Not every provider sets X-Failed-Recipients. RFC 3464 delivery-status parts
        // always carry Final-Recipient — fall back to those.
        const fr = [...raw.matchAll(/^Final-Recipient:\s*rfc822;\s*([^\r\n]+)/gim)].map((m) => String(m[1]).trim().toLowerCase());
        failed = [...new Set(fr)];
      }
      const inReplyTo = headerVal(headBlock, "In-Reply-To") || "";
      const dateHdr = headerVal(headBlock, "Date");

      // The original's headers ride along in a text/rfc822-headers part.
      let origSubject: string | null = null, origMsgId: string | null = null, origFrom: string | null = null, origDate: string | null = null;
      const idx = raw.search(/Content-Type:\s*text\/rfc822-headers/i);
      if (idx >= 0) {
        const after = raw.slice(idx);
        const body = after.split(/\r?\n\r?\n/).slice(1).join("\n\n");
        origSubject = decodeWords(headerVal(body, "Subject"));
        origMsgId = headerVal(body, "Message-ID") || headerVal(body, "Message-Id");
        origFrom = decodeWords(headerVal(body, "From"));
        origDate = headerVal(body, "Date");
      }
      const key = origMsgId || inReplyTo || ("bounce:" + m.id);

      // Human-readable reason from the plain-text part of the report.
      let reason = "";
      const pIdx = raw.search(/Content-Type:\s*text\/plain/i);
      if (pIdx >= 0) {
        const seg = raw.slice(pIdx).split(/\r?\n\r?\n/).slice(1).join("\n\n");
        reason = seg.split(/--[0-9a-zA-Z]{8,}/)[0].replace(/=\r?\n/g, "").replace(/\s+\n/g, "\n").trim().slice(0, 900);
      }
      if (!groups[key]) groups[key] = { origSubject, origMsgId: origMsgId || inReplyTo || null, origFrom, origDate, reason, failed: new Set<string>(), ids: new Set<string>(), bouncedAt: dateHdr };
      for (const f of failed) groups[key].failed.add(f);
      groups[key].ids.add(m.id);
      if (!groups[key].reason && reason) groups[key].reason = reason;
    }

    for (const [key, g] of Object.entries<any>(groups)) {
      const { code, fix } = classify(g.reason || "");
      const row = {
        user_id: userId,
        account_id: acc.id,
        original_message_id: key,
        original_subject: g.origSubject || null,
        original_sent_at: g.origDate ? new Date(g.origDate).toISOString() : null,
        from_address: g.origFrom || null,
        failed_recipients: [...g.failed],
        reason_code: code,
        reason_text: (g.reason || "").slice(0, 900) || null,
        fix_hint: fix,
        bounce_message_ids: [...g.ids],
        bounced_at: g.bouncedAt ? new Date(g.bouncedAt).toISOString() : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      // Never resurrect something the user already dealt with: onConflict updates the
      // facts but leaves `handled` alone.
      const { error } = await admin.from("email_bounces").upsert(row, { onConflict: "user_id,original_message_id", ignoreDuplicates: false });
      if (!error) recorded++;
    }
  }
  return { found, recorded };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const days = Math.min(Math.max(parseInt(body.days || "7", 10) || 7, 1), 30);
    const internal = INGEST && (req.headers.get("x-internal-token") || "") === INGEST;

    if (internal) {
      // Cron sweep: every user with an active account.
      const { data: accts } = await admin.from("email_accounts").select("user_id").neq("is_active", false);
      const users = [...new Set((accts || []).map((a: any) => a.user_id))];
      let tot = { found: 0, recorded: 0 };
      for (const u of users) {
        const r = await scanUser(admin, u as string, days);
        tot.found += r.found; tot.recorded += r.recorded;
      }
      return json({ ok: true, users: users.length, ...tot });
    }

    const anonClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);
    const r = await scanUser(admin, user.id, days);
    return json({ ok: true, ...r });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
