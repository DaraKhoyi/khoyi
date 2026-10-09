// google-oauth-start
// Purpose-aware Google OAuth. One Google Cloud app, but the scopes requested
// depend on what the user is connecting the account FOR:
//   purpose='email'    -> Gmail scopes
//   purpose='calendar' -> Calendar scopes
//   purpose='both'     -> everything (single account doing both)
//   purpose='contacts' -> Google Contacts (People API), read-only
//   purpose='drive'    -> Drive read-only, owner / GOOGLE_DRIVE_SCOPE_USERS only
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
import { signState, safeReturnTo, currentRedirectUri } from "../_shared/oauthState.ts";
import { isImpersonatedRequest, supportSessionResponse } from "../_shared/impersonation.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const IDENTITY_SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];
// THE SIX SCOPES WE SUBMIT FOR GOOGLE VERIFICATION (Dara, 8 Oct 2026, 12:11 PM ET:
// "go with all 6"). openid + userinfo.email + userinfo.profile + these three.
//
// gmail.modify alone covers every Gmail call PrismOS makes: messages.list/get
// (including raw), attachments, history, watch, labels, settings.sendAs.list,
// messages.send, and threads.modify / trash / untrash (which accept ONLY
// gmail.modify or mail.google.com). gmail.readonly and gmail.send added review
// surface and nothing else, so they are no longer requested.
const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
];
// calendar.events covers events.list (sync tokens), insert, patch and delete on
// the user's calendars, which is all PrismOS calls. The broad `calendar` scope
// (calendar list, settings, sharing) was never used.
const CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
];
// Read-only. PrismOS only calls people/me/connections (list). The earlier plan
// to write a marker back to Google Contacts never shipped; asking for write
// access we do not use is exactly what verification rejects.
const CONTACTS_SCOPES = [
  "https://www.googleapis.com/auth/contacts.readonly",
];
// drive.readonly is a RESTRICTED scope that is NOT in the verification
// submission (only Dara's Cube ACR import and the commission/roster sheet
// sync use it). It is still requestable, but only by the people named in
// GOOGLE_DRIVE_SCOPE_USERS (comma-separated user ids or emails) or, when that
// secret is unset, by the brokerage owner. Everyone else is told Drive import is
// unavailable, so the consent screen agents and Google's reviewer see shows the
// six submitted scopes only.
const DRIVE_SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
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

// Who may still ask for drive.readonly (see DRIVE_SCOPES above).
async function mayRequestDrive(supabase: any, user: { id: string; email?: string }): Promise<boolean> {
  const list = (Deno.env.get("GOOGLE_DRIVE_SCOPE_USERS") || "")
    .split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (list.length) return list.includes(user.id.toLowerCase()) || (!!user.email && list.includes(user.email.toLowerCase()));
  const { data } = await supabase.from("agents").select("role").eq("auth_user_id", user.id).maybeSingle();
  return (data && data.role) === "owner";
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
    // darasapp.com relay once GOOGLE_RELAY_REDIRECT_URI is set (after Dara adds
    // https://darasapp.com/oauth/google/callback to the OAuth client); until then
    // the existing GOOGLE_REDIRECT_URI, so nothing changes before the console does.
    const redirectUri = currentRedirectUri();
    if (!clientId || !redirectUri) {
      return new Response(
        JSON.stringify({
          error: "Google OAuth not configured",
          details: "GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI (or GOOGLE_RELAY_REDIRECT_URI) not set in Supabase secrets.",
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

    // A supervisor in an "Act as user" session must never connect (or reconnect)
    // a Google account on the agent's behalf.
    if (await isImpersonatedRequest(supabase, token)) return supportSessionResponse(corsHeaders);

    const body = await req.json().catch(() => ({}));
    const returnTo = safeReturnTo(body && body.return_to);
    let purposes = expandPurposes(body && body.purpose, body && body.purposes);
    let driveUnavailable = false;
    if (purposes.includes("drive") && !(await mayRequestDrive(supabase, user))) {
      purposes = purposes.filter((p) => p !== "drive");
      driveUnavailable = true;
      if (!purposes.length) {
        return new Response(JSON.stringify({
          drive_unavailable: true,
          error: "Google Drive import isn't available yet. PrismOS is going through Google's verification, and Drive access is not part of it.",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }
    const scopes = scopesForPurposes(purposes);

    // The user id comes from the verified JWT above — never from the body. The
    // redirect_uri is signed into the state so the callback repeats it exactly.
    const state = await signState({ uid: user.id, rt: returnTo, purposes, ru: redirectUri });

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

    return new Response(JSON.stringify({ url, purposes, purpose: purposes.join(","), ...(driveUnavailable ? { drive_unavailable: true } : {}) }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
