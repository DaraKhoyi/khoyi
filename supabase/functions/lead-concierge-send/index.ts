// lead-concierge-send — send a concierge draft as a real SMS via OpenPhone and
// mark the row sent. Two callers:
//   • the agent (authenticated), one-tap from the card — body { id, text? }
//   • the auto-send cron (service role) — body { id, auto:true }
// Sends from the agent's active Quo line; records the outbound and closes the row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const QUO_BASE = "https://api.openphone.com";

// functions.invoke() throws away the callee's error body and leaves only
// "Edge Function returned a non-2xx status code". The real reason is in
// err.context, which is a Response. Read it so the card can show something true.
async function explain(res: any, err: any): Promise<string> {
  if (res && res.error) return String(res.error);
  if (!err) return "unknown";
  try {
    const ctx = err.context;
    if (ctx && typeof ctx.text === "function") {
      const t = await ctx.text();
      try { const j = JSON.parse(t); if (j && j.error) return String(j.error); } catch (_) {}
      if (t) return t.slice(0, 200);
    }
  } catch (_) {}
  return err.message || String(err);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const b = await req.json();
    const { id, text, auto } = b;
    if (!id) return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    // authorize: service-role (auto) OR the owning agent
    let callerId: string | null = null;
    if (!auto) {
      const { data: u } = await admin.auth.getUser((req.headers.get("Authorization") || "").replace("Bearer ", ""));
      callerId = u?.user?.id || null;
      if (!callerId) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const { data: lc } = await admin.from("lead_concierge").select("*").eq("id", id).maybeSingle();
    if (!lc) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    if (lc.status !== "pending") return new Response(JSON.stringify({ ok: true, already: lc.status }), { headers: { ...cors, "Content-Type": "application/json" } });
    if (!auto && callerId !== lc.user_id) {
      const { data: staff } = await admin.from("agents").select("role").eq("auth_user_id", callerId).in("role", ["owner", "broker_admin"]).maybeSingle();
      if (!staff) return new Response(JSON.stringify({ error: "Not permitted" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const message = (text && String(text).trim()) || lc.draft;
    if (!message) return new Response(JSON.stringify({ error: "no message" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    // ── EMAIL path ────────────────────────────────────────────────────────────
    if (lc.channel === "email") {
      const ctx = lc.email_context || {};
      // resolve the sending account: the one the lead emailed, else the user's default
      let accountId = ctx.account_id || null;
      if (!accountId) {
        const { data: acct } = await admin.from("email_accounts").select("id").eq("user_id", lc.user_id).order("is_default", { ascending: false }).limit(1).maybeSingle();
        accountId = acct && acct.id;
      }
      if (!accountId || !lc.lead_email) {
        await admin.from("lead_concierge").update({ status: "failed" }).eq("id", id);
        return new Response(JSON.stringify({ error: "No connected email account to send from." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      }
      const subject = (b.subject && String(b.subject)) || lc.draft_subject || "Thanks for reaching out";
      // user_id is REQUIRED here. gmail-send authenticates the caller and only
      // accepts a service-role call when the body names the user it is acting
      // for; without it every send 401'd, which is why no lead email has ever
      // gone out. lc.user_id comes from the row we just loaded by id, never from
      // the request, so this cannot be used to send as someone else.
      const { data: sendRes, error: sendErr } = await admin.functions.invoke("gmail-send", { body: {
        account_id: accountId, user_id: lc.user_id,
        to: lc.lead_email, subject,
        body_text: message,
        reply_to_message_id: ctx.provider_message_id || undefined,
        in_reply_to_thread_id: ctx.provider_thread_id || undefined,
      } });
      if (sendErr || (sendRes && sendRes.error)) {
        // supabase-js reports "Edge Function returned a non-2xx status code" and
        // hides the real reason in the response body. Dig it out — a message the
        // agent cannot act on is the same as no message.
        let detail = await explain(sendRes, sendErr);
        // A revoked Google grant is the most common real cause and the only one
        // the agent can actually fix. Google's wording ("invalid_grant") means
        // nothing to them; name the account and say what to do.
        if (/invalid_grant|expired or revoked|No refresh_token/i.test(detail)) {
          const { data: acct } = await admin.from("email_accounts").select("email_address").eq("id", accountId).maybeSingle();
          detail = "Gmail needs reconnecting for " + ((acct && acct.email_address) || "your sending account") +
                   " \u2014 open Settings \u2192 Email accounts and reconnect, then send again.";
        }
        // Only the cron marks a row failed. A person tapping Send wants to try
        // again; parking the row as failed removed the card and dropped the lead.
        if (auto) await admin.from("lead_concierge").update({ status: "failed" }).eq("id", id);
        return new Response(JSON.stringify({ error: "Email send failed: " + detail }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
      }
      await admin.from("lead_concierge").update({ status: auto ? "auto_sent" : "sent", sent_text: message, sent_at: new Date().toISOString(), sent_by: auto ? "auto" : "agent" }).eq("id", id);
      if (auto) { try { await admin.functions.invoke("push-send", { body: { user_id: lc.user_id, title: "Auto-replied to a new lead", body: message.slice(0, 120), url: "https://darasapp.com/?concierge=" + id, tag: "concierge" } }); } catch (_) {} }
      return new Response(JSON.stringify({ ok: true, sent: true, channel: "email" }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ── SMS path (OpenPhone / Quo) ──────────────────────────────────────────────
    const { data: qs } = await admin.from("quo_settings").select("active_number, active_phone_number_id").eq("user_id", lc.user_id).maybeSingle();
    const from = qs?.active_number;
    const apiKey = Deno.env.get("QUO_API_KEY");
    if (!from || !apiKey) {
      await admin.from("lead_concierge").update({ status: "failed" }).eq("id", id);
      return new Response(JSON.stringify({ error: "No active phone line configured for this agent." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const send = await fetch(`${QUO_BASE}/v1/messages`, {
      method: "POST",
      headers: { "Authorization": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [lc.lead_phone], content: message }),
    });
    if (!send.ok) {
      const t = await send.text();
      await admin.from("lead_concierge").update({ status: "failed" }).eq("id", id);
      return new Response(JSON.stringify({ error: "Send failed: " + t.slice(0, 160) }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
    }

    await admin.from("lead_concierge").update({ status: auto ? "auto_sent" : "sent", sent_text: message, sent_at: new Date().toISOString(), sent_by: auto ? "auto" : "agent" }).eq("id", id);

    // if it auto-sent, let the agent know it went out on their behalf
    if (auto) {
      try { await admin.functions.invoke("push-send", { body: { user_id: lc.user_id, title: "Auto-replied to a new lead", body: message.slice(0, 120), url: "https://darasapp.com/?concierge=" + id, tag: "concierge" } }); } catch (_) {}
    }

    return new Response(JSON.stringify({ ok: true, sent: true }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
