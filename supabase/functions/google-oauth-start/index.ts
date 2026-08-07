// google-oauth-start
// Purpose-aware Google OAuth. One Google Cloud app, but the scopes requested
// depend on what the user is connecting the account FOR:
//   purpose='email'    -> Gmail scopes
//   purpose='calendar' -> Calendar scopes
//   purpose='both'     -> everything (single account doing both)
//   purpose='contacts' -> Google Contacts (People API)
//
// Body: { return_to?: string, purpose?: 'email'|'calendar'|'both' }
// Returns: { url: string, state: string }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IDENTITY_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.modify",
];
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];
const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
];
// Read AND write on purpose. Reading is all the importer needs today, but the
// marker that tells you "this person has rich data in PrismOS" is a write back
// to Google. Asking for read now and write later means dragging every agent
// through a second consent screen, and a re-consent prompt is where adoption
// dies. NOTE: this is a SENSITIVE scope — it must also be added to the OAuth
// consent screen in Google Cloud, and may trigger re-verification. See below.
const CONTACTS_SCOPES = [
  "https://www.googleapis.com/auth/contacts",
];

function scopesForPurpose(purpose) {
  const set = new Set(IDENTITY_SCOPES);
  if (purpose === "email" || purpose === "both") GMAIL_SCOPES.forEach(s => set.add(s));
  if (purpose === "calendar" || purpose === "both") CALENDAR_SCOPES.forEach(s => set.add(s));
  if (purpose === "drive") DRIVE_SCOPES.forEach(s => set.add(s));
  if (purpose === "contacts") CONTACTS_SCOPES.forEach(s => set.add(s));
  if (set.size === IDENTITY_SCOPES.length) GMAIL_SCOPES.forEach(s => set.add(s));
  return [...set];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
    const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
    if (!clientId || !redirectUri) {
      return new Response(
        JSON.stringify({
          error: "Google OAuth not configured",
          details: "GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI not set in Supabase secrets.",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );
    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json().catch(() => ({}));
    const returnTo = (body && body.return_to) || "https://darasapp.com/";
    const purpose = (body && body.purpose) || "email";

    const scopes = scopesForPurpose(purpose);

    const stateObj = { uid: user.id, rt: returnTo, purpose, ts: Date.now() };
    const state = btoa(JSON.stringify(stateObj));

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state,
    });

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return new Response(JSON.stringify({ url, state, purpose }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
