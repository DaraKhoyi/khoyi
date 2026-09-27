// scheduled-email-send — cron. Sends queued emails whose time has arrived, via
// gmail-send (which uses the account's stored refresh token; the user_id makes it
// a trusted internal delivery). Logs each to the contact timeline.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
serve(async (req) => {
  try {
    if ((req.headers.get("x-internal-token") || "") !== (Deno.env.get("QCP_TOKEN") || "")) return J({ error: "unauthorized" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: due } = await admin.from("scheduled_emails").select("*").eq("status", "scheduled").lte("send_at", new Date().toISOString()).order("send_at").limit(25);
    if (!due || !due.length) return J({ ok: true, sent: 0 });
    let sent = 0, failed = 0;
    for (const m of due) {
      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}` },
          body: JSON.stringify({ account_id: m.account_id, to: m.to_email, subject: m.subject || "(no subject)", body_text: m.body_text || "", attachments: m.attachments || [], track: !!m.track, contact_id: m.contact_id, user_id: m.user_id }),
        });
        const jr = await r.json().catch(() => ({}));
        if (!r.ok || jr?.error) throw new Error(jr?.error || `gmail-send ${r.status}`);
        await admin.from("scheduled_emails").update({ status: "sent", sent_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString() }).eq("id", m.id);
        sent++;
        if (m.contact_id) {
          try { await admin.from("contact_interactions").insert({ user_id: m.user_id, contact_id: m.contact_id, channel: "email", kind: "email", direction: "outbound", occurred_at: new Date().toISOString(), brief: `Scheduled email sent: ${(m.subject || "(no subject)").slice(0, 120)}`, body: m.body_text || "" }); } catch (_) {}
        }
      } catch (e) {
        await admin.from("scheduled_emails").update({ status: "failed", error: String(e).slice(0, 500), updated_at: new Date().toISOString() }).eq("id", m.id);
        failed++;
      }
    }
    return J({ ok: true, sent, failed });
  } catch (e) { return J({ error: String(e) }, 500); }
});
