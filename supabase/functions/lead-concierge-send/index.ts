// lead-concierge-send — send a concierge draft as a real SMS via OpenPhone and
// mark the row sent. Two callers:
//   • the agent (authenticated), one-tap from the card — body { id, text? }
//   • the auto-send cron (service role) — body { id, auto:true }
// Sends from the agent's active Quo line; records the outbound and closes the row.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const QUO_BASE = "https://api.openphone.com";

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

    // sender line
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
