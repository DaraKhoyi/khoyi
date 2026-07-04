// booking-get — public (verify_jwt=false). Returns a booking's details by
// cancel_token so the page can pre-fill a reschedule. No PII beyond what the
// person who holds the link already submitted.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const token = String(b.cancel_token || "").trim();
    if (!token) return json({ ok: false, error: "missing_token" }, 400);
    const { data: bk } = await admin.from("bookings")
      .select("slug, client_name, client_email, client_phone, notes, meeting_type, duration_minutes, start_at, status, location")
      .eq("cancel_token", token).maybeSingle();
    if (!bk) return json({ ok: false, error: "not_found" }, 404);
    return json({ ok: true, booking: bk });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
