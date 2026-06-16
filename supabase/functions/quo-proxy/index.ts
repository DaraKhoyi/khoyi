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

    const url = `${QUO_BASE}${path}${buildQuery(query)}`;
    const init: RequestInit = {
      method,
      headers: {
        // Quo/OpenPhone expects the raw API key in Authorization (no "Bearer ").
        "Authorization": apiKey,
        "Content-Type": "application/json",
        "User-Agent": "KhoyiApp/1.0",
      },
    };
    if (method === "POST" && payload !== undefined) {
      init.body = JSON.stringify(payload);
    }

    const r = await fetch(url, init);
    const text = await r.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    return new Response(JSON.stringify({ ok: r.ok, status: r.status, data }), {
      status: 200, // surface Quo's status inside the payload; transport succeeded
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
