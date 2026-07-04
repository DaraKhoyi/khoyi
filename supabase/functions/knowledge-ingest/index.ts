import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

// ---- BYOK + metering (same pattern as the other AI functions) ----
async function aesKey() { const secret = Deno.env.get("AI_KEY_ENC_SECRET") || ""; const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)); return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
async function decryptKey(stored: string) { try { const [ivB, ctB] = stored.split(":"); const iv = Uint8Array.from(atob(ivB), c => c.charCodeAt(0)); const ct = Uint8Array.from(atob(ctB), c => c.charCodeAt(0)); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), ct); return new TextDecoder().decode(pt); } catch (_) { return null; } }
async function resolveKey(sb: any, userId: string | null, platformKey: string) { if (userId) { const { data } = await sb.from("user_ai_keys").select("key_ciphertext, status").eq("user_id", userId).maybeSingle(); if (data && data.status === "active" && data.key_ciphertext) { const k = await decryptKey(data.key_ciphertext); if (k) return { key: k, usedOwn: true }; } } return { key: platformKey, usedOwn: false }; }
const AI_RATES: Record<string, number[]> = { "claude-opus-4-8": [5, 25], "claude-sonnet-4-6": [3, 15], "claude-sonnet-5": [3, 15], "claude-haiku-4-5": [1, 5] };
async function logUsage(sb: any, o: any) { try { const inT = o.usage?.input_tokens || 0, outT = o.usage?.output_tokens || 0; const [ri, ro] = AI_RATES[o.model] || [3, 15]; const cost = (inT / 1e6) * ri + (outT / 1e6) * ro; await sb.from("ai_usage_log").insert({ user_id: o.userId, fn: o.fn, model: o.model, input_tokens: inT, output_tokens: outT, web_searches: 0, cost_usd: cost, used_own_key: !!o.usedOwn }); } catch (_) {} }

const MODEL = "claude-sonnet-4-6";

async function voyageEmbed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
  const key = Deno.env.get("VOYAGE_API_KEY");
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const batch = texts.slice(i, i + 64);
    const r = await fetch("https://api.voyageai.com/v1/embeddings", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ input: batch, model: "voyage-3.5", input_type: inputType, output_dimension: 1024 }),
    });
    if (!r.ok) throw new Error("Voyage embed failed: " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json();
    for (const d of j.data) out.push(d.embedding);
  }
  return out;
}

async function claudeExtract(sb: any, uid: string | null, b64: string, mediaType: string, isPdf: boolean): Promise<string> {
  const { key, usedOwn } = await resolveKey(sb, uid, Deno.env.get("ANTHROPIC_API_KEY")!);
  const block = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: [block, { type: "text", text: "Transcribe ALL text in this document verbatim. Then, if it's an image/scan, add a short factual description of any non-text content (tables, diagrams, photos). Output plain text only — no preamble." }] }] }),
  });
  const j = await r.json();
  logUsage(sb, { userId: uid, fn: "knowledge-extract", model: MODEL, usage: j.usage, usedOwn });
  return (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}

