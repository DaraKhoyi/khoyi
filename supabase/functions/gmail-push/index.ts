// gmail-push — public webhook that Google Pub/Sub calls when Gmail pushes a
// change notification. Secured by a ?token= query param (Pub/Sub can't send a
// Supabase JWT). On a valid notification it triggers an immediate incremental
// sync for the affected account. Always acks 200 so Pub/Sub doesn't retry-storm.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== Deno.env.get("PUSH_VERIFY_TOKEN")) {
    return new Response("forbidden", { status: 401 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const dataB64 = body?.message?.data;
    if (dataB64) {
      const decoded = JSON.parse(atob(dataB64));
      const email = (decoded.emailAddress || "").toLowerCase();
      if (email) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
        const { data: acct } = await supabase.from("email_accounts")
          .select("id").eq("email_address", email).eq("is_active", true).maybeSingle();
        if (acct) {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-sync`, {
            method: "POST",
            headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: acct.id }),
          });
        }
      }
    }
  } catch (_) { /* swallow — always ack */ }
  return new Response("ok", { status: 200 });
});
