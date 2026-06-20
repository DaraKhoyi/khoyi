import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(SUPABASE_URL, SERVICE);
    const now = Date.now();
    const since14 = new Date(now - 14 * 864e5).toISOString();
    const before1 = new Date(now - 1 * 864e5).toISOString();
    // active sent requests, 1-14 days old
    const { data: reqs } = await db.from("signature_requests").select("id,user_id,file_id,title,message,sign_in_order,created_at,status")
      .eq("status", "sent").lt("created_at", before1).gt("created_at", since14);
    if (!reqs || !reqs.length) return new Response(JSON.stringify({ ok: true, reminded: 0 }), { headers: { ...cors, "Content-Type": "application/json" } });

    const acctCache: Record<string, any> = {};
    let reminded = 0;
    for (const r of reqs) {
      const { data: signers } = await db.from("signature_signers").select("*").eq("request_id", r.id).order("sign_order", { ascending: true });
      let targets = (signers || []).filter((s: any) => s.status !== "signed" && s.status !== "declined" && s.email);
      if (r.sign_in_order) {
        const nextUp = (signers || []).find((s: any) => s.status !== "signed" && s.status !== "declined");
        targets = nextUp && nextUp.email ? [nextUp] : [];
      }
      // throttle: only if no reminder in last 2 days
      targets = targets.filter((s: any) => !s.last_reminder_at || (now - new Date(s.last_reminder_at).getTime()) > 2 * 864e5);
      if (!targets.length) continue;
      if (acctCache[r.user_id] === undefined) {
        const { data: accts } = await db.from("email_accounts").select("id,is_active").eq("user_id", r.user_id);
        acctCache[r.user_id] = (accts || []).find((a: any) => a.is_active !== false) || null;
      }
      const acct = acctCache[r.user_id];
      if (!acct) continue;
      for (const s of targets) {
        const url = `https://darasapp.com/sign/${s.token}`;
        try {
          await db.functions.invoke("gmail-send", { body: { account_id: acct.id, to: s.email, subject: `Reminder: signature needed \u2014 ${r.title || "document"}`, body_text: `${r.message || "This is a friendly reminder to sign the document below."}\n\nSign securely here:\n${url}\n\n\u2014 Realty ONE Group Advantage` } });
          await db.from("signature_signers").update({ last_reminder_at: new Date().toISOString() }).eq("id", s.id);
          reminded++;
        } catch (_) {}
      }
    }
    return new Response(JSON.stringify({ ok: true, reminded }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