async function claudeEnrich(sb: any, uid: string | null, text: string): Promise<{ summary: string; tags: string[]; facts: any[]; entities: any[] }> {
  const { key, usedOwn } = await resolveKey(sb, uid, Deno.env.get("ANTHROPIC_API_KEY")!);
  const prompt = `Analyze the text and reply ONLY as JSON (no preamble):
{
 "summary": "1-2 sentence summary",
 "tags": ["3-6 short lowercase topic tags"],
 "facts": [ {"type":"date|amount|party|deadline|address|term","key":"short label like 'base drawing due' or 'purchase price'","value_text":"the value as written","value_date":"YYYY-MM-DD or null","value_number": <number or null>} ],
 "entities": [ {"type":"contact|property|deal","name":"the person name, property address, or deal name exactly as written"} ]
}
Extract only REAL, explicit facts and named entities present in the text. Use null when a value doesn't apply. Keep keys short.

TEXT:
${text.slice(0, 14000)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
  });
  const j = await r.json();
  logUsage(sb, { userId: uid, fn: "knowledge-enrich", model: MODEL, usage: j.usage, usedOwn });
  const raw = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  try { const m = raw.match(/\{[\s\S]*\}/); const pj = JSON.parse(m ? m[0] : raw); return { summary: pj.summary || "", tags: Array.isArray(pj.tags) ? pj.tags.slice(0, 6) : [], facts: Array.isArray(pj.facts) ? pj.facts : [], entities: Array.isArray(pj.entities) ? pj.entities : [] }; }
  catch (_) { return { summary: "", tags: [], facts: [], entities: [] }; }
}
function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
}

function chunkText(text: string): string[] {
  const MAX = 2400, OVERLAP = 300;
  const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks: string[] = []; let cur = "";
  for (const p of paras) {
    if ((cur + "\n\n" + p).length > MAX && cur) { chunks.push(cur); cur = cur.slice(Math.max(0, cur.length - OVERLAP)) + "\n\n" + p; }
    else { cur = cur ? cur + "\n\n" + p : p; }
    while (cur.length > MAX * 1.5) { chunks.push(cur.slice(0, MAX)); cur = cur.slice(MAX - OVERLAP); }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : (text.trim() ? [text.trim()] : []);
}

async function transcribeAudio(bytes: Uint8Array): Promise<string> {
  const key = Deno.env.get("ASSEMBLYAI_API_KEY");
  if (!key) throw new Error("Audio transcription isn't configured (no ASSEMBLYAI_API_KEY)");
  const up = await fetch("https://api.assemblyai.com/v2/upload", { method: "POST", headers: { authorization: key }, body: bytes });
  if (!up.ok) throw new Error("Audio upload failed: " + up.status);
  const upUrl = (await up.json()).upload_url;
  const sub = await fetch("https://api.assemblyai.com/v2/transcript", { method: "POST", headers: { authorization: key, "Content-Type": "application/json" }, body: JSON.stringify({ audio_url: upUrl, speaker_labels: true }) });
  const tid = (await sub.json()).id;
  if (!tid) throw new Error("Could not start transcription");
  for (let i = 0; i < 38; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const tr = await fetch(`https://api.assemblyai.com/v2/transcript/${tid}`, { headers: { authorization: key } });
    const t = await tr.json();
    if (t.status === "completed") {
      if (Array.isArray(t.utterances) && t.utterances.length) return t.utterances.map((u: any) => `Speaker ${u.speaker}: ${u.text}`).join("\n");
      return t.text || "";
    }
    if (t.status === "error") throw new Error("Transcription failed: " + (t.error || ""));
  }
  throw new Error("Transcription is taking too long \u2014 for very long audio, try a shorter clip.");
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
    const b = await req.json();
    const scope = ["private", "team", "brokerage"].includes(b.scope) ? b.scope : "private";
    const team_id = scope === "team" ? (b.team_id || null) : null;
    const trust = ["authoritative", "standard", "draft"].includes(b.trust_level) ? b.trust_level : "standard";
    const kind = b.kind; // 'text' | 'url' | 'file'

    // Create the source row up front (status processing)
    const srcType = kind === "url" ? "url" : kind === "text" ? "text" : (b.mime_type?.includes("pdf") ? "pdf" : b.mime_type?.startsWith("image/") ? "image" : (b.mime_type?.startsWith("audio/") || b.mime_type?.startsWith("video/")) ? "audio" : "other");
    const { data: src, error: srcErr } = await sb.from("knowledge_sources").insert({
      user_id: uid, scope, team_id, title: b.title || b.filename || (b.url ? b.url : "Untitled"),
      source_type: srcType, original_path: b.storage_path || null, source_url: b.url || null,
      mime_type: b.mime_type || null, trust_level: trust, tags: Array.isArray(b.tags) ? b.tags : [],
      project: b.project || null, status: "processing",
    }).select("*").single();
    if (srcErr || !src) return J({ error: "Could not create source: " + (srcErr?.message || "") }, 500);

    const process = async () => {
      try {
        let text = "";
        if (kind === "text") text = String(b.text || "");
        else if (kind === "url") {
          const resp = await fetch(b.url, { headers: { "User-Agent": "Mozilla/5.0 PrismOS" } });
          text = stripHtml(await resp.text());
        } else if (kind === "file") {
          const { data: file, error: dlErr } = await sb.storage.from("knowledge").download(b.storage_path);
          if (dlErr || !file) throw new Error("Could not download file");
          const buf = new Uint8Array(await file.arrayBuffer());
          const mt = b.mime_type || "";
          if (mt.startsWith("audio/") || mt.startsWith("video/")) {
            text = await transcribeAudio(buf);
          } else {
            let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
            const b64 = btoa(bin);
            const isPdf = mt.includes("pdf");
            const isImg = mt.startsWith("image/");
            if (isPdf || isImg) text = await claudeExtract(sb, uid, b64, mt || "image/png", isPdf);
            else throw new Error("Unsupported file type for now: " + mt);
          }
        }
        text = (text || "").trim();
        if (!text) throw new Error("No text could be extracted");

        const chunks = chunkText(text);
        const embeddings = await voyageEmbed(chunks, "document");
        const rows = chunks.map((content, i) => ({
          source_id: src.id, user_id: uid, scope, team_id, chunk_index: i, content,
          token_count: Math.ceil(content.length / 4), embedding: "[" + embeddings[i].join(",") + "]",
        }));
        for (let i = 0; i < rows.length; i += 100) await sb.from("knowledge_chunks").insert(rows.slice(i, i + 100));

        const { summary, tags, facts, entities } = await claudeEnrich(sb, uid, text);
        const mergedTags = Array.from(new Set([...(Array.isArray(b.tags) ? b.tags : []), ...tags]));

        // Structured facts
        if (Array.isArray(facts) && facts.length) {
          const factRows = facts.slice(0, 40).map((fx: any) => ({
            source_id: src.id, user_id: uid, scope, team_id,
            fact_type: ["date", "amount", "party", "deadline", "address", "term"].includes(fx.type) ? fx.type : "other",
            fact_key: String(fx.key || "").slice(0, 200), value_text: fx.value_text != null ? String(fx.value_text).slice(0, 1000) : null,
            value_date: (typeof fx.value_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fx.value_date)) ? fx.value_date : null,
            value_number: (typeof fx.value_number === "number") ? fx.value_number : null, confidence: 0.8,
          }));
          try { await sb.from("knowledge_facts").insert(factRows); } catch (_) {}
          // Conflict detection: same fact key, different value, from another source
          try {
            for (const fx of facts.slice(0, 40)) {
              const fk = String(fx.key || "").trim(); if (!fk) continue;
              const newVal = fx.value_date || (fx.value_number != null ? String(fx.value_number) : (fx.value_text || ""));
              if (!newVal) continue;
              const { data: existing } = await sb.from("knowledge_facts").select("value_text, value_date, value_number, source_id").eq("user_id", uid).ilike("fact_key", fk).neq("source_id", src.id).limit(3);
              for (const ex of (existing || [])) {
                const oldVal = ex.value_date || (ex.value_number != null ? String(ex.value_number) : (ex.value_text || ""));
                if (oldVal && String(oldVal).toLowerCase() !== String(newVal).toLowerCase()) {
                  await sb.from("knowledge_conflicts").insert({ user_id: uid, fact_key: fk, new_source_id: src.id, new_value: String(fx.value_text ?? newVal), old_source_id: ex.source_id, old_value: String(ex.value_text ?? oldVal) });
                  break;
                }
              }
            }
          } catch (_) {}
        }
        // Entity links (suggested, unconfirmed) — match against the user's own records
        if (Array.isArray(entities)) {
          for (const ent of entities.slice(0, 15)) {
            const safe = String(ent?.name || "").split(",")[0].replace(/[%()]/g, " ").trim();
            if (safe.length < 3) continue;
            let tid: string | null = null, ttype: string | null = null;
            try {
              if (ent.type === "property") { const { data } = await sb.from("properties").select("id").eq("user_id", uid).ilike("address", `%${safe}%`).limit(1); if (data?.[0]) { tid = data[0].id; ttype = "property"; } }
              else if (ent.type === "deal") { const { data } = await sb.from("deals").select("id").eq("user_id", uid).ilike("name", `%${safe}%`).limit(1); if (data?.[0]) { tid = data[0].id; ttype = "deal"; } }
              else { const { data } = await sb.from("contacts").select("id").eq("user_id", uid).ilike("name", `%${safe}%`).limit(1); if (data?.[0]) { tid = data[0].id; ttype = "contact"; } }
            } catch (_) {}
            if (tid && ttype) { try { await sb.from("knowledge_links").insert({ source_id: src.id, user_id: uid, target_type: ttype, target_id: tid, confidence: 0.7, confirmed: false }); } catch (_) {} }
          }
        }
        const enc = new TextEncoder().encode(text);
        const hashBuf = await crypto.subtle.digest("SHA-256", enc);
        const hash = Array.from(new Uint8Array(hashBuf)).map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 32);

        await sb.from("knowledge_sources").update({
          status: "ready", extracted_text: text.slice(0, 500000), summary, tags: mergedTags,
          content_hash: hash, processed_at: new Date().toISOString(),
        }).eq("id", src.id);
      } catch (e) {
        await sb.from("knowledge_sources").update({ status: "error", error: String(e).slice(0, 400) }).eq("id", src.id);
      }
    };
    // @ts-ignore EdgeRuntime background task
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(process());
    else process();

    return J({ ok: true, source_id: src.id, status: "processing" }, 202);
  } catch (e) { return J({ error: String(e) }, 500); }
});
