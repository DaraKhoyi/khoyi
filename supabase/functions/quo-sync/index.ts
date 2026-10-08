// quo-sync
// Two jobs, idempotent:
//  1) Ensure the four Quo webhooks (messages, calls, summaries, transcripts) exist,
//     pointing at the bare quo-webhook URL (no token: quo-webhook verifies Quo's
//     signature) — created once, skipped thereafter. Any existing hook at that
//     address, with or without an old ?token=, counts as existing.
//  2) Backfill recent messages + calls from the Quo API into quo_messages / quo_calls,
//     so the live feed isn't empty on day one.
//
// WHO MAY RUN IT, AND WHOSE ROWS THEY ARE (8 Oct 2026). The Quo API key reads
// the WHOLE workspace, so this is a workspace job, not a per-user one:
//   - only the Quo line owner (QUO_OWNER_USER_ID), an owner/broker_admin, or a
//     verified service caller runs it. Anyone else gets { ok: true, skipped }
//     and nothing is read or written (their texts and calls still arrive live
//     through quo-webhook);
//   - every row is filed under its LINE's owner (_shared/quoOwner.ts, the same
//     rule quo-webhook uses), never under the caller;
//   - a row that already exists is left alone (ON CONFLICT DO NOTHING), so a
//     backfill can never take a row away from its owner.
// Before this, rows were upserted with user_id = caller. The smoke-test harness
// signs up ~40 throwaway accounts per run; each opened the Quo screen, which
// re-filed Dara's texts and calls under the throwaway account, and deleting the
// account (FK ON DELETE CASCADE) deleted them: ~52k inserts / ~52k deletes.
//
// Deploy with verify_jwt = true.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/serviceCaller.ts";
import { QuoOwners } from "../_shared/quoOwner.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const QUO = "https://api.openphone.com";

async function quo(path: string, key: string, opts: RequestInit = {}) {
  const r = await fetch(`${QUO}${path}`, {
    ...opts,
    headers: { "Authorization": key, "Content-Type": "application/json", "User-Agent": "KhoyiApp/1.0", ...(opts.headers || {}) },
  });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { j = null; }
  return { ok: r.ok, status: r.status, json: j };
}

