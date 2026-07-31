// brain-embed
// Generates and stores embeddings for brain entries using OpenAI text-embedding-3-small.
//
// POST body (one of):
//   { id: uuid }              — embed a single entry by id
//   { all_missing: true }     — embed all entries where embedding IS NULL
//   { id: null, all_missing: true }  — same as above
//
// Returns: { ok: true, embedded: <count>, skipped: <count>, errors: <count> }
//
// Auth: requires a valid user JWT. Entries are scoped to the caller's user_id.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEmbeddingUsage } from "../_shared/aiUsage.ts";

let __embedTokens = 0;   // tokens consumed by embedTexts in the current request

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const EMBED_MODEL = "text-embedding-3-small";
const EMBED_DIM = 1536;

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`OpenAI embeddings: ${r.status} ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  __embedTokens += (j?.usage?.prompt_tokens || j?.usage?.total_tokens || 0);
  return (j.data || []).map((d: any) => d.embedding);
}

function buildEmbedText(row: any): string {
  // What's worth embedding: title + content. Tags add useful signal.
  const tags = Array.isArray(row.tags) && row.tags.length > 0 ? `\nTags: ${row.tags.join(", ")}` : "";
  const type = row.type ? `[${row.type}] ` : "";
  return `${type}${row.title || ""}\n\n${row.content || ""}${tags}`.trim().slice(0, 8000);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  __embedTokens = 0;   // reset per request (guards against warm-instance bleed)
  try {
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

    const body = await req.json().catch(() => ({}));
    const { id, all_missing } = body || {};

    // Fetch the target rows, scoped to caller's user_id
    let q = supabase.from("brain").select("id, title, content, type, tags").eq("user_id", userId);
    if (id) {
      q = q.eq("id", id);
    } else if (all_missing) {
      q = q.is("embedding", null).limit(50);   // batch cap per call
    } else {
      return new Response(JSON.stringify({ error: "Either id or all_missing=true required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: rows, error: qErr } = await q;
    if (qErr) throw qErr;
    if (!rows || rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, embedded: 0, skipped: 0, errors: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build embed texts; skip rows with empty content
    const toEmbed = rows.filter(r => buildEmbedText(r).length > 0);
    const skipped = rows.length - toEmbed.length;
    if (toEmbed.length === 0) {
      return new Response(JSON.stringify({ ok: true, embedded: 0, skipped, errors: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const texts = toEmbed.map(buildEmbedText);
    const embeddings = await embedTexts(texts);
    if (embeddings.length !== toEmbed.length) {
      throw new Error(`Embedding count mismatch: got ${embeddings.length}, expected ${toEmbed.length}`);
    }
    try { await logEmbeddingUsage(supabase, { userId, fn: "brain-embed", model: EMBED_MODEL, usage: { prompt_tokens: __embedTokens } }); } catch (_) {}

    // Write each back. Vector type expects the literal '[a,b,c]' format.
    let embedded = 0;
    let errors = 0;
    for (let i = 0; i < toEmbed.length; i++) {
      const row = toEmbed[i];
      const vec = embeddings[i];
      if (!Array.isArray(vec) || vec.length !== EMBED_DIM) {
        errors++;
        continue;
      }
      const vecStr = `[${vec.join(",")}]`;
      const { error: uErr } = await supabase.from("brain")
        .update({ embedding: vecStr })
        .eq("id", row.id)
        .eq("user_id", userId);
      if (uErr) errors++;
      else embedded++;
    }

    return new Response(JSON.stringify({ ok: true, embedded, skipped, errors }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = String(err && (err as any).message ? (err as any).message : err);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
