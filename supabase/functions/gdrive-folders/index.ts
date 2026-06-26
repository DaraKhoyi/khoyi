// gdrive-folders
// Lists Google Drive folders for a connected account so the user can browse &
// pick the folder Cube ACR backs recordings up to.
// Body: { account_id, parent?: string (folder id, default 'root') }
// Returns: { folders: [{id,name}], parentName? } | { needs_drive: true } | { error }
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function freshToken(supabase, account) {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) return account.access_token;
  if (!account.refresh_token) throw new Error("No refresh_token — reconnect this account.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status}`);
  const t = await r.json();
  const newExp = new Date(now + ((t.expires_in || 3600) - 60) * 1000).toISOString();
  await supabase.from("email_accounts").update({ access_token: t.access_token, token_expires_at: newExp }).eq("id", account.id);
  return t.access_token;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return J({ error: "Not authenticated" }, 401);

    const { account_id, parent } = await req.json().catch(() => ({}));
    if (!account_id) return J({ error: "account_id required" });
    const { data: account } = await supabase.from("email_accounts").select("*").eq("id", account_id).eq("user_id", user.id).maybeSingle();
    if (!account) return J({ error: "Account not found" });
    if (!(account.scopes || []).some((s) => String(s).includes("drive"))) return J({ needs_drive: true });

    const access = await freshToken(supabase, account);
    const parentId = parent || "root";
    const q = `mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parentId}' in parents`;
    const params = new URLSearchParams({ q, fields: "files(id,name)", pageSize: "100", orderBy: "name", spaces: "drive", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    const r = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, { headers: { Authorization: `Bearer ${access}` } });
    if (r.status === 403) { const txt = await r.text(); if (/insufficient|scope|ACCESS_TOKEN_SCOPE/i.test(txt)) return J({ needs_drive: true }); return J({ error: `Drive 403: ${txt.slice(0, 160)}` }); }
    if (!r.ok) return J({ error: `Drive ${r.status}` }, 502);
    const data = await r.json();
    let parentName = null;
    if (parentId !== "root") {
      try { const pr = await fetch(`https://www.googleapis.com/drive/v3/files/${parentId}?fields=name&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${access}` } }); if (pr.ok) parentName = (await pr.json()).name; } catch (_e) {}
    }
    return J({ folders: (data.files || []).map((f) => ({ id: f.id, name: f.name })), parentName });
  } catch (e) {
    return J({ error: String(e?.message || e) }, 500);
  }
});
