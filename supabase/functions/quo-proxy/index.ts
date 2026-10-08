// quo-proxy
// Authenticated, allow-listed server-side proxy to the Quo (OpenPhone) API.
//
// The Quo API key NEVER touches the public client bundle — it lives only as the
// QUO_API_KEY edge-function secret and is injected here, server-side. The frontend
// calls this function with the user's Supabase JWT; we verify the caller, then
// forward an allow-listed request to https://api.openphone.com.
//
// Body: {
//   path:   string,                 // must start with "/v1/"
//   method?: "GET" | "POST",        // default "GET"
//   query?: Record<string, any>,    // becomes the querystring (arrays repeat the key)
//   body?:  any                     // JSON body for POST
// }
//
// Allow-list:
//   • GET  on any /v1/* path          (read-only: numbers, conversations, messages,
//                                       calls, recordings, transcripts, summaries,
//                                       voicemails, contacts, users)
//   • POST on /v1/messages            (send a text)
//   • POST on /v1/conversations/{id}/mark-as-read
// Everything else (PATCH/PUT/DELETE, contact/webhook/task writes) is rejected so
// this proxy can't be turned into a destructive open relay.
//
// Who may read what (8 Oct 2026). One API key covers the whole Quo workspace, so
// the proxy itself has to decide whose data a caller may see:
//   • Workspace admins (QUO_OWNER_USER_ID, or agents.role owner / broker_admin)
//     may make any allowed GET, as before.
//   • Everyone else may read:
//       - GET /v1/phone-numbers (the line picker), with each line's member list
//         removed;
//       - one call's summary / transcript / recording / voicemail / the call
//         itself, or one message, only if that call or message is filed under
//         them in PrismOS (quo_calls / quo_messages);
//       - the /v1/messages, /v1/calls and /v1/conversations lists only for their
//         own line (quo_settings.active_phone_number_id) and only while Quo lists
//         them as a user of that line. No line, nothing.
//     Anything else (contacts, users, other lines' lists) is refused.
//   • mark-as-read is admins only (the app never calls it).
//   • Sending: `from` must be the caller's own line, checked against Quo's live
//     line list, and the caller must be one of that line's users in Quo
//     (QUO_OWNER_USER_ID is exempt from the membership check).
// Every GET /v1/phone-numbers refreshes public.quo_line_directory, which the
// quo_settings trigger uses to refuse a line the user isn't on in Quo.
//
// Returns: { ok, status, data }  (data = parsed Quo JSON, or { raw } on non-JSON)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const QUO_BASE = "https://api.openphone.com";

function isAllowed(method: string, path: string): boolean {
  if (!path.startsWith("/v1/")) return false;
  // 8 Oct 2026: never the webhook list. Quo returns each webhook's signing KEY
  // in it, and quo-webhook trusts that key — so any signed-in account could
  // have forged a signed "new text" delivery. The app never reads webhooks.
  // Plain paths only (no "..", "//", "%", "?"), so nothing can dress the
  // webhook list up as something else.
  if (!/^\/v1(\/[A-Za-z0-9_-]+)+$/.test(path)) return false;
  if (/^\/v1\/webhooks(\/|$)/i.test(path)) return false;
  if (method === "GET") return true;
  if (method === "POST") {
    if (path === "/v1/messages") return true;
    if (/^\/v1\/conversations\/[^/]+\/mark-as-read$/.test(path)) return true;
    return false;
  }
  return false;
}

function buildQuery(query: Record<string, unknown> | undefined): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item !== undefined && item !== null && item !== "") sp.append(k, String(item));
      }
    } else {
      sp.append(k, String(v));
    }
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

const OWNER_ID = () => Deno.env.get("QUO_OWNER_USER_ID") || "";
const last10 = (v: unknown) => String(v ?? "").replace(/[^0-9]/g, "").slice(-10);
const SINGLE_CALL = /^\/v1\/(call-summaries|call-transcripts|call-recordings|call-voicemails|calls)\/([A-Za-z0-9_-]+)$/;
const SINGLE_MSG = /^\/v1\/messages\/([A-Za-z0-9_-]+)$/;

async function isWorkspaceAdmin(supabase: any, userId: string): Promise<boolean> {
  if (OWNER_ID() && userId === OWNER_ID()) return true;
  const { data } = await supabase.from("agents").select("role").eq("auth_user_id", userId).maybeSingle();
  return !!data && ["owner", "broker_admin"].includes(String(data.role || ""));
}

async function callerEmails(supabase: any, user: any): Promise<string[]> {
  const out = new Set<string>();
  if (user?.email) out.add(String(user.email).toLowerCase());
  const { data } = await supabase.from("agents").select("email").eq("auth_user_id", user.id).maybeSingle();
  if (data?.email) out.add(String(data.email).toLowerCase());
  return [...out];
}

