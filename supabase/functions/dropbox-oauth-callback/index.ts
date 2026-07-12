// Dropbox OAuth callback. Public endpoint (verify_jwt=false) — Dropbox redirects
// here with ?code&state. We look up the state nonce (created by the authenticated
// client), exchange the code for tokens using the app SECRET (server-side only),
// store the connection + tokens, and bounce the user back to the app.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const APP_KEY = Deno.env.get("DROPBOX_APP_KEY")!;
const APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/dropbox-oauth-callback`;
const APP_HOME = "https://darasapp.com";

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthErr = url.searchParams.get("error");
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const back = (q: string) =>
    new Response(null, { status: 302, headers: { Location: `${APP_HOME}/?${q}` } });

  if (oauthErr) return back(`dropbox=error&reason=${encodeURIComponent(oauthErr)}`);
  if (!code || !state) return back("dropbox=error&reason=missing_code");

  const { data: st } = await admin.from("oauth_states").select("user_id").eq("nonce", state).maybeSingle();
  if (!st) return back("dropbox=error&reason=bad_state");

  // Exchange authorization code for tokens (offline => includes a refresh_token)
  const form = new URLSearchParams({
    code, grant_type: "authorization_code", redirect_uri: REDIRECT_URI,
    client_id: APP_KEY, client_secret: APP_SECRET,
  });
  const tr = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: form,
  });
  if (!tr.ok) return back(`dropbox=error&reason=token_${tr.status}`);
  const tok = await tr.json();

  // Friendly account label
  let label = "Dropbox";
  try {
    const ar = await fetch("https://api.dropboxapi.com/2/users/get_current_account", {
      method: "POST", headers: { Authorization: `Bearer ${tok.access_token}` },
    });
    if (ar.ok) { const acc = await ar.json(); label = acc?.email || acc?.name?.display_name || "Dropbox"; }
  } catch (_) { /* label stays 'Dropbox' */ }

  const { data: conn, error: ce } = await admin.from("cloud_connections")
    .insert({ user_id: st.user_id, provider: "dropbox", account_label: label, status: "connected" })
    .select("id").single();
  if (ce || !conn) return back("dropbox=error&reason=save");

  const exp = tok.expires_in ? new Date(Date.now() + (tok.expires_in - 60) * 1000).toISOString() : null;
  await admin.from("cloud_tokens").insert({
    connection_id: conn.id, access_token: tok.access_token,
    refresh_token: tok.refresh_token || null, token_expires_at: exp,
  });
  await admin.from("oauth_states").delete().eq("nonce", state);

  return back("dropbox=connected");
});
