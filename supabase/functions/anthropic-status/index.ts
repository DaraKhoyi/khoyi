// anthropic-status — server-side Anthropic API health for the Systems dashboard.
// Uses the ANTHROPIC_API_KEY Supabase secret (never shipped to the public frontend).
// GET /v1/models validates the key + reachability with ZERO token cost.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const key = Deno.env.get("ANTHROPIC_API_KEY");
    if (!key) return J({ ok: false, error: "ANTHROPIC_API_KEY not set" }, 500);

    const t0 = Date.now();
    const r = await fetch("https://api.anthropic.com/v1/models?limit=100", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    const ms = Date.now() - t0;

    if (r.status === 401 || r.status === 403) {
      return J({ ok: false, status: r.status, message: "API key rejected" });
    }
    if (!r.ok) {
      const txt = await r.text();
      return J({ ok: false, status: r.status, message: txt.slice(0, 200) });
    }
    const d = await r.json();
    const models = Array.isArray(d.data) ? d.data.map((m: { id: string }) => m.id) : [];

    // The models list (above) costs nothing and only proves the key is valid.
    // Do a tiny real message call so this health check also catches the case
    // that actually breaks Ari: messages failing (e.g. credit balance too low)
    // while model listing still works.
    let messages_ok = false;
    let messages_status = 0;
    let messages_error: string | null = null;
    try {
      const mr = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
      });
      messages_status = mr.status;
      messages_ok = mr.ok;
      if (!mr.ok) messages_error = (await mr.text().catch(() => "")).slice(0, 300);
    } catch (e) {
      messages_error = String(e);
    }

    return J({ ok: true && messages_ok, key_valid: true, latency_ms: ms, model_count: models.length, models, messages_ok, messages_status, messages_error });
  } catch (e) {
    return J({ ok: false, error: String(e) }, 500);
  }
});