async function quoFetch(apiKey: string, path: string, method = "GET", query?: Record<string, unknown>, payload?: unknown) {
  const init: RequestInit = {
    method,
    // Quo/OpenPhone expects the raw API key in Authorization (no "Bearer ").
    headers: { "Authorization": apiKey, "Content-Type": "application/json", "User-Agent": "KhoyiApp/1.0" },
  };
  if (method === "POST" && payload !== undefined) init.body = JSON.stringify(payload);
  const r = await fetch(`${QUO_BASE}${path}${buildQuery(query as any)}`, init);
  const text = await r.text();
  let data: any;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

// Cache Quo's line list (with each line's users' emails) for the quo_settings
// trigger. Best effort: a failed write never fails the caller's request.
async function refreshDirectory(supabase: any, lines: any[]) {
  try {
    const rows = lines.filter((n) => n && n.id).map((n) => ({
      phone_number_id: String(n.id),
      number: n.number || n.phoneNumber || null,
      name: n.name || null,
      member_emails: (Array.isArray(n.users) ? n.users : []).map((u: any) => String(u?.email || "").toLowerCase()).filter(Boolean),
      refreshed_at: new Date().toISOString(),
    }));
    if (rows.length) await supabase.from("quo_line_directory").upsert(rows, { onConflict: "phone_number_id" });
  } catch (_) { /* cache only */ }
}

// The caller's own line, as Quo sees it right now, and whether Quo lists them on it.
async function myLine(supabase: any, apiKey: string, user: any) {
  const { data: st } = await supabase.from("quo_settings")
    .select("active_phone_number_id, active_number").eq("user_id", user.id).maybeSingle();
  const id = String(st?.active_phone_number_id || "");
  if (!id) return null;
  const nums = await quoFetch(apiKey, "/v1/phone-numbers");
  if (!nums.ok) throw new Error(`Couldn't check your Quo line right now (Quo ${nums.status}). Try again in a minute.`);
  const lines = Array.isArray(nums.data?.data) ? nums.data.data : [];
  await refreshDirectory(supabase, lines);
  const line = lines.find((n: any) => String(n?.id) === id);
  if (!line) return null;
  const emails = await callerEmails(supabase, user);
  const members = (Array.isArray(line.users) ? line.users : []).map((u: any) => String(u?.email || "").toLowerCase());
  return {
    id, number: String(line.number || line.phoneNumber || ""),
    member: emails.some((e) => members.includes(e)),
    savedNumber: String(st?.active_number || ""),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const reqBody = await req.json().catch(() => ({}));
    const path: string = reqBody?.path || "";
    const method: string = (reqBody?.method || "GET").toUpperCase();
    const query = reqBody?.query;
    const payload = reqBody?.body;

    // Authenticate the caller against Supabase.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authHeader = req.headers.get("Authorization") || "";
    const tokenStr = authHeader.replace("Bearer ", "");
    const user = (await supabase.auth.getUser(tokenStr)).data.user;
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("QUO_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: "QUO_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!path || !isAllowed(method, path)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Not permitted: ${method} ${path || "(no path)"}` }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const deny = (error: string) => new Response(JSON.stringify({ ok: false, error }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const admin = await isWorkspaceAdmin(supabase, user.id);

    // A caller may only send FROM their own Quo line.
    //
    // Found while reproducing Dara's send failure: a throwaway account with no
    // Quo settings at all successfully sent a text FROM Dara's brokerage number,
    // because the proxy forwarded `from` verbatim. Any signed-in agent could
    // have texted a client as the broker. Same rule as everywhere else — you act
    // as yourself, and impersonation is the audited path.
    // 8 Oct 2026: "their own" used to mean whatever number they had typed into
    // their own quo_settings row — which could be Dara's. Now the line comes
    // from Quo's live line list and the caller must be one of its users in Quo.
    if (method === "POST" && path === "/v1/messages") {
      const wantFrom = String((payload && payload.from) || "");
      const line = await myLine(supabase, apiKey, user);
      if (!line) return deny("No Quo number is set up for your account yet.");
      const fromOk = wantFrom === line.id || (!!last10(wantFrom) && last10(wantFrom) === last10(line.number));
      if (!fromOk) return deny("You can only send from your own Quo number.");
      if (!line.member && user.id !== OWNER_ID()) {
        return deny("You can only send from a Quo line you are on in Quo. Ask an admin to add you to it in Quo.");
      }
    } else if (method === "POST") {
      if (!admin) return deny("Only a workspace admin can do that.");
    } else if (!admin) {
      // Ordinary agents: their own line and their own calls/messages only.
      const sc = path.match(SINGLE_CALL);
      const sm = path.match(SINGLE_MSG);
      if (path === "/v1/phone-numbers") {
        // allowed; member lists are stripped from the reply below
      } else if (sc) {
        const { data: row } = await supabase.from("quo_calls").select("id")
          .eq("op_id", sc[2]).eq("user_id", user.id).maybeSingle();
        if (!row) return deny("That call isn't one of yours.");
      } else if (sm) {
        const { data: row } = await supabase.from("quo_messages").select("id")
          .eq("op_id", sm[1]).eq("user_id", user.id).maybeSingle();
        if (!row) return deny("That message isn't one of yours.");
      } else if (path === "/v1/messages" || path === "/v1/calls" || path === "/v1/conversations") {
        const line = await myLine(supabase, apiKey, user);
        if (!line || !line.member) return deny("You can only read your own Quo line.");
        const q = (query || {}) as Record<string, unknown>;
        if (path === "/v1/conversations") {
          const raw = q.phoneNumbers;
          const list = (Array.isArray(raw) ? raw : (raw === undefined || raw === null || raw === "" ? [] : [raw])).map(String);
          if (!list.length || !list.every((v) => v === line.id || (!!last10(v) && last10(v) === last10(line.number)))) {
            return deny("You can only read your own Quo line.");
          }
        } else if (String(q.phoneNumberId || "") !== line.id) {
          return deny("You can only read your own Quo line.");
        }
      } else {
        return deny("Only a workspace admin can read that.");
      }
    }

    const res = await quoFetch(apiKey, path, method, query, payload);
    let data = res.data;
    if (method === "GET" && path === "/v1/phone-numbers" && res.ok && Array.isArray(data?.data)) {
      await refreshDirectory(supabase, data.data);
      if (!admin) data = { ...data, data: data.data.map((n: any) => { const { users: _u, ...rest } = n || {}; return rest; }) };
    }

    return new Response(JSON.stringify({ ok: res.ok, status: res.status, data }), {
      status: 200, // surface Quo's status inside the payload; transport succeeded
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
