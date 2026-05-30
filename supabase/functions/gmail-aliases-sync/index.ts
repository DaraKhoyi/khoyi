// gmail-aliases-sync
// Pulls the Send-mail-as aliases from Gmail's settings API and mirrors them
// into the local email_aliases table. The currently-default alias preference
// on the user's side is preserved across syncs.
//
// POST { user_id: uuid, account_id?: uuid }
// If account_id omitted, uses the user's primary email-purpose google account.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function refreshAccessToken(refreshToken) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status}`);
  return await r.json();
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { account_id } = body || {};

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    // SECURITY: ignore user_id in body; derive caller identity from JWT
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const user_id = user.id;

    // Pick the email account
    let account;
    if (account_id) {
      const { data } = await supabase.from("email_accounts").select("*")
        .eq("id", account_id).eq("user_id", user_id).maybeSingle();
      account = data;
    } else {
      const { data } = await supabase.from("email_accounts").select("*")
        .eq("user_id", user_id).eq("provider", "google").eq("is_active", true)
        .contains("purposes", ["email"])
        .order("updated_at", { ascending: false }).limit(1).maybeSingle();
      account = data;
      if (!account) {
        const { data: fallback } = await supabase.from("email_accounts").select("*")
          .eq("user_id", user_id).eq("provider", "google").eq("is_active", true)
          .order("updated_at", { ascending: false });
        account = (fallback || []).find(a => (a.scopes || []).some(s => s.includes("gmail"))) || null;
      }
    }
    if (!account?.refresh_token) throw new Error("No email-capable Google account connected");

    // Refresh token if expired
    let accessToken = account.access_token;
    const expired = !account.token_expires_at || new Date(account.token_expires_at) <= new Date();
    if (expired) {
      const refreshed = await refreshAccessToken(account.refresh_token);
      accessToken = refreshed.access_token;
      const newExpiry = new Date(Date.now() + ((refreshed.expires_in||3600)-60)*1000).toISOString();
      await supabase.from("email_accounts").update({
        access_token: accessToken, token_expires_at: newExpiry,
      }).eq("id", account.id);
    }

    // Pull sendAs list
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!r.ok) throw new Error(`Gmail sendAs fetch failed: ${r.status} ${(await r.text()).slice(0,200)}`);
    const data = await r.json();
    const sendAs = data.sendAs || [];

    // Get any existing default to preserve preference
    const { data: existingDefault } = await supabase
      .from("email_aliases").select("email_address")
      .eq("user_id", user_id).eq("is_default", true).maybeSingle();
    const preservedDefault = existingDefault?.email_address || null;

    // Upsert each sendAs row
    const upserted = [];
    for (const sa of sendAs) {
      const addr = (sa.sendAsEmail || "").toLowerCase();
      if (!addr) continue;
      const verified = (sa.verificationStatus || "").toLowerCase() === "accepted" || !!sa.isPrimary;
      const row = {
        user_id,
        account_id: account.id,
        email_address: addr,
        display_name: sa.displayName || null,
        is_primary: !!sa.isPrimary,
        verified,
        treat_as_alias: sa.treatAsAlias !== false,
        last_synced_at: new Date().toISOString(),
      };
      // Try update first; if no row, insert
      const { data: existing } = await supabase.from("email_aliases").select("id")
        .eq("user_id", user_id).eq("email_address", addr).maybeSingle();
      if (existing) {
        await supabase.from("email_aliases").update(row).eq("id", existing.id);
      } else {
        await supabase.from("email_aliases").insert({ ...row, is_default: false });
      }
      upserted.push(addr);
    }

    // Remove local aliases that are no longer in Gmail (preserve the user's defaults though)
    const { data: stale } = await supabase.from("email_aliases").select("id, email_address, is_default")
      .eq("user_id", user_id).eq("account_id", account.id);
    for (const s of stale || []) {
      if (!upserted.includes(s.email_address)) {
        await supabase.from("email_aliases").delete().eq("id", s.id);
      }
    }

    // Re-apply preserved default if it still exists
    if (preservedDefault && upserted.includes(preservedDefault.toLowerCase())) {
      await supabase.from("email_aliases").update({ is_default: true })
        .eq("user_id", user_id).eq("email_address", preservedDefault.toLowerCase());
    } else {
      // No default set — pick the primary
      const primary = sendAs.find(s => s.isPrimary);
      if (primary?.sendAsEmail) {
        await supabase.from("email_aliases").update({ is_default: true })
          .eq("user_id", user_id).eq("email_address", primary.sendAsEmail.toLowerCase());
      }
    }

    return new Response(JSON.stringify({ ok: true, synced: upserted.length, addresses: upserted }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
