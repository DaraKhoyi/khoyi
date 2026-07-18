import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── call-audio ───────────────────────────────────────────────────────────────
// The recording never left Google Drive; only its file id was stored. This
// streams it back through the app so a call can be PLAYED from the timeline.
//
// Why proxy instead of handing the browser a Drive link: a Drive URL either
// needs the user's Google session (which the PWA does not have) or a sharing
// link (which would make a client's recorded phone call readable by anyone who
// got the URL). The token stays server-side and the audio is only ever released
// to someone whose JWT owns that call.
//
// Range requests are honoured so seeking works — without them a 30-minute call
// must download in full before it will play, and nobody will ever press play twice.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, range",
  "Access-Control-Expose-Headers": "content-length, content-range, accept-ranges",
};

async function driveToken(db: any, userId: string) {
  const { data: s } = await db.from("cube_acr_settings").select("*").eq("user_id", userId).maybeSingle();
  if (!s?.refresh_token) throw new Error("Google Drive isn't connected for this account.");
  const exp = Date.parse(s.token_expires_at || "") || 0;
  if (s.access_token && exp - Date.now() > 120000) return s.access_token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: s.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`Drive token refresh failed: ${r.status}`);
  const j = await r.json();
  await db.from("cube_acr_settings").update({
    access_token: j.access_token,
    token_expires_at: new Date(Date.now() + (j.expires_in || 3600) * 1000).toISOString(),
  }).eq("user_id", userId);
  return j.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    const callId = url.searchParams.get("call_id");
    if (!callId) return new Response("call_id required", { status: 400, headers: cors });

    const authHeader = req.headers.get("Authorization") || "";
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return new Response("not signed in", { status: 401, headers: cors });

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: call } = await db.from("quo_calls").select("id,user_id,raw").eq("id", callId).maybeSingle();
    if (!call) return new Response("no such call", { status: 404, headers: cors });
    // Own the call or you don't hear it. A recorded phone call is the most
    // private thing in this database.
    if (call.user_id !== user.id) return new Response("not yours", { status: 403, headers: cors });

    const fileId = call?.raw?.cube?.drive_file_id;
    if (!fileId) return new Response("no recording stored for this call", { status: 404, headers: cors });

    const token = await driveToken(db, call.user_id);
    const range = req.headers.get("range");
    const g = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: range ? { Authorization: `Bearer ${token}`, Range: range } : { Authorization: `Bearer ${token}` },
    });
    if (!g.ok && g.status !== 206) return new Response(`drive ${g.status}`, { status: g.status, headers: cors });

    const h = new Headers(cors);
    h.set("Content-Type", g.headers.get("content-type") || "audio/amr");
    h.set("Accept-Ranges", "bytes");
    for (const k of ["content-length", "content-range"]) {
      const v = g.headers.get(k);
      if (v) h.set(k, v);
    }
    h.set("Cache-Control", "private, max-age=600");
    return new Response(g.body, { status: g.status, headers: h });
  } catch (e) {
    return new Response(String((e as Error)?.message || e), { status: 500, headers: cors });
  }
});
