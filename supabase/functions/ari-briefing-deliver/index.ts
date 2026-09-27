// ari-briefing-deliver
// Hourly cron. For each user who opted into morning delivery, from their chosen
// send hour until CATCH_UP_HOURS later (and not yet delivered today), it ensures
// today's Ari Briefing is generated and emails them a concise summary through
// their own connected Gmail account.
//
// FIXED 26 Sep — Dara got the email on 3 of the previous 10 mornings:
//  1. Internal calls authenticated with this function's service key alone. Two
//     key formats are live on the project (legacy JWT, sb_secret_), and gmail-
//     send holds the other one, so it answered "Not authenticated". Every
//     internal call now also sends the shared QCP token, which matches or not
//     regardless of key format (the same fix gmail-send already documents).
//  2. "Delivered" was stamped whenever the reply had no `error` field. A gateway
//     refusal says `message`, not `error`, so on 25 Sep a send that never
//     happened was marked delivered. Now: delivered only when gmail-send answers
//     ok with a Gmail message id.
//  3. It tried exactly once, at send_hour. One failed run lost the whole day.
//     Now it retries each hour for CATCH_UP_HOURS.
//  4. Failures vanished. Every attempt now writes last_attempt_at + last_result
//     on the prefs row, and smoke/cron_health.mjs checks delivery happened.
//  5. A user with no connected email was skipped silently every day. They now
//     get the push notification, and last_result says why there was no email.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
import { logTtsUsage } from "../_shared/aiUsage.ts";
import { isServiceCaller } from "../_shared/serviceCaller.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI = Deno.env.get("OPENAI_API_KEY") || "";
const QCP = Deno.env.get("QCP_TOKEN") || "";
const CATCH_UP_HOURS = 4;   // send_hour .. send_hour+3
// Headers for function-to-function calls: the service key AND the shared token.
const internalHeaders = () => ({ Authorization: `Bearer ${SERVICE}`, "x-qcp-token": QCP, "Content-Type": "application/json" });
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

