import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODEL = "claude-sonnet-4-6";
const ANTHROPIC = () => Deno.env.get("ANTHROPIC_API_KEY")!;

async function voyageEmbed(texts: string[]): Promise<number[][]> {
  const key = Deno.env.get("VOYAGE_API_KEY"); const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const r = await fetch("https://api.voyageai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ input: texts.slice(i, i + 64), model: "voyage-3.5", input_type: "document", output_dimension: 1024 }) });
    if (!r.ok) throw new Error("voyage " + r.status); const j = await r.json(); for (const d of j.data) out.push(d.embedding);
  }
  return out;
}
function chunkText(text: string): string[] {
  const MAX = 2400, OV = 300; const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean); const chunks: string[] = []; let cur = "";
  for (const p of paras) { if ((cur + "\n\n" + p).length > MAX && cur) { chunks.push(cur); cur = cur.slice(Math.max(0, cur.length - OV)) + "\n\n" + p; } else { cur = cur ? cur + "\n\n" + p : p; } while (cur.length > MAX * 1.5) { chunks.push(cur.slice(0, MAX)); cur = cur.slice(MAX - OV); } }
  if (cur.trim()) chunks.push(cur.trim()); return chunks.length ? chunks : (text.trim() ? [text.trim()] : []);
}
async function claudeEnrich(text: string): Promise<{ summary: string; tags: string[]; facts: any[]; entities: any[] }> {
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": ANTHROPIC(), "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: `This is a phone call transcript. Reply ONLY as JSON: {"summary":"1-2 sentences","tags":["3-6 lowercase tags"],"facts":[{"type":"date|amount|party|deadline|address|term","key":"short label","value_text":"as written","value_date":"YYYY-MM-DD or null","value_number":<number or null>}],"entities":[{"type":"contact|property|deal","name":"as spoken"}]}. Extract only real, explicit facts/entities.\n\nTRANSCRIPT:\n${text.slice(0, 14000)}` }] }) });
  const j = await r.json(); const raw = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  try { const m = raw.match(/\{[\s\S]*\}/); const p = JSON.parse(m ? m[0] : raw); return { summary: p.summary || "", tags: Array.isArray(p.tags) ? p.tags.slice(0, 6) : [], facts: Array.isArray(p.facts) ? p.facts : [], entities: Array.isArray(p.entities) ? p.entities : [] }; } catch (_) { return { summary: "", tags: [], facts: [], entities: [] }; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await sb.auth.getUser(token);
    if (!user) return J({ error: "Unauthorized" }, 401);
    const uid = user.id;

    // calls with a transcript, not yet in knowledge
    const { data: calls } = await sb.from("quo_calls").select("id, transcript, participant, from_number, to_number, direction, op_created_at, completed_at, contact_id").eq("user_id", uid).not("transcript", "is", null).order("op_created_at", { ascending: false }).limit(25);
    const { data: existing } = await sb.from("knowledge_sources").select("source_url").eq("user_id", uid).like("source_url", "quo_call:%");
    const done = new Set((existing || []).map((r: any) => r.source_url));
    const todo = (calls || []).filter((c: any) => (c.transcript || "").trim().length > 20 && !done.has("quo_call:" + c.id)).slice(0, 8);
    if (!todo.length) return J({ ok: true, processed: 0 });

    let processed = 0;
    const process = async () => {
      for (const c of todo) {
        try {
          let who = c.participant || c.from_number || c.to_number || "Unknown";
          if (c.contact_id) { const { data: ct } = await sb.from("contacts").select("name").eq("id", c.contact_id).maybeSingle(); if (ct?.name) who = ct.name; }
          const when = c.completed_at || c.op_created_at; const dstr = when ? new Date(when).toISOString().slice(0, 10) : "";
          const title = `Call with ${who}${dstr ? " on " + dstr : ""}`;
          const text = String(c.transcript);
          const { data: src } = await sb.from("knowledge_sources").insert({ user_id: uid, scope: "private", title, source_type: "audio", source_url: "quo_call:" + c.id, status: "processing", tags: ["call"] }).select("*").single();
          if (!src) continue;
          const chunks = chunkText(text); const embs = await voyageEmbed(chunks);
          const rows = chunks.map((content, i) => ({ source_id: src.id, user_id: uid, scope: "private", team_id: null, chunk_index: i, content, token_count: Math.ceil(content.length / 4), embedding: "[" + embs[i].join(",") + "]" }));
          for (let i = 0; i < rows.length; i += 100) await sb.from("knowledge_chunks").insert(rows.slice(i, i + 100));
          const { summary, tags, facts, entities } = await claudeEnrich(text);
          if (Array.isArray(facts) && facts.length) {
            const fr = facts.slice(0, 40).map((fx: any) => ({ source_id: src.id, user_id: uid, scope: "private", team_id: null, fact_type: ["date", "amount", "party", "deadline", "address", "term"].includes(fx.type) ? fx.type : "other", fact_key: String(fx.key || "").slice(0, 200), value_text: fx.value_text != null ? String(fx.value_text).slice(0, 1000) : null, value_date: (typeof fx.value_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fx.value_date)) ? fx.value_date : null, value_number: (typeof fx.value_number === "number") ? fx.value_number : null, confidence: 0.75 }));
            try { await sb.from("knowledge_facts").insert(fr); } catch (_) {}
          }
          if (c.contact_id) { try { await sb.from("knowledge_links").insert({ source_id: src.id, user_id: uid, target_type: "contact", target_id: c.contact_id, confidence: 0.9, confirmed: true }); } catch (_) {} }
          for (const ent of (Array.isArray(entities) ? entities.slice(0, 10) : [])) {
            const safe = String(ent?.name || "").split(",")[0].replace(/[%()]/g, " ").trim(); if (safe.length < 3) continue;
            let tid: string | null = null, tt: string | null = null;
            try { if (ent.type === "property") { const { data } = await sb.from("properties").select("id").eq("user_id", uid).ilike("address", `%${safe}%`).limit(1); if (data?.[0]) { tid = data[0].id; tt = "property"; } } else if (ent.type === "deal") { const { data } = await sb.from("deals").select("id").eq("user_id", uid).ilike("name", `%${safe}%`).limit(1); if (data?.[0]) { tid = data[0].id; tt = "deal"; } } } catch (_) {}
            if (tid && tt) { try { await sb.from("knowledge_links").insert({ source_id: src.id, user_id: uid, target_type: tt, target_id: tid, confidence: 0.7, confirmed: false }); } catch (_) {} }
          }
          await sb.from("knowledge_sources").update({ status: "ready", extracted_text: text.slice(0, 500000), summary, tags: Array.from(new Set(["call", ...tags])), processed_at: new Date().toISOString() }).eq("id", src.id);
          processed++;
        } catch (_) { /* skip this call */ }
      }
    };
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(process());
    else await process();
    return J({ ok: true, queued: todo.length }, 202);
  } catch (e) { return J({ error: String(e) }, 500); }
});
