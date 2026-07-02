// email-nightly-intel
// Unattended nightly pass over synced mail. Runs as service-role via pg_cron.
// Pipeline per active account:
//   1. FREE sender-stats rollup (labels/volume/opens/replies) — no tokens.
//   2. Unsubscribe recommendations from bulk + volume + zero-engagement.
//   3. Token-GUARDED Claude triage on ONLY non-bulk, unread, un-reviewed
//      threads since the last watermark (global nightly cap, dedup by thread).
//   4. List-Unsubscribe fetched from Gmail for just the top recommended senders.
//   5. Everything lands in email_review_items / email_sender_stats for the
//      morning surface; a row per run is logged in email_intel_runs.
//
// Bulk (Promotions/Social/Forums/Spam) is skipped BEFORE any model call, so
// marketing never costs tokens — it only feeds the unsubscribe recommender.
//
// POST body (all optional): { ai_max=40, stats_days=45, unsub_max_fetch=20,
//   watermark_days=2, account_id?, dry_run=false }
// Auth: Authorization: Bearer <service_role>  OR  x-internal-token: <INTERNAL>.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID");
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET");
const INTERNAL_TOKEN = Deno.env.get("EMAIL_INTEL_TOKEN") || "";

const MODEL = "claude-sonnet-4-6";
const PROMPT_VERSION = "intel-v1";
const BULK_LABELS = ["SPAM", "CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];

const SYSTEM = `You triage a single incoming email for a real-estate broker/owner.
Return ONLY a JSON object, no prose:
{"category":"urgent|requires_response|fyi|can_wait|promotional|spam",
 "action":"reply_now|reply_today|schedule_reply|archive|ignore|snooze",
 "summary":"one concise line, <=140 chars",
 "reasoning":"short why",
 "confidence":0..1,
 "money":true|false,          // mentions a specific dollar amount, payment, wire, invoice, offer
 "deadline":null|"YYYY-MM-DD or short phrase", // explicit date/deadline to act by
 "legal":true|false}          // contract, signature, dispute, attorney, compliance
Be conservative: only "urgent" for genuine time-critical items.`;

function j(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function safeJSON(text: string) {
  const c = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("no json");
  return JSON.parse(c.slice(s, e + 1));
}

async function callClaude(userText: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, system: SYSTEM, messages: [{ role: "user", content: userText }] }),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const jr = await r.json();
  return (jr.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
}

// Reused OAuth refresh (mirrors gmail-sync). Returns a valid access token.
async function accessToken(supabase: any, account: any): Promise<string> {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) return account.access_token;
  if (!account.refresh_token || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) throw new Error("no refresh");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: account.refresh_token, grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const t = await r.json();
  const newExp = new Date(now + ((t.expires_in || 3600) - 60) * 1000).toISOString();
  await supabase.from("email_accounts").update({ access_token: t.access_token, token_expires_at: newExp }).eq("id", account.id);
  account.access_token = t.access_token; account.token_expires_at = newExp;
  return t.access_token;
}

