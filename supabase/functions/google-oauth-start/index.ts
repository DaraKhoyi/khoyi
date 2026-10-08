// google-oauth-start
// Purpose-aware Google OAuth. One Google Cloud app, but the scopes requested
// depend on what the user is connecting the account FOR:
//   purpose='email'    -> Gmail scopes
//   purpose='calendar' -> Calendar scopes
//   purpose='both'     -> everything (single account doing both)
//   purpose='contacts' -> Google Contacts (People API)
//
//   purpose='full'     -> email + calendar + contacts (first-run setup)
//
// Body: { return_to?: string, purpose?: string, purposes?: string[], login_hint?: string }
//   `purposes` (8 Oct 2026) asks for several at once. A RECONNECT must ask for
//   everything the mailbox had: Google drops every scope when a grant expires,
//   so asking for one purpose brought back only that one and the others stayed
//   silently broken while their badges still showed.
// Returns: { url: string, purposes: string[] }
//
// The state is SIGNED (see _shared/oauthState.ts) and carries the user id from
// the caller's JWT only. The callback refuses any state it did not issue.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { signState, safeReturnTo } from "../_shared/oauthState.ts";

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

const KNOWN_PURPOSES = ["email", "calendar", "drive", "contacts"];

// 'both' and 'full' are shorthands. 'full' is what first-run setup sends; until
// 8 Oct it matched nothing here and quietly fell through to Gmail only.
function expandPurposes(purpose: unknown, purposes: unknown): string[] {
  const out = new Set<string>();
  const raw = Array.isArray(purposes) && purposes.length ? purposes : [purpose || "email"];
  for (const p of raw) {
    if (p === "both") { out.add("email"); out.add("calendar"); }
    else if (p === "full") { out.add("email"); out.add("calendar"); out.add("contacts"); }
    else if (KNOWN_PURPOSES.includes(p)) out.add(p);
  }
  if (!out.size) out.add("email");
  return [...out];
}

function scopesForPurposes(list: string[]) {
  const set = new Set(IDENTITY_SCOPES);
  if (list.includes("email")) GMAIL_SCOPES.forEach(s => set.add(s));
  if (list.includes("calendar")) CALENDAR_SCOPES.forEach(s => set.add(s));
  if (list.includes("drive")) DRIVE_SCOPES.forEach(s => set.add(s));
  if (list.includes("contacts")) CONTACTS_SCOPES.forEach(s => set.add(s));
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
    const returnTo = safeReturnTo(body && body.return_to);
    const purposes = expandPurposes(body && body.purpose, body && body.purposes);
    const scopes = scopesForPurposes(purposes);

    // The user id comes from the verified JWT above — never from the body.
    const state = await signState({ uid: user.id, rt: returnTo, purposes });

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
    // Pre-select the right Google account on a reconnect. Someone with two
    // Google accounts (Alex has a work and a personal one) otherwise has to pick,
    // and picking the wrong one creates a second connection instead of fixing
    // the broken one.
    const hint = body && typeof body.login_hint === "string" ? body.login_hint.trim() : "";
    if (hint && hint.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(hint)) params.set("login_hint", hint);

    const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

    return new Response(JSON.stringify({ url, purposes, purpose: purposes.join(",") }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
