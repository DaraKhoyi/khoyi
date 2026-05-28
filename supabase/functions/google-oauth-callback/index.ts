// google-oauth-callback
// Google redirects here after the unified consent. Exchanges the code,
// stores tokens + scopes in email_accounts (provider='google'), then
// redirects back to the app with ?google_connected=<email>.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function htmlPage(title: string, body: string) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0d0f14;color:#e8eaf0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.box{max-width:480px;padding:32px;background:#161921;border:1px solid #252a38;border-radius:12px}
h1{font-size:18px;margin:0 0 12px;color:#C5A95E}
p{font-size:14px;color:#9499b0;line-height:1.6;margin:8px 0}
a{color:#C5A95E;text-decoration:none}</style>
</head><body><div class="box">${body}</div></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(
      htmlPage("Connection cancelled", `<h1>Connection cancelled</h1><p>Google reported: ${error}</p><p><a href="https://darasapp.com/">Return to DarasApp</a></p>`),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
  if (!code || !state) {
    return new Response(
      htmlPage("Missing parameters", `<h1>Missing parameters</h1><p>Expected code and state from Google.</p>`),
      { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  try {
    let stateObj;
    try { stateObj = JSON.parse(atob(state)); }
    catch { throw new Error("Invalid state parameter"); }
    const userId = stateObj.uid;
    const returnTo = stateObj.rt || "https://darasapp.com/";

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Google OAuth secrets not configured");
    }

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }).toString(),
    });
    if (!tokenResp.ok) {
      const t = await tokenResp.text();
      throw new Error(`Token exchange failed: ${tokenResp.status} ${t.slice(0, 300)}`);
    }
    const tokens = await tokenResp.json();

    const profResp = await fetch(
      "https://www.googleapis.com/oauth2/v2/userinfo",
      { headers: { Authorization: `Bearer ${tokens.access_token}` } },
    );
    if (!profResp.ok) {
      const t = await profResp.text();
      throw new Error(`Userinfo failed: ${profResp.status} ${t.slice(0, 300)}`);
    }
    const profile = await profResp.json();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    const expiresAt = new Date(Date.now() + ((tokens.expires_in || 3600) - 60) * 1000).toISOString();

    const { data: existing } = await supabase
      .from("email_accounts")
      .select("id, refresh_token")
      .eq("user_id", userId)
      .eq("email_address", profile.email)
      .maybeSingle();

    const payload: Record<string, unknown> = {
      user_id: userId,
      provider: "google",
      email_address: profile.email,
      display_name: profile.name || null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || (existing && existing.refresh_token) || null,
      token_expires_at: expiresAt,
      scopes: (tokens.scope || "").split(" "),
      is_active: true,
    };

    if (existing) {
      await supabase.from("email_accounts").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("email_accounts").insert(payload);
    }

    const dest = new URL(returnTo);
    dest.searchParams.set("google_connected", profile.email);
    return new Response(null, {
      status: 302,
      headers: { Location: dest.toString() },
    });
  } catch (err) {
    return new Response(
      htmlPage(
        "Connection failed",
        `<h1>Connection failed</h1><p>${String(err).slice(0, 400)}</p><p><a href="https://darasapp.com/">Return to DarasApp</a></p>`,
      ),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
});
