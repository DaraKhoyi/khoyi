import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

async function aesKey() { const s = Deno.env.get("AI_KEY_ENC_SECRET") || ""; const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return crypto.subtle.importKey("raw", h, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
async function decryptKey(st: string) { try { const [a, b] = st.split(":"); const iv = Uint8Array.from(atob(a), c => c.charCodeAt(0)); const ct = Uint8Array.from(atob(b), c => c.charCodeAt(0)); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), ct); return new TextDecoder().decode(pt); } catch (_) { return null; } }
async function resolveKey(sb: any, uid: string | null, pk: string) { if (uid) { const { data } = await sb.from("user_ai_keys").select("key_ciphertext, status").eq("user_id", uid).maybeSingle(); if (data?.status === "active" && data.key_ciphertext) { const k = await decryptKey(data.key_ciphertext); if (k) return { key: k, usedOwn: true }; } } return { key: pk, usedOwn: false }; }
async function logUsage(sb: any, o: any) { try { const inT = o.usage?.input_tokens || 0, outT = o.usage?.output_tokens || 0; const rt: Record<string, number[]> = { "claude-sonnet-4-6": [3, 15] }; const [ri, ro] = rt[o.model] || [3, 15]; await sb.from("ai_usage_log").insert({ user_id: o.userId, fn: o.fn, model: o.model, input_tokens: inT, output_tokens: outT, web_searches: 0, cost_usd: (inT / 1e6) * ri + (outT / 1e6) * ro, used_own_key: !!o.usedOwn }); } catch (_) {} }
const MODEL = "claude-sonnet-4-6";

async function voyageEmbedOne(text: string, inputType: "query" | "document"): Promise<string> {
  const r = await fetch("https://api.voyageai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("VOYAGE_API_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({ input: [text], model: "voyage-3.5", input_type: inputType, output_dimension: 1024 }) });
  if (!r.ok) throw new Error("embed " + r.status);
  const j = await r.json(); return "[" + j.data[0].embedding.join(",") + "]";
}
async function voyageRerank(query: string, docs: string[], topK: number): Promise<{ index: number; score: number }[]> {
  const r = await fetch("https://api.voyageai.com/v1/rerank", { method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("VOYAGE_API_KEY")}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, documents: docs, model: "rerank-2.5", top_k: topK }) });
  if (!r.ok) return docs.map((_, i) => ({ index: i, score: 0 }));
  const j = await r.json(); return j.data.map((d: any) => ({ index: d.index, score: d.relevance_score }));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return J({ error: "Unauthorized" }, 401);
    const uid = user.id;
    const { query, surface } = await req.json();
    if (!query || !String(query).trim()) return J({ error: "query required" }, 400);

    const qEmbed = await voyageEmbedOne(String(query), "query");
    const userClient = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: hits, error: sErr } = await userClient.rpc("knowledge_search", { query_embedding: qEmbed, query_text: String(query), match_count: 20 });
    if (sErr) return J({ error: "search failed: " + sErr.message }, 500);
    if (!hits || hits.length === 0) return J({ answer: "I don't have anything about that in your knowledge base yet.", citations: [] });

    const ranked = await voyageRerank(String(query), hits.map((h: any) => h.content), Math.min(6, hits.length));
    const top = ranked.map(r => ({ ...hits[r.index], rerank: r.score }));

    const context = top.map((t: any, i: number) => `[${i + 1}] (source: ${t.title || "untitled"}${t.trust_level === "authoritative" ? ", authoritative" : ""})\n${t.content}`).join("\n\n");
    const { key, usedOwn } = await resolveKey(admin, uid, Deno.env.get("ANTHROPIC_API_KEY")!);
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1000, messages: [{ role: "user", content: `You are answering strictly from the user's own stored knowledge. Use ONLY the sources below. If they don't contain the answer, say you don't have that in your knowledge base — do not guess. Cite the sources you use with their bracket numbers like [1].\n\nSOURCES:\n${context}\n\nQUESTION: ${query}` }] }),
    });
    const j = await r.json();
    logUsage(admin, { userId: uid, fn: "knowledge-ask", model: MODEL, usage: j.usage, usedOwn });
    const answer = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();

    try { await admin.from("knowledge_usage").insert({ source_id: top[0]?.source_id || null, chunk_id: top[0]?.chunk_id || null, user_id: uid, surface: surface || "search", query: String(query).slice(0, 500) }); } catch (_) {}

    const citations = top.map((t: any, i: number) => ({ n: i + 1, source_id: t.source_id, title: t.title, snippet: (t.content || "").slice(0, 180) }));
    return J({ answer, citations });
  } catch (e) { return J({ error: String(e) }, 500); }
});