function localParts(tz: string) {
  const now = new Date();
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  let hour = parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }).format(now), 10);
  if (hour === 24) hour = 0;
  return { date, hour };
}
function spokenText(b: any, pl: any): string {
  const ros = (pl.reachouts || []).filter((r: any) => r.status === "pending");
  const parts: string[] = ["Good morning."];
  if (b.summary) parts.push(b.summary);
  if (ros.length) {
    parts.push(`You have ${ros.length} ${ros.length === 1 ? "person" : "people"} to reach out to today.`);
    ros.slice(0, 5).forEach((r: any, i: number) => parts.push(`${i + 1}. ${r.name}. ${r.reason}.`));
  }
  parts.push(`You have ${(pl.tasks || []).length} ${(pl.tasks || []).length === 1 ? "task" : "tasks"} due and ${(pl.events || []).length} ${(pl.events || []).length === 1 ? "event" : "events"} on your calendar.`);
  parts.push("Open the app to send your drafted replies. Let's make it count.");
  return parts.join(" ");
}
async function makeVoicemail(text: string): Promise<any[] | null> {
  if (!OPENAI) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "nova", input: text.slice(0, 3500), response_format: "mp3" }),
    });
    if (!r.ok) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (!buf.length) return null;
    return [{ filename: "ari-briefing.mp3", mime_type: "audio/mpeg", content_base64: encodeBase64(buf) }];
  } catch (_e) { return null; }
}
function prettyDate(d: string, tz: string) {
  try { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }); }
  catch { return d; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  // Only the cron (service role) may invoke this.
  const auth = req.headers.get("Authorization") || "";
  const tok = auth.replace("Bearer ", "");
  // Verified, not decoded — see _shared/serviceCaller.ts.
  if (!(await isServiceCaller(req))) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

  const db = createClient(SUPABASE_URL, SERVICE);
  const results: any[] = [];
  try {
    const { data: prefs } = await db.from("ari_briefing_prefs").select("*").eq("enabled", true);
    const note = async (user_id: string, result: string, delivered_date?: string) => {
      const upd: any = { last_attempt_at: new Date().toISOString(), last_result: result.slice(0, 500) };
      if (delivered_date) upd.last_delivered_date = delivered_date;
      const { error } = await db.from("ari_briefing_prefs").update(upd).eq("user_id", user_id);
      if (error) results.push({ user: user_id, note_error: error.message });
    };
    for (const p of prefs || []) {
      const tz = p.tz || "America/New_York";
      const { date, hour } = localParts(tz);
      const start = p.send_hour ?? 7;
      if (hour < start || hour >= start + CATCH_UP_HOURS) continue;  // outside today's window
      if (p.last_delivered_date === date) continue;                     // already delivered today

      // 0) Can this user receive it at all? Checked BEFORE paying for generation.
      //    Found 26 Sep: a user with no email account, no phone notifications and
      //    no sign-in for two months had a Claude-written briefing generated every
      //    morning for nobody. The Briefing screen generates on demand when opened,
      //    so nothing is lost by not writing it ahead for someone who cannot get it.
      // Only an account Google has granted SEND permission can deliver. Found
      // 26 Sep: an account connected for Calendar only (no Gmail scopes at all)
      // was chosen, the briefing was paid for, and Gmail refused the send.
      const { data: accts } = await db.from("email_accounts").select("id,email_address,purposes,scopes").eq("user_id", p.user_id);
      const canSend = (a: any) => Array.isArray(a.scopes) && a.scopes.some((sc: string) =>
        /auth\/gmail\.(send|modify|compose)$|mail\.google\.com\/?$/.test(sc));
      const senders = (accts || []).filter((a: any) => a.email_address && canSend(a));
      const acct = senders.find((a: any) => a.id === p.delivery_account_id) || senders.find((a: any) => Array.isArray(a.purposes) ? a.purposes.includes("email") : true) || senders[0];
      const { count: pushSubs } = await db.from("push_subscriptions").select("id", { count: "exact", head: true }).eq("user_id", p.user_id);
      if (!acct?.email_address && !pushSubs) {
        const why = (accts || []).length
          ? `${(accts || []).map((a: any) => a.email_address).join(", ")} connected without Gmail send permission — reconnect Gmail in Settings`
          : "no email account";
        await note(p.user_id, `no delivery channel (${why}; no phone notifications) — not generated ahead; made on demand when opened in the app`);
        results.push({ user: p.user_id, skipped: "no delivery channel" });
        continue;
      }

      // 1) ensure today's briefing exists (internal service call)
      let briefing: any = null;
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/ari-briefing`, {
          method: "POST",
          headers: internalHeaders(),
          body: JSON.stringify({ user_id: p.user_id, today: date }),
        });
        const j = await r.json().catch(() => ({}));
        briefing = j.briefing;
        if (!briefing) { await note(p.user_id, `no briefing: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`); results.push({ user: p.user_id, skipped: "no briefing", status: r.status }); continue; }
      } catch (e) { await note(p.user_id, "no briefing: " + String(e)); results.push({ user: p.user_id, skipped: "no briefing" }); continue; }

      // 2) the sending account was resolved in step 0
      const push = async () => {
        try {
          const pr = await fetch(`${SUPABASE_URL}/functions/v1/push-send`, {
            method: "POST",
            headers: internalHeaders(),
            body: JSON.stringify({ user_id: p.user_id, title: "Ari Daily Briefing \u2600\ufe0f", body: (briefing.summary || "Your morning briefing is ready.").slice(0, 140), url: "https://darasapp.com" }),
          });
          return pr.ok;
        } catch (_e) { return false; }
      };
      if (!acct?.email_address) {
        // Nothing to email FROM. The briefing is in the app; tell them on the phone,
        // and say plainly why no email came, instead of skipping in silence daily.
        const pushed = await push();
        await note(p.user_id, `push only (no email account connected)${pushed ? "" : " — push also failed"}`, date);
        results.push({ user: p.user_id, delivered: "push only", pushed });
        continue;
      }

      // 3) build the email
      const pl = briefing.payload || {};
      const ros = (pl.reachouts || []).filter((r: any) => r.status === "pending");
      const lines: string[] = [];
      if (briefing.summary) lines.push(briefing.summary, "");
      if (ros.length) {
        lines.push(`WHO TO REACH OUT TO (${ros.length}):`);
        ros.forEach((r: any, i: number) => lines.push(`${i + 1}. ${r.name} — ${r.reason}`));
        lines.push("");
      }
      lines.push(`Today: ${(pl.tasks || []).length} task(s) due · ${(pl.events || []).length} event(s) on the calendar.`);
      lines.push("", "Open your full briefing (drafts ready to send): https://darasapp.com", "", "— Ari");
      const body_text = lines.join("\n");
      const subject = `Your Ari Briefing — ${prettyDate(date, tz)}`;

      // 3b) generate the spoken "voicemail" (OpenAI TTS) to attach
      const spoken = spokenText(briefing, pl);
      const attachments = await makeVoicemail(spoken);
      if (attachments) await logTtsUsage(db, { userId: p.user_id, fn: "ari-briefing-deliver", model: "gpt-4o-mini-tts", chars: Math.min(spoken.length, 3500) });

      // 4) send to themselves via gmail-send (internal service call)
      try {
        const sr = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
          method: "POST",
          headers: internalHeaders(),
          body: JSON.stringify({ user_id: p.user_id, account_id: acct.id, to: acct.email_address, subject, body_text, attachments }),
        });
        const sj = await sr.json().catch(() => ({}));
        // Sent means Gmail gave us a message id — not merely "no `error` field".
        if (!sr.ok || !sj.ok || !sj.provider_message_id) {
          const why = `email not sent: HTTP ${sr.status} ${JSON.stringify(sj).slice(0, 300)}`;
          await note(p.user_id, why);
          results.push({ user: p.user_id, error: why });
          continue;   // not stamped: the next hourly run retries within the window
        }
      } catch (e) { await note(p.user_id, "email not sent: " + String(e)); results.push({ user: p.user_id, error: String(e) }); continue; }

      // 4b) phone push notification (best effort)
      const pushed = await push();

      // 5) mark delivered
      await note(p.user_id, `sent to ${acct.email_address}${pushed ? " + push" : ""}`, date);
      results.push({ user: p.user_id, delivered: true, to: acct.email_address });
    }
    return new Response(JSON.stringify({ ran: true, results }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