function parseListUnsub(headerVal: string | null): { url: string | null } {
  if (!headerVal) return { url: null };
  const https = headerVal.match(/<(https?:\/\/[^>]+)>/i);
  if (https) return { url: https[1] };
  const mailto = headerVal.match(/<(mailto:[^>]+)>/i);
  return { url: mailto ? mailto[1] : null };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  // ── auth: service-role bearer or internal token ──
  const auth = req.headers.get("authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const xint = req.headers.get("x-internal-token") || "";
  if (bearer !== SERVICE_ROLE && !(INTERNAL_TOKEN && xint === INTERNAL_TOKEN)) {
    return j({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const aiMax = Math.max(0, Math.min(Number(body.ai_max ?? 40), 150));
  const statsDays = Math.max(7, Math.min(Number(body.stats_days ?? 45), 120));
  const unsubMaxFetch = Math.max(0, Math.min(Number(body.unsub_max_fetch ?? 20), 60));
  const watermarkDays = Math.max(1, Math.min(Number(body.watermark_days ?? 2), 30));
  const dryRun = !!body.dry_run;

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE);
  let acctQ = supabase.from("email_accounts").select("*").eq("is_active", true).eq("provider", "google");
  if (body.account_id) acctQ = acctQ.eq("id", body.account_id);
  const { data: accounts, error: acctErr } = await acctQ;
  if (acctErr) return j({ error: acctErr.message }, 500);

  let pool = aiMax;
  const summary: any[] = [];

  for (let idx = 0; idx < (accounts || []).length; idx++) {
    const account = accounts[idx];
    const runStart = new Date().toISOString();
    const uid = account.user_id;
    const runRow: any = { account_id: account.id, user_id: uid, started_at: runStart, status: "running",
      scanned: 0, bulk_skipped: 0, ai_reviewed: 0, flagged: 0, unsub_recos: 0, ai_calls: 0 };
    try {
      // watermark = last successful run's through_ts, else now()-watermarkDays
      const { data: lastRun } = await supabase.from("email_intel_runs")
        .select("through_ts").eq("account_id", account.id).eq("status", "ok")
        .order("through_ts", { ascending: false }).limit(1).maybeSingle();
      const since = lastRun?.through_ts
        ? new Date(lastRun.through_ts).toISOString()
        : new Date(Date.now() - watermarkDays * 86400000).toISOString();
      runRow.since_ts = since;

      // VIP set: contacts' emails for this user
      const vip = new Set<string>();
      const { data: contactRows } = await supabase.from("contacts").select("email").eq("user_id", uid).not("email", "is", null).limit(5000);
      (contactRows || []).forEach((c: any) => c.email && vip.add(String(c.email).toLowerCase()));

      // ── 1+2. FREE sender rollup + unsubscribe recommendations ──
      const { data: roll, error: rollErr } = await supabase.rpc("email_sender_rollup", { p_account: account.id, p_days: statsDays });
      if (rollErr) throw new Error("rollup: " + rollErr.message);
      const senderByAddr = new Map<string, any>();
      let unsubRecos = 0;
      const upserts: any[] = [];
      for (const s of roll || []) {
        const total = s.msg_count || 0;
        const bulkRatio = total ? (s.bulk_count || 0) / total : 0;
        const openRatio = total ? (s.opened_count || 0) / total : 0;
        const isBulk = bulkRatio >= 0.6;
        const recommend = isBulk && !s.replied && (s.msg_count_30d || 0) >= 4 && openRatio < 0.15 && total >= 5;
        let reason = null;
        if (recommend) {
          reason = `${s.msg_count_30d} in 30d, ${Math.round(openRatio * 100)}% opened, never replied`;
          unsubRecos++;
        }
        senderByAddr.set(s.addr, s);
        upserts.push({
          user_id: uid, account_id: account.id, sender_address: s.addr, sender_domain: s.sender_domain,
          display_name: s.display_name, first_seen: s.first_seen, last_seen: s.last_seen,
          msg_count_total: total, msg_count_30d: s.msg_count_30d || 0, bulk_count: s.bulk_count || 0,
          opened_count: s.opened_count || 0, replied: !!s.replied, is_bulk: isBulk,
          unsubscribe_recommended: recommend, recommend_reason: reason, updated_at: new Date().toISOString(),
        });
      }
      if (!dryRun && upserts.length) {
        // preserve manual status/list_unsubscribe: only update the computed fields on conflict
        for (let i = 0; i < upserts.length; i += 500) {
          const chunk = upserts.slice(i, i + 500);
          const { error: upErr } = await supabase.from("email_sender_stats")
            .upsert(chunk, { onConflict: "account_id,sender_address" });
          if (upErr) throw new Error("sender upsert: " + upErr.message);
        }
      }
      runRow.unsub_recos = unsubRecos;

      // ── 3. Token-guarded AI triage on non-bulk unread threads ──
      let reviewed = 0, flagged = 0, aiCalls = 0, throughTs = since;
      // Fair share: divide remaining budget across the accounts still to process,
      // so the first account can't starve the rest. Unused budget rolls forward.
      const accountsLeft = accounts.length - idx;
      let acctCap = Math.max(0, Math.min(pool, Math.ceil(pool / Math.max(1, accountsLeft))));
      if (acctCap > 0) {
        const { data: cands, error: candErr } = await supabase.rpc("email_ai_candidates",
          { p_account: account.id, p_since: since, p_limit: Math.min(acctCap, 60) });
        if (candErr) throw new Error("candidates: " + candErr.message);
        for (const m of cands || []) {
          if (acctCap <= 0) break;
          if (m.received_at && m.received_at > throughTs) throughTs = m.received_at;
          const fromAddr = (m.from_address || "").toLowerCase();
          const isVip = vip.has(fromAddr);
          const st = senderByAddr.get(fromAddr);
          const firstTime = !st || ((st.msg_count || 0) <= 2 && st.first_seen && (Date.now() - new Date(st.first_seen).getTime()) < 14 * 86400000);
          const bodyTrim = (m.body_text || m.snippet || "").replace(/\s+/g, " ").slice(0, 1500);
          const userText =
            `FROM: ${m.from_name || ""} <${fromAddr}>\nSUBJECT: ${m.subject || "(none)"}\n` +
            `KNOWN_CONTACT: ${isVip ? "yes" : "no"}\nFIRST_TIME_SENDER: ${firstTime ? "yes" : "no"}\n\n${bodyTrim}`;
          let parsed: any;
          try { parsed = safeJSON(await callClaude(userText)); aiCalls++; acctCap--; pool--; }
          catch (_e) { acctCap--; pool--; continue; }

          const reasons: any = {};
          if (parsed.money) reasons.money = true;
          if (parsed.deadline) reasons.deadline = parsed.deadline;
          if (parsed.legal) reasons.legal = true;
          if (firstTime) reasons.first_time = true;
          if (isVip) reasons.known_contact = true;

          const cat = String(parsed.category || "fyi");
          const base: Record<string, number> = { urgent: 90, requires_response: 70, can_wait: 40, fyi: 20, promotional: 10, spam: 0 };
          let priority = base[cat] ?? 20;
          if (reasons.money) priority += 10;
          if (reasons.deadline) priority += 15;
          if (reasons.legal) priority += 10;
          if (reasons.known_contact) priority += 10;
          if (reasons.first_time) priority += 5;
          priority = Math.max(0, Math.min(priority, 100));
          const isJunkCat = ["promotional", "spam"].includes(cat);
          const needsReview = !isJunkCat && (["urgent", "requires_response"].includes(cat) || reasons.money || reasons.deadline || reasons.legal);

          reviewed++;
          if (needsReview) flagged++;
          if (!dryRun) {
            await supabase.from("email_review_items").upsert({
              user_id: uid, account_id: account.id, thread_id: m.thread_id,
              provider_thread_id: m.provider_thread_id, provider_message_id: m.provider_message_id,
              from_address: fromAddr, from_name: m.from_name, subject: m.subject, received_at: m.received_at,
              category: cat, action: String(parsed.action || "archive"),
              priority, summary: String(parsed.summary || "").slice(0, 240),
              reasons, needs_review: needsReview, status: "open", model: MODEL, prompt_version: PROMPT_VERSION,
            }, { onConflict: "account_id,provider_message_id" });
          }
        }
      }
      runRow.ai_reviewed = reviewed; runRow.flagged = flagged; runRow.ai_calls = aiCalls;
      runRow.through_ts = throughTs;

      // ── 4. Enrich top recommended senders with a real unsubscribe link ──
      if (!dryRun && unsubMaxFetch > 0) {
        try {
          const { data: recos } = await supabase.from("email_sender_stats")
            .select("id,sender_address").eq("account_id", account.id)
            .eq("unsubscribe_recommended", true).is("list_unsubscribe", null)
            .order("msg_count_30d", { ascending: false }).limit(unsubMaxFetch);
          if (recos && recos.length) {
            const tok = await accessToken(supabase, account);
            for (const r of recos) {
              try {
                const { data: latest } = await supabase.from("email_messages")
                  .select("provider_message_id").eq("account_id", account.id)
                  .eq("from_address", r.sender_address).order("internal_date", { ascending: false }).limit(1).maybeSingle();
                if (!latest?.provider_message_id) continue;
                const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${latest.provider_message_id}`);
                url.searchParams.set("format", "metadata");
                url.searchParams.append("metadataHeaders", "List-Unsubscribe");
                url.searchParams.append("metadataHeaders", "List-Unsubscribe-Post");
                const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${tok}` } });
                if (!resp.ok) continue;
                const msg = await resp.json();
                const headers = (msg.payload?.headers || []) as any[];
                const lu = headers.find((h) => h.name?.toLowerCase() === "list-unsubscribe")?.value || null;
                const lup = headers.find((h) => h.name?.toLowerCase() === "list-unsubscribe-post")?.value || null;
                const { url: unsubUrl } = parseListUnsub(lu);
                if (unsubUrl) {
                  await supabase.from("email_sender_stats").update({
                    list_unsubscribe: unsubUrl, list_unsubscribe_post: !!lup,
                  }).eq("id", r.id);
                }
              } catch (_e) { /* skip this sender */ }
            }
          }
        } catch (_e) { /* token/enrichment failure must not fail the run */ }
      }

      // scanned = rough count of new inbound since watermark
      const { count: scanned } = await supabase.from("email_messages")
        .select("id", { count: "exact", head: true })
        .eq("account_id", account.id).eq("direction", "inbound").gt("internal_date", since);
      runRow.scanned = scanned || 0;
      runRow.bulk_skipped = Math.max(0, (runRow.scanned || 0) - reviewed);
      runRow.status = "ok"; runRow.finished_at = new Date().toISOString();
    } catch (e) {
      runRow.status = "error"; runRow.error = String(e?.message || e).slice(0, 500);
      runRow.finished_at = new Date().toISOString();
    }
    if (!dryRun) await supabase.from("email_intel_runs").insert(runRow);
    summary.push({ account: account.email_address, ...runRow });
  }

  return j({ ok: true, ai_budget_left: pool, dry_run: dryRun, runs: summary });
});
