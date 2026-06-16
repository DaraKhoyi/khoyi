// quo-status
// Health check for the Quo (OpenPhone) integration, used by the Systems board.
// Hits GET /v1/phone-numbers with the server-side QUO_API_KEY and reports how
// many numbers are reachable. The key never reaches the public client bundle.
//
// Returns: { ok, number_count, numbers: [{id, number, name}], latency_ms } | { ok:false, ... }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const authHeader = req.headers.get("Authorization") || "";
    const user = (await supabase.auth.getUser(authHeader.replace("Bearer ", ""))).data.user;
    if (!user) {
      return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("QUO_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ ok: false, error: "QUO_API_KEY not configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const t0 = Date.now();
    const r = await fetch("https://api.openphone.com/v1/phone-numbers", {
      headers: { "Authorization": apiKey, "User-Agent": "KhoyiApp/1.0" },
    });
    const latency_ms = Date.now() - t0;
    const text = await r.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }

    if (!r.ok) {
      return new Response(JSON.stringify({
        ok: false,
        status: r.status,
        error: parsed?.message || parsed?.errors?.[0]?.message || `Quo returned ${r.status}`,
        latency_ms,
      }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const list = Array.isArray(parsed?.data) ? parsed.data : [];
    const numbers = list.map((n: any) => ({
      id: n.id,
      number: n.number || n.phoneNumber || n.formattedNumber,
      name: n.name,
    }));

    return new Response(JSON.stringify({
      ok: true,
      number_count: numbers.length,
      numbers,
      latency_ms,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
