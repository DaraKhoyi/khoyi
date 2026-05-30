// brain-semantic-search
// Semantic search over the brain table using OpenAI text-embedding-3-small
// plus the search_brain_semantic Postgres RPC (pgvector cosine similarity).
//
// POST body: { query: string, limit?: number, min_similarity?: number }
// Returns: { results: Array<{id,type,title,content,tags,pinned,event_date,created_at,strength,similarity}> }
//
// Auth: requires a valid user JWT. RPC is scoped to caller's user_id.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const EMBED_MODEL = "text-embedding-3-small";

async function embedQuery(text: string): Promise<number[]> {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: text }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI embeddings: ${r.status} ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  return j.data?.[0]?.embedding;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { query, limit = 25, min_similarity = 0.15 } = body || {};
    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return new Response(JSON.stringify({ error: "query required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // SECURITY: derive user_id from JWT only
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = user.id;

    const embedding = await embedQuery(query.trim().slice(0, 8000));
    if (!Array.isArray(embedding)) throw new Error("Embedding failed");
    const vecStr = `[${embedding.join(",")}]`;

    const { data, error } = await supabase.rpc("search_brain_semantic", {
      p_embedding: vecStr,
      p_user_id: userId,
      p_limit: Math.max(1, Math.min(100, Number(limit) || 25)),
      p_min_similarity: Math.max(0, Math.min(1, Number(min_similarity) || 0.15)),
    });
    if (error) throw error;

    return new Response(JSON.stringify({ results: data || [] }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = String(err && (err as any).message ? (err as any).message : err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
