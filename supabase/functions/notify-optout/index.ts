// notify-optout
//
// Switches off new-lead emails for one agent, authenticated by the token in the
// link at the bottom of the email. No login.
//
// An opt-out that requires signing in and finding a setting is not an opt-out —
// and the email promises "one click, no explanation needed". This is what makes
// that true.
//
// What the token can do: set email_new_leads = false on ONE preference row.
// That is all. It cannot read the agent's data, cannot act as them, and cannot
// turn anything back ON — so a leaked or guessed token is worth nothing beyond
// silencing a notification the person can have restored by asking.
//
// verify_jwt = false because the caller is an email client, not a signed-in
// session. The token IS the authorisation.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "").trim();
    // A token short enough to guess is not a token.
    if (token.length < 16) return json({ ok: false, error: "That link is not valid." });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: pref } = await admin.from("notification_prefs")
      .select("user_id, email_new_leads").eq("unsubscribe_token", token).maybeSingle();
    // Say the same thing whether the token is unknown or already used — a
    // different answer per case turns this into a way to test tokens.
    if (!pref) return json({ ok: false, error: "That link has expired. Tell Dara and he'll switch them off for you." });

    const { error } = await admin.from("notification_prefs")
      .update({ email_new_leads: false, updated_at: new Date().toISOString() })
      .eq("unsubscribe_token", token);
    if (error) return json({ ok: false, error: "Could not save that. Tell Dara and he'll switch them off for you." });

    return json({ ok: true, already_off: pref.email_new_leads === false });
  } catch (_) {
    return json({ ok: false, error: "Something went wrong. Tell Dara and he'll switch them off for you." });
  }
});
