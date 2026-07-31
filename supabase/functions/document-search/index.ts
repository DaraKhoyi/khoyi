// document-search — hybrid keyword + semantic search over the user's documents.
// POST { query, contact_id? }  (auth: user JWT). Embeds the query (OpenAI) and
// ranks by full-text rank + cosine similarity.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEmbeddingUsage } from "../_shared/aiUsage.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI = Deno.env.get("OPENAI_API_KEY") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return J({ error: "Unauthorized" }, 401);
    const b = await req.json().catch(() => ({}));
    const query = String(b.query || "").trim();
    let emb: string | null = null;
    if (OPENAI && query) {
      try {
        const r = await fetch("https://api.openai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "content-type": "application/json" }, body: JSON.stringify({ model: "text-embedding-3-small", input: query.slice(0, 8000) }) });
        const d = await r.json(); const v = d?.data?.[0]?.embedding; if (Array.isArray(v)) emb = `[${v.join(",")}]`;
        try { await logEmbeddingUsage(admin, { userId: user.id, fn: "document-search", model: "text-embedding-3-small", usage: d?.usage }); } catch (_) {}
      } catch (_) {}
    }
    const { data, error } = await admin.rpc("search_documents", { p_user_id: user.id, p_query: query, p_embedding: emb, p_contact_id: b.contact_id || null, p_limit: b.limit || 20 });
    if (error) return J({ error: error.message }, 500);
    return J({ ok: true, results: data || [] });
  } catch (e) { return J({ error: String(e) }, 500); }
});
