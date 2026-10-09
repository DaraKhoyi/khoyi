// google-oauth-callback
// Google redirects here after consent. Exchanges the code, derives which
// purposes (email/calendar) were actually granted from the returned scopes,
// merges with any existing connection for the same address, and stores it.
// Redirects back with ?google_connected=<email>&purpose=<purpose>.
//
// Google may reach this function directly (legacy redirect URI on supabase.co)
// or through the relay page https://darasapp.com/oauth/google/callback, which
// forwards the same ?code&state query string here (8 Oct 2026, verification:
// the authorized redirect URI must be on a domain we can verify).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyState, escapeHtml, DEFAULT_RETURN } from "../_shared/oauthState.ts";

function htmlPage(title, body) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0d0f14;color:#e8eaf0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center}
.box{max-width:480px;padding:32px;background:#161921;border:1px solid #252a38;border-radius:12px}
h1{font-size:18px;margin:0 0 12px;color:#C5A95E}
p{font-size:14px;color:#9499b0;line-height:1.6;margin:8px 0}
a{color:#C5A95E;text-decoration:none}</style>
</head><body><div class="box">${body}</div></body></html>`;
}

function purposesFromScopes(scopeStr) {
  const scopes = (scopeStr || "").split(" ");
  const purposes = [];
  if (scopes.some(s => s.includes("gmail"))) purposes.push("email");
  if (scopes.some(s => s.includes("calendar"))) purposes.push("calendar");
  if (scopes.some(s => s.includes("drive"))) purposes.push("drive");
  // Only claim the purpose if Google actually GRANTED it. A user can untick a
  // scope on the consent screen, and a badge that lies about what is connected
  // is worse than no badge.
  if (scopes.some(s => s.includes("auth/contacts"))) purposes.push("contacts");
  return purposes.length ? purposes : ["email"];
}

serve(async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(
      htmlPage("Connection cancelled", `<h1>Connection cancelled</h1><p>Google reported: ${escapeHtml(error)}</p><p><a href="https://darasapp.com/">Return to Prism</a></p>`),
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
    // SIGNED STATE (8 Oct 2026). The user id and return address used to be
    // read straight out of base64 JSON that anyone could write. verifyState
    // rejects anything we did not issue, anything altered, and anything older
    // than 15 minutes, and only ever returns one of our own origins. It runs
    // BEFORE the code is exchanged, so a forged state never touches Google.
    const verified = await verifyState(state);
    const userId = verified.uid;
    const returnTo = verified.rt || DEFAULT_RETURN;

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
    // The token exchange must repeat the redirect_uri the consent URL used. It
    // travels in the signed state (the darasapp.com relay or the legacy Supabase
    // address); states issued before 8 Oct 2026 carry none and use the secret.
    const redirectUri = verified.ru || Deno.env.get("GOOGLE_REDIRECT_URI");
    if (!clientId || !clientSecret || !redirectUri) {
      throw new Error("Google OAuth secrets not configured");
    }

    const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: clientId, client_secret: clientSecret,
        redirect_uri: redirectUri, grant_type: "authorization_code",
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
    const grantedPurposes = purposesFromScopes(tokens.scope);

    // Find existing connection for this address
    const { data: existing } = await supabase
      .from("email_accounts")
      .select("id, refresh_token, purposes")
      .eq("user_id", userId)
      .eq("email_address", profile.email)
      .maybeSingle();

    // Purposes = what Google actually granted (9 Oct 2026). The start asks with
    // include_granted_scopes=true, so tokens.scope is the account's whole grant.
    // The old union kept "email, calendar" after a contacts-only reconnect, so
    // sync kept trying a token that couldn't reach them. If Google returned no
    // scope string at all, keep the old purposes rather than guess.
    const mergedPurposes = (tokens.scope && String(tokens.scope).trim())
      ? grantedPurposes
      : Array.from(new Set([...((existing && existing.purposes) || []), ...grantedPurposes]));

    const payload = {
      user_id: userId,
      provider: "google",
      email_address: profile.email,
      display_name: profile.name || null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || (existing && existing.refresh_token) || null,
      token_expires_at: expiresAt,
      scopes: (tokens.scope || "").split(" "),
      purposes: mergedPurposes,
      is_active: true,
      // A RECONNECT CLEARS "NEEDS RECONNECTING" AT ONCE (30 Sep). Only the
      // 10-minute watcher cleared it, so after a successful reconnect Settings
      // still said the mailbox needed reconnecting — Dara: "I'm having trouble
      // reconnecting." Cleared only when Google handed back a NEW refresh token:
      // without one the old (possibly revoked) token is kept and the watcher,
      // which tests it, stays the judge.
      ...(tokens.refresh_token ? { reauth_required_at: null, reauth_notified_at: null, last_sync_error: null } : {}),
    };

    if (existing) {
      const { error: upErr } = await supabase.from("email_accounts").update(payload).eq("id", existing.id);
      if (upErr) throw new Error(`Failed to save account (update): ${upErr.message || upErr.code || JSON.stringify(upErr)}`);
    } else {
      const { error: insErr } = await supabase.from("email_accounts").insert(payload);
      if (insErr) throw new Error(`Failed to save account (insert): ${insErr.message || insErr.code || JSON.stringify(insErr)}`);
    }

    // CLOSE THE ALERT AT THE MOMENT OF RECONNECTION.
    //
    // Reconnecting fixed the account but left the outage alert open, because
    // only the watcher resolved alerts and it runs every ten minutes. So the
    // banner still said "email is disconnected" on the page that had just
    // confirmed the connection — Dara reconnected, saw the same warning, and
    // reconnected again. A loop, and one that teaches you to distrust the alert
    // that was right the first time.
    //
    // Best-effort: a failure here must never break a successful connection, so
    // it is caught and ignored. The watcher remains the backstop.
    try {
      await supabase.from("connection_alerts")
        .update({ resolved_at: new Date().toISOString() })
        .eq("user_id", userId)
        .is("resolved_at", null)
        .in("kind", ["google_email", "google_calendar", "google_disconnected", "email_disconnected"]);
    } catch (_) { /* the connection succeeded; that is what matters */ }

    const dest = new URL(returnTo);
    dest.searchParams.set("google_connected", profile.email);
    dest.searchParams.set("purpose", grantedPurposes.join(","));
    return new Response(null, { status: 302, headers: { Location: dest.toString() } });
  } catch (err) {
    return new Response(
      htmlPage(
        "Connection failed",
        `<h1>Connection failed</h1><p>${escapeHtml(String(err).slice(0, 400))}</p><p><a href="https://darasapp.com/">Return to Prism</a></p>`,
      ),
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }
});