// May this signed-in user run the workspace backfill?
async function mayRun(supabase: any, userId: string, ownerId: string | null): Promise<boolean> {
  if (ownerId && userId === ownerId) return true;
  const { data } = await supabase.from("agents").select("role").eq("auth_user_id", userId).maybeSingle();
  return !!data && ["owner", "broker_admin"].includes(String(data.role || ""));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const body = await req.json().catch(() => ({}));
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    const tokenStr = authHeader.replace(/^Bearer\s+/i, "").trim();
    const ownerId = Deno.env.get("QUO_OWNER_USER_ID") || null;

    const service = !!tokenStr && await isServiceCaller(req);
    let callerId: string | null = null;
    if (!service) {
      const user = (await supabase.auth.getUser(tokenStr)).data.user;
      if (!user) return J({ ok: false, error: "Not authenticated" }, 401);
      callerId = user.id;
      if (!(await mayRun(supabase, user.id, ownerId))) {
        // Not an error for the app: an agent's own texts and calls arrive live.
        return J({ ok: true, skipped: "owner_only", webhooks: {}, backfilled: { messages: 0, calls: 0 } });
      }
    }

    const apiKey = Deno.env.get("QUO_API_KEY");
    if (!apiKey) return J({ ok: false, error: "QUO_API_KEY missing" }, 500);
    // 7 Oct 2026: quo-webhook verifies Quo's signature, so the URL carries no
    // secret (a URL lands in the logs). Register the bare URL.
    const hookUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/quo-webhook`;

    // ── 1) Ensure webhooks ───────────────────────────────────────────────
    const wantedHooks: Array<{ path: string; events: string[] }> = [
      { path: "/v1/webhooks/messages", events: ["message.received", "message.delivered"] },
      { path: "/v1/webhooks/calls", events: ["call.completed", "call.recording.completed"] },
      { path: "/v1/webhooks/call-summaries", events: ["call.summary.completed"] },
      { path: "/v1/webhooks/call-transcripts", events: ["call.transcript.completed"] },
    ];
    const hookResults: Record<string, string> = {};
    if (!body?.skipHooks) {
      const existing = await quo("/v1/webhooks", apiKey);
      // Never let a failed list look like "no hooks" (that would create duplicates).
      if (!existing.ok) return J({ ok: false, error: `Quo webhook list failed: ${existing.status}` }, 502);
      const existingUrls = new Set((existing.json?.data || []).map((w: any) => (w.url || "").split("?")[0]));
      for (const h of wantedHooks) {
        if (existingUrls.has(hookUrl.split("?")[0])) { hookResults[h.path] = "exists"; continue; }
        const r = await quo(h.path, apiKey, {
          method: "POST",
          body: JSON.stringify({ events: h.events, url: hookUrl, resourceIds: ["*"], label: "PrismOS", status: "enabled" }),
        });
        hookResults[h.path] = r.ok ? "created" : `err ${r.status}: ${r.json?.message || ""}`;
      }
      if (callerId) await supabase.from("quo_settings").upsert({ user_id: callerId, webhooks_registered: true, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    }

    // ── 2) Backfill (new rows only, filed under the line's owner) ─────────
    const owners = new QuoOwners(supabase, ownerId);
    let msgCount = 0, callCount = 0, unowned = 0;
    const nums = await quo("/v1/phone-numbers", apiKey);
    const numbers = nums.json?.data || [];
    const maxConvos = Math.min(Number(body?.maxConvos) || 40, 100);

    for (const n of numbers) {
      const e164 = n.number || n.phoneNumber;
      const pnId = n.id;
      if (!e164 || !pnId) continue;
      const { owner } = await owners.resolve(pnId, [e164]);
      if (!owner) { unowned++; continue; }
      const conv = await quo(`/v1/conversations?phoneNumbers=${encodeURIComponent(e164)}&maxResults=${maxConvos}`, apiKey);
      const convos = conv.json?.data || [];
      for (const c of convos) {
        const other = (c.participants || [])[0];
        if (!other) continue;
        // messages
        const m = await quo(`/v1/messages?phoneNumberId=${pnId}&participants=${encodeURIComponent(other)}&maxResults=100`, apiKey);
        const msgs = m.json?.data || [];
        if (msgs.length) {
          const rows = msgs.map((x: any) => ({
            user_id: owner, op_id: x.id, conversation_id: c.id, phone_number_id: pnId,
            direction: x.direction, from_number: x.from, to_number: (Array.isArray(x.to) ? x.to[0] : x.to) || null,
            body: x.text ?? "", status: x.status || null, op_created_at: x.createdAt || null, raw: x,
          }));
          const { data: added } = await supabase.from("quo_messages").upsert(rows, { onConflict: "op_id", ignoreDuplicates: true }).select("op_id");
          msgCount += (added || []).length;
        }
        // calls
        const ca = await quo(`/v1/calls?phoneNumberId=${pnId}&participants=${encodeURIComponent(other)}&maxResults=100`, apiKey);
        const calls = ca.json?.data || [];
        if (calls.length) {
          const rows = calls.map((x: any) => {
            const out = String(x.direction || "").toLowerCase().includes("out");
            return {
              user_id: owner, op_id: x.id, phone_number_id: pnId, direction: x.direction,
              participant: other, from_number: out ? e164 : other, to_number: out ? other : e164,
              status: x.status || null, duration: typeof x.duration === "number" ? x.duration : null,
              answered_at: x.answeredAt || null, completed_at: x.completedAt || null, op_created_at: x.createdAt || null, raw: x,
            };
          });
          const { data: added } = await supabase.from("quo_calls").upsert(rows, { onConflict: "op_id", ignoreDuplicates: true }).select("op_id");
          callCount += (added || []).length;
        }
      }
    }

    return J({ ok: true, webhooks: hookResults, backfilled: { messages: msgCount, calls: callCount }, numbers: numbers.length, unowned_lines: unowned });
  } catch (err) {
    return J({ ok: false, error: String(err) }, 500);
  }
});
