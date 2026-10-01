// broker-adoption-nudge — emails the reinstall + turn-on-notifications steps to the
// agents who most need it (logged in but no WORKING device), from the broker's default Gmail.
// Called by the Adoption view. verify_jwt=true (a broker triggers it).
//
// Body: { mode: 'reinstall' }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

const BODY = `Big PrismOS updates just landed — new-lead alerts, a morning brief, voice notes, the Investor Pipeline, and more.

Because you installed the app a while back, it's holding an older version and needs one quick reinstall to catch up. After this, it updates on its own.

iPhone: press and hold the PrismOS icon -> Remove App -> Delete. Then open darasapp.com in Safari, tap the Share button, and choose "Add to Home Screen." Open it from the new icon.

Android/Samsung: press and hold the PrismOS icon -> Uninstall. Then open darasapp.com in Chrome, tap the three-dot menu, and choose "Install app."

Then open PrismOS and tap "Turn on alerts" at the top of Today. It sends a test alert right away, so you'll know it worked — that's what pings you the moment a lead comes in.

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

    // The cohort: agents with a login and NO WORKING DEVICE. 1 Oct: this used to
    // skip anyone with any push_subscriptions row, so an agent whose only phone
    // had been refusing alerts for weeks was "already set up" and never nudged.
    // Working = last_error is null, the same test lead_reachable() uses.
    const { data: pushRows } = await admin.from("push_subscriptions").select("user_id, last_error");
    const working = new Set((pushRows || []).filter((r) => !r.last_error).map((r) => r.user_id));
    // How many alerts in the last 7 days reached none of their devices — told
    // to them in the email, because "you missed 8 lead alerts" is the reason to act.
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { data: logRows } = await admin.from("push_log").select("user_id, sent, tag").gt("created_at", since).eq("sent", 0);
    const missed = new Map<string, number>();
    for (const r of logRows || []) if (r.user_id && r.tag !== "push-test") missed.set(r.user_id, (missed.get(r.user_id) || 0) + 1);
    const { data: agents } = await admin.from("agents").select("email, auth_user_id, active").not("auth_user_id", "is", null).not("email", "is", null);
    const recipients = (agents || [])
      .filter((a) => (a.active === null || a.active === true) && !working.has(a.auth_user_id) && /@/.test(a.email || ""))
      .map((a) => ({ to: a.email as string, missed: missed.get(a.auth_user_id) || 0 }));
    if (!recipients.length) return new Response(JSON.stringify({ ok: true, sent: 0, note: "everyone with a login has a working device" }), { headers: { ...cors, "Content-Type": "application/json" } });

    // send from the broker's default account
    const { data: acct } = await admin.from("email_accounts").select("id").eq("user_id", uid).order("is_default", { ascending: false }).limit(1).maybeSingle();
    if (!acct) return new Response(JSON.stringify({ error: "Connect an email account first." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

    // send individually so recipients don't see each other (bcc-style privacy)
    let sent = 0;
    for (const { to, missed: n } of recipients) {
      const lead = n > 0
        ? `PrismOS tried to alert you ${n === 1 ? "once" : n + " times"} this week about leads and follow-ups, and none of those alerts reached your phone. Here's the one-minute fix.\n\n`
        : "";
      try {
        const { error } = await admin.functions.invoke("gmail-send", { headers: { "x-qcp-token": Deno.env.get("QCP_TOKEN") || "" }, body: {
          account_id: acct.id, user_id: uid, to, subject: n > 0 ? `You missed ${n} PrismOS alert${n === 1 ? "" : "s"} this week` : "One quick step to get the latest PrismOS", body_text: lead + BODY,
        } });
        if (!error) sent++;
      } catch (_) { /* keep going */ }
    }
    return new Response(JSON.stringify({ ok: true, sent, total: recipients.length }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
