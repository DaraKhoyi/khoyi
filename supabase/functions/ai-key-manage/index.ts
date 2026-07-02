// ai-key-manage — lets an agent store/test/remove their own Anthropic API key.
// The key is validated with a tiny live call, then AES-GCM encrypted with a
// server-only secret before storage. The client never receives the raw key back.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function aesKey(): Promise<CryptoKey> {
  const secret = Deno.env.get("AI_KEY_ENC_SECRET") || "";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
function b64(buf: ArrayBuffer): string { return btoa(String.fromCharCode(...new Uint8Array(buf))); }
async function encrypt(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), new TextEncoder().encode(plain));
  return b64(iv.buffer) + ":" + b64(ct);
}

async function pingAnthropic(key: string): Promise<boolean> {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-4-5", max_tokens: 1, messages: [{ role: "user", content: "hi" }] }),
    });
    return r.ok; // 200 = valid key; 401/403 = invalid
  } catch (_) { return false; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return J({ error: "Unauthorized" }, 401);
    const { data: ures } = await supabase.auth.getUser(token);
    const user = ures?.user;
    if (!user) return J({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body.action;

    if (action === "remove") {
      await supabase.from("user_ai_keys").delete().eq("user_id", user.id);
      return J({ ok: true, status: "removed" });
    }

    if (action === "set") {
      const key = String(body.key || "").trim();
      if (!key.startsWith("sk-ant-")) return J({ error: "That doesn't look like an Anthropic API key (they start with \"sk-ant-\")." }, 400);
      const ok = await pingAnthropic(key);
      if (!ok) return J({ error: "Anthropic rejected that key. Double-check you copied it correctly and that the account has billing set up." }, 400);
      await supabase.from("user_ai_keys").upsert({
        user_id: user.id, provider: "anthropic",
        key_ciphertext: await encrypt(key), key_last4: key.slice(-4),
        status: "active", updated_at: new Date().toISOString(),
      }, { onConflict: "user_id" });
      return J({ ok: true, status: "active", last4: key.slice(-4) });
    }

    if (action === "status") {
      const { data } = await supabase.from("user_ai_keys").select("key_last4, status, updated_at").eq("user_id", user.id).maybeSingle();
      return J({ ok: true, key: data || null });
    }

    return J({ error: "Unknown action" }, 400);
  } catch (e) {
    return J({ error: String(e).slice(0, 200) }, 500);
  }
});
