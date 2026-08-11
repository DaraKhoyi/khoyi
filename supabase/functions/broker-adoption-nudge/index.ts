// broker-adoption-nudge — emails the reinstall + turn-on-notifications steps to the
// agents who most need it (logged in but no push), from the broker's default Gmail.
// Called by the Adoption view. verify_jwt=true (a broker triggers it).
//
// Body: { mode: 'reinstall' }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

const BODY = `Big PrismOS updates just landed — new-lead alerts, a morning brief, voice notes, the Investor Pipeline, and more.

Because you installed the app a while back, it's holding an older version and needs one quick reinstall to catch up. After this, it updates on its own.

iPhone: press and hold the PrismOS icon -> Remove App -> Delete. Then open darasapp.com in Safari, tap the Share button, and choose "Add to Home Screen." Open it from the new icon.

Android/Samsung: press and hold the PrismOS icon -> Uninstall. Then open darasapp.com in Chrome, tap the three-dot menu, and choose "Install app."

Then open PrismOS and tap "Turn on notifications" — that's what pings you the moment a lead comes in.

Takes about a minute. Reply here if anything looks off.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace("Bearer ", "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // who is calling + are they staff?
    const { data: userRes } = await admin.auth.getUser(jwt);
    const uid = userRes?.user?.id;
    if (!uid) return new Response(JSON.stringify({ error: "auth required" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    const { data: a0 } = await admin.from("agents").select("role").or(`user_id.eq.${uid},auth_user_id.eq.${uid}`).limit(1).maybeSingle();
    const isStaff = !!a0 && ["owner", "broker_admin"].includes(String(a0.role || "").toLowerCase());
    if (!isStaff) return new Response(JSON.stringify({ error: "brokerage staff only" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

    // the cohort: agents with a login but no push subscription, who have an email
    const { data: pushRows } = await admin.from("push_subscriptions").select("user_id");
    const hasPush = new Set((pushRows || []).map((r) => r.user_id));
    const { data: agents } = await admin.from("agents").select("email, auth_user_id, active").not("auth_user_id", "is", null).not("email", "is", null);
    const recipients = (agents || [])
      .filter((a) => (a.active === null || a.active === true) && !hasPush.has(a.auth_user_id) && /@/.test(a.email || ""))
      .map((a) => a.email);
    if (!recipients.length) return new Response(JSON.stringify({ ok: true, sent: 0, note: "everyone reachable already has push" }), { headers: { ...cors, "Content-Type": "application/json" } });

    // send from the broker's default account
    const { data: acct } = await admin.from("email_accounts").select("id").eq("user_id", uid).order("is_default", { ascending: false }).limit(1).maybeSingle();
    if (!acct) return new Response(JSON.stringify({ error: "Connect an email account first." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

    // send individually so recipients don't see each other (bcc-style privacy)
    let sent = 0;
    for (const to of recipients) {
      try {
        const { error } = await admin.functions.invoke("gmail-send", { body: {
          account_id: acct.id, to, subject: "One quick step to get the latest PrismOS", body_text: BODY,
        } });
        if (!error) sent++;
      } catch (_) { /* keep going */ }
    }
    return new Response(JSON.stringify({ ok: true, sent, total: recipients.length }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
