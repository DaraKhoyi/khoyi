import "../_shared/aiGuard.ts";   // no SSN, tax ID, card or bank number reaches an AI model (30 Sep)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { unzipSync, strFromU8 } from "https://esm.sh/fflate@0.8.2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { isServiceCaller } from "../_shared/serviceCaller.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MODEL = "claude-sonnet-4-6";

async function aesKey() { const s = Deno.env.get("AI_KEY_ENC_SECRET") || ""; const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return crypto.subtle.importKey("raw", h, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]); }
async function decryptKey(st: string) { try { const [a, b] = st.split(":"); const iv = Uint8Array.from(atob(a), c => c.charCodeAt(0)); const ct = Uint8Array.from(atob(b), c => c.charCodeAt(0)); const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), ct); return new TextDecoder().decode(pt); } catch (_) { return null; } }
async function resolveKey(sb: any, uid: string | null, pk: string) { if (uid) { const { data } = await sb.from("user_ai_keys").select("key_ciphertext, status").eq("user_id", uid).maybeSingle(); if (data?.status === "active" && data.key_ciphertext) { const k = await decryptKey(data.key_ciphertext); if (k) return { key: k, usedOwn: true }; } } return { key: pk, usedOwn: false }; }
const AI_RATES: Record<string, number[]> = { "claude-opus-4-8": [5, 25], "claude-sonnet-4-6": [3, 15], "claude-haiku-4-5": [1, 5] };
async function logUsage(sb: any, o: any) { try { const inT = o.usage?.input_tokens || 0, outT = o.usage?.output_tokens || 0; const [ri, ro] = AI_RATES[o.model] || [3, 15]; await sb.from("ai_usage_log").insert({ user_id: o.userId, fn: o.fn, model: o.model, input_tokens: inT, output_tokens: outT, web_searches: 0, cost_usd: (inT / 1e6) * ri + (outT / 1e6) * ro, used_own_key: !!o.usedOwn }); } catch (_) {} }

async function voyageEmbed(texts: string[]): Promise<number[][]> {
  // Paced and patient (30 Sep): a 72-minute transcript is ~70 chunks, and the
  // embedding account answers 429 when sent more than its per-minute budget —
  // which silently left Ricky Caruth's talk "processing" forever. Batches are
  // sized to a token budget (≈4 characters a token), and on 429 we wait (its
  // Retry-After, else 25s) and try again. The service's own words go into any
  // final error, so "why" is never a guess.
  const key = Deno.env.get("VOYAGE_API_KEY"); const out: number[][] = [];
  const BUDGET = 7000;
  const batches: string[][] = []; let cur: string[] = [], tok = 0;
  for (const t of texts) { const n = Math.ceil(t.length / 4); if (cur.length && (tok + n > BUDGET || cur.length >= 64)) { batches.push(cur); cur = []; tok = 0; } cur.push(t); tok += n; }
  if (cur.length) batches.push(cur);
  for (const batch of batches) {
    let j: any = null, last = "";
    for (let attempt = 0; attempt < 10; attempt++) {
      const r = await fetch("https://api.voyageai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ input: batch, model: "voyage-3.5", input_type: "document", output_dimension: 1024 }) });
      if (r.ok) { j = await r.json(); break; }
      last = `${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`;
      if (r.status !== 429 && r.status < 500) throw new Error("Voyage embed failed: " + last);
      await new Promise((res) => setTimeout(res, Math.min(60, Number(r.headers.get("retry-after")) || 25) * 1000));
    }
    if (!j) throw new Error("Voyage embed failed after retries: " + last);
    for (const d of j.data) out.push(d.embedding);
  }
  return out;
}
async function claudeExtract(sb: any, uid: string | null, b64: string, mediaType: string, isPdf: boolean): Promise<string> {
  const { key, usedOwn } = await resolveKey(sb, uid, Deno.env.get("ANTHROPIC_API_KEY")!);
  const block = isPdf ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } } : { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } };
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content: [block, { type: "text", text: "Transcribe ALL text in this document verbatim. Then, if it's an image/scan, add a short factual description of any non-text content. Output plain text only." }] }] }) });
  const j = await r.json(); logUsage(sb, { userId: uid, fn: "knowledge-extract", model: MODEL, usage: j.usage, usedOwn });
  return (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
}
async function claudeEnrich(sb: any, uid: string | null, text: string): Promise<{ summary: string; tags: string[]; facts: any[]; entities: any[] }> {
  const { key, usedOwn } = await resolveKey(sb, uid, Deno.env.get("ANTHROPIC_API_KEY")!);
  const prompt = `Analyze the text and reply ONLY as JSON (no preamble):
{"summary":"1-2 sentence summary","tags":["3-6 short lowercase topic tags"],"facts":[{"type":"date|amount|party|deadline|address|term","key":"short label","value_text":"the value as written","value_date":"YYYY-MM-DD or null","value_number":<number or null>}],"entities":[{"type":"contact|property|deal","name":"person name, property address, or deal name exactly as written"}]}
Extract only REAL, explicit facts and named entities. Use null when a value doesn't apply.

TEXT:
${text.slice(0, 14000)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }) });
  const j = await r.json(); logUsage(sb, { userId: uid, fn: "knowledge-enrich", model: MODEL, usage: j.usage, usedOwn });
  const raw = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  try { const m = raw.match(/\{[\s\S]*\}/); const p = JSON.parse(m ? m[0] : raw); return { summary: p.summary || "", tags: Array.isArray(p.tags) ? p.tags.slice(0, 6) : [], facts: Array.isArray(p.facts) ? p.facts : [], entities: Array.isArray(p.entities) ? p.entities : [] }; } catch (_) { return { summary: "", tags: [], facts: [], entities: [] }; }
}
async function transcribeAudio(bytes: Uint8Array): Promise<string> {
  const key = Deno.env.get("ASSEMBLYAI_API_KEY"); if (!key) throw new Error("Audio transcription isn't configured");
  const up = await fetch("https://api.assemblyai.com/v2/upload", { method: "POST", headers: { authorization: key }, body: bytes }); if (!up.ok) throw new Error("Audio upload failed: " + up.status);
  const upUrl = (await up.json()).upload_url;
  const sub = await fetch("https://api.assemblyai.com/v2/transcript", { method: "POST", headers: { authorization: key, "Content-Type": "application/json" }, body: JSON.stringify({ audio_url: upUrl, speaker_labels: true }) });
  const tid = (await sub.json()).id; if (!tid) throw new Error("Could not start transcription");
  for (let i = 0; i < 38; i++) { await new Promise(r => setTimeout(r, 3000)); const tr = await fetch(`https://api.assemblyai.com/v2/transcript/${tid}`, { headers: { authorization: key } }); const t = await tr.json(); if (t.status === "completed") { if (Array.isArray(t.utterances) && t.utterances.length) return t.utterances.map((u: any) => `Speaker ${u.speaker}: ${u.text}`).join("\n"); return t.text || ""; } if (t.status === "error") throw new Error("Transcription failed: " + (t.error || "")); }
  throw new Error("Transcription is taking too long — try a shorter clip.");
}
function stripHtml(html: string): string { return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim(); }
function extractDocx(bytes: Uint8Array): string {
  try { const files = unzipSync(bytes); const doc = files["word/document.xml"]; if (!doc) return ""; let xml = strFromU8(doc); xml = xml.replace(/<\/w:p>/g, "\n").replace(/<w:tab\/>/g, "\t"); const t = xml.replace(/<[^>]+>/g, ""); return t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, "\n\n").trim(); } catch (_) { return ""; }
}
function extractXlsx(bytes: Uint8Array): string {
  try { const wb = XLSX.read(bytes, { type: "array" }); let out = ""; for (const name of wb.SheetNames) { const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]); if (csv.trim()) out += `Sheet: ${name}\n${csv}\n\n`; } return out.trim(); } catch (_) { return ""; }
}
function chunkText(text: string): string[] {
  const MAX = 2400, OV = 300; const paras = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean); const chunks: string[] = []; let cur = "";
  for (const p of paras) { if ((cur + "\n\n" + p).length > MAX && cur) { chunks.push(cur); cur = cur.slice(Math.max(0, cur.length - OV)) + "\n\n" + p; } else { cur = cur ? cur + "\n\n" + p : p; } while (cur.length > MAX * 1.5) { chunks.push(cur.slice(0, MAX)); cur = cur.slice(MAX - OV); } }
  if (cur.trim()) chunks.push(cur.trim()); return chunks.length ? chunks : (text.trim() ? [text.trim()] : []);
}

// Shared: chunk -> embed -> store -> enrich -> facts -> conflicts -> links -> ready
async function indexText(sb: any, uid: string, src: any, scope: string, team_id: string | null, userTags: any, text: string) {
  const chunks = chunkText(text);
  const embeddings = await voyageEmbed(chunks);
  const rows = chunks.map((content, i) => ({ source_id: src.id, user_id: uid, scope, team_id, chunk_index: i, content, token_count: Math.ceil(content.length / 4), embedding: "[" + embeddings[i].join(",") + "]" }));
  for (let i = 0; i < rows.length; i += 100) await sb.from("knowledge_chunks").insert(rows.slice(i, i + 100));
  const { summary, tags, facts, entities } = await claudeEnrich(sb, uid, text);
  const mergedTags = Array.from(new Set([...(Array.isArray(userTags) ? userTags : []), ...tags]));
  if (Array.isArray(facts) && facts.length) {
    const fr = facts.slice(0, 40).map((fx: any) => ({ source_id: src.id, user_id: uid, scope, team_id, fact_type: ["date", "amount", "party", "deadline", "address", "term"].includes(fx.type) ? fx.type : "other", fact_key: String(fx.key || "").slice(0, 200), value_text: fx.value_text != null ? String(fx.value_text).slice(0, 1000) : null, value_date: (typeof fx.value_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(fx.value_date)) ? fx.value_date : null, value_number: (typeof fx.value_number === "number") ? fx.value_number : null, confidence: 0.8 }));
    try { await sb.from("knowledge_facts").insert(fr); } catch (_) {}
    try { for (const fx of facts.slice(0, 40)) { const fk = String(fx.key || "").trim(); if (!fk) continue; const nv = fx.value_date || (fx.value_number != null ? String(fx.value_number) : (fx.value_text || "")); if (!nv) continue; const { data: ex } = await sb.from("knowledge_facts").select("value_text, value_date, value_number, source_id").eq("user_id", uid).ilike("fact_key", fk).neq("source_id", src.id).limit(3); for (const e of (ex || [])) { const ov = e.value_date || (e.value_number != null ? String(e.value_number) : (e.value_text || "")); if (ov && String(ov).toLowerCase() !== String(nv).toLowerCase()) { await sb.from("knowledge_conflicts").insert({ user_id: uid, fact_key: fk, new_source_id: src.id, new_value: String(fx.value_text ?? nv), old_source_id: e.source_id, old_value: String(e.value_text ?? ov) }); break; } } } } catch (_) {}
  }
  if (Array.isArray(entities)) {
    for (const ent of entities.slice(0, 15)) { const safe = String(ent?.name || "").split(",")[0].replace(/[%()]/g, " ").trim(); if (safe.length < 3) continue; let tid: string | null = null, tt: string | null = null;
      try { if (ent.type === "property") { const { data } = await sb.from("properties").select("id").eq("user_id", uid).ilike("address", `%${safe}%`).limit(1); if (data?.[0]) { tid = data[0].id; tt = "property"; } } else if (ent.type === "deal") { const { data } = await sb.from("deals").select("id").eq("user_id", uid).ilike("name", `%${safe}%`).limit(1); if (data?.[0]) { tid = data[0].id; tt = "deal"; } } else { const { data } = await sb.from("contacts").select("id").eq("user_id", uid).ilike("name", `%${safe}%`).limit(1); if (data?.[0]) { tid = data[0].id; tt = "contact"; } } } catch (_) {}
      if (tid && tt) { try { await sb.from("knowledge_links").insert({ source_id: src.id, user_id: uid, target_type: tt, target_id: tid, confidence: 0.7, confirmed: false }); } catch (_) {} }
    }
  }
  const hb = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  const hash = Array.from(new Uint8Array(hb)).map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 32);
  await sb.from("knowledge_sources").update({ status: "ready", extracted_text: text.slice(0, 500000), summary, tags: mergedTags, content_hash: hash, processed_at: new Date().toISOString() }).eq("id", src.id);
}

// LONG RECORDINGS (30 Sep). A talk or a training runs an hour; transcription
// takes minutes, longer than one request may wait — so anything past a short
// clip is handed to the service with a signed link and collected by the
// 2-minute poll (knowledge-transcribe-poll), speakers and timestamps kept.
// Short dictations still come back at once.
const LONG_AUDIO_BYTES = 6 * 1024 * 1024;
export class Deferred extends Error { constructor() { super("transcription started — collected by the poll"); } }
async function startTranscription(sb: any, src: any, storage_path: string) {
  const key = Deno.env.get("ASSEMBLYAI_API_KEY"); if (!key) throw new Error("Audio transcription isn't configured");
  const { data: signed, error } = await sb.storage.from("knowledge").createSignedUrl(storage_path, 60 * 60 * 24);
  if (error || !signed?.signedUrl) throw new Error("Could not share the audio with the transcriber");
  const r = await fetch("https://api.assemblyai.com/v2/transcript", { method: "POST", headers: { authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ audio_url: signed.signedUrl, speaker_labels: true, punctuate: true, format_text: true }) });
  const j = await r.json(); if (!j.id) throw new Error("Could not start transcription: " + (j.error || r.status));
  await sb.from("knowledge_sources").update({ status: "processing", transcript_job: j.id, error: null }).eq("id", src.id);
}
const mmss = (ms: number) => { const t = Math.floor((ms || 0) / 1000); const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60; return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0"); };
export function formatTranscript(utt: any[], names: Record<string, string> | null): string {
  // The speaker is named when it changes, not on every paragraph.
  let prev = "";
  return utt.map((u) => {
    const who = (names && names[u.speaker]) || "Speaker " + u.speaker;
    const head = who !== prev ? `${who}\n` : "";
    prev = who;
    return `${head}[${mmss(u.start_ms)}] ${u.text}`;
  }).join("\n\n");
}
async function pollTranscripts(sb: any) {
  const key = Deno.env.get("ASSEMBLYAI_API_KEY"); if (!key) return { error: "not configured" };
  const { data: jobs } = await sb.from("knowledge_sources").select("*").not("transcript_job", "is", null).eq("status", "processing").limit(10);
  const out: any[] = [];
  for (const src of jobs || []) {
    try {
      const t = await (await fetch(`https://api.assemblyai.com/v2/transcript/${src.transcript_job}`, { headers: { authorization: key } })).json();
      if (t.status === "completed") {
        // PARAGRAPHS, not turns. A talk is one speaker for an hour: "utterances"
        // came back as ONE 63,000-character block (30 Sep, Ricky Caruth). The
        // paragraph view gives readable blocks with their own start times; each
        // takes the speaker most of its words carry.
        let utt: any[] = [];
        try {
          const pr = await (await fetch(`https://api.assemblyai.com/v2/transcript/${src.transcript_job}/paragraphs`, { headers: { authorization: key } })).json();
          utt = (pr.paragraphs || []).map((p: any) => {
            const tally: Record<string, number> = {};
            for (const w of p.words || []) if (w.speaker) tally[w.speaker] = (tally[w.speaker] || 0) + 1;
            const sp = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || "A";
            return { start_ms: p.start, end_ms: p.end, speaker: sp, text: p.text };
          });
        } catch (_) { /* fall back to turns below */ }
        if (!utt.length) utt = (Array.isArray(t.utterances) && t.utterances.length ? t.utterances : [{ start: 0, end: (t.audio_duration || 0) * 1000, speaker: "A", text: t.text || "" }])
          .map((u: any) => ({ start_ms: u.start, end_ms: u.end, speaker: u.speaker, text: u.text }));
        const text = formatTranscript(utt, src.speaker_names);
        await sb.from("knowledge_sources").update({ transcript: utt, duration_s: t.audio_duration || null, transcript_job: null }).eq("id", src.id);
        // Re-collecting must not index twice.
        await sb.from("knowledge_chunks").delete().eq("source_id", src.id);
        await sb.from("knowledge_facts").delete().eq("source_id", src.id);
        try { await indexText(sb, src.user_id, src, src.scope, src.team_id, src.tags, text); }
        catch (e) {
          // The transcript is safe; only the search index failed. Say so, and let
          // Reprocess finish it from the saved transcript (no re-transcription).
          await sb.from("knowledge_sources").update({ status: "error", extracted_text: text.slice(0, 500000), error: "Transcribed, but indexing failed (" + String(e).slice(0, 120) + ") — tap Reprocess." }).eq("id", src.id);
          throw e;
        }
        out.push({ id: src.id, done: true, utterances: utt.length });
      } else if (t.status === "error") {
        await sb.from("knowledge_sources").update({ status: "error", error: "Transcription failed: " + String(t.error || "").slice(0, 300), transcript_job: null }).eq("id", src.id);
        out.push({ id: src.id, error: t.error });
      } else out.push({ id: src.id, status: t.status });
    } catch (e) { out.push({ id: src.id, error: String(e).slice(0, 200) }); }
  }
  return { checked: (jobs || []).length, results: out };
}

async function deriveTextFromFile(sb: any, uid: string, storage_path: string, mime: string, filename: string, src: any = null): Promise<string> {
  const { data: file, error } = await sb.storage.from("knowledge").download(storage_path); if (error || !file) throw new Error("Could not download file");
  const buf = new Uint8Array(await file.arrayBuffer()); const mt = mime || ""; const fn = (filename || "").toLowerCase();
  if (mt.startsWith("audio/") || mt.startsWith("video/")) {
    if (src && buf.length > LONG_AUDIO_BYTES) { await startTranscription(sb, src, storage_path); throw new Deferred(); }
    return await transcribeAudio(buf);
  }
  if (mt.includes("wordprocessingml") || fn.endsWith(".docx")) return extractDocx(buf);
  if (mt.includes("spreadsheetml") || mt.includes("ms-excel") || fn.endsWith(".xlsx") || fn.endsWith(".xls")) return extractXlsx(buf);
  let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]); const b64 = btoa(bin);
  const isPdf = mt.includes("pdf") || fn.endsWith(".pdf"); const isImg = mt.startsWith("image/");
  if (isPdf || isImg) return await claudeExtract(sb, uid, b64, mt || "image/png", isPdf);
  throw new Error("Unsupported file type: " + mt);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const b = await req.json().catch(() => ({}));
    // The 2-minute poll collects finished long transcriptions (service only).
    if (b.poll_transcripts) {
      if (!(await isServiceCaller(req))) return J({ error: "Forbidden" }, 403);
      return J({ ok: true, ...(await pollTranscripts(sb)) });
    }
    // The server may file on someone's behalf (as_user) — never a browser.
    let uid: string;
    if (b.as_user && (await isServiceCaller(req))) uid = String(b.as_user);
    else {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      const { data: { user } } = await sb.auth.getUser(token); if (!user) return J({ error: "Unauthorized" }, 401);
      uid = user.id;
    }

    // REPROCESS in place
    if (b.reprocess && b.source_id) {
      const { data: src } = await sb.from("knowledge_sources").select("*").eq("id", b.source_id).maybeSingle();
      if (!src) return J({ error: "Source not found" }, 404);
      if (src.user_id !== uid) { const { data: ag } = await sb.from("agents").select("role").eq("auth_user_id", uid).maybeSingle(); if (!["owner", "broker_admin"].includes(ag?.role || "")) return J({ error: "Forbidden" }, 403); }
      await sb.from("knowledge_sources").update({ status: "processing", error: null }).eq("id", src.id);
      await sb.from("knowledge_chunks").delete().eq("source_id", src.id);
      await sb.from("knowledge_facts").delete().eq("source_id", src.id);
      try { await sb.from("knowledge_conflicts").delete().or(`new_source_id.eq.${src.id},old_source_id.eq.${src.id}`); } catch (_) {}
      await sb.from("knowledge_links").delete().eq("source_id", src.id).eq("confirmed", false);
      const run = async () => {
        try {
          let text = src.extracted_text || (Array.isArray(src.transcript) && src.transcript.length ? formatTranscript(src.transcript, src.speaker_names) : "");
          if (!text) { if (src.original_path) text = await deriveTextFromFile(sb, src.user_id, src.original_path, src.mime_type, src.title, src); else if (src.source_url && src.source_url.startsWith("http")) { const r = await fetch(src.source_url); text = stripHtml(await r.text()); } }
          text = (text || "").trim(); if (!text) throw new Error("Nothing to reprocess");
          await indexText(sb, src.user_id, src, src.scope, src.team_id, src.tags, text);
        } catch (e) { if (!(e instanceof Deferred)) await sb.from("knowledge_sources").update({ status: "error", error: String(e).slice(0, 400) }).eq("id", src.id); }
      };
      // @ts-ignore
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(run()); else await run();
      return J({ ok: true, source_id: src.id, status: "processing" }, 202);
    }

    // NORMAL INGEST
    const scope = ["private", "team", "brokerage"].includes(b.scope) ? b.scope : "private";
    // The whole-brokerage library is what Prism answers every agent from:
    // publishing to it is for the broker and admins (the screen already hid the
    // option; the server did not enforce it until 30 Sep).
    if (scope === "brokerage") {
      const { data: ag } = await sb.from("agents").select("role").eq("auth_user_id", uid).maybeSingle();
      if (!["owner", "broker_admin"].includes(ag?.role || "")) return J({ error: "Only the broker or an admin can share with the whole brokerage." }, 403);
    }
    const team_id = scope === "team" ? (b.team_id || null) : null;
    const trust = ["authoritative", "standard", "draft"].includes(b.trust_level) ? b.trust_level : "standard";
    const kind = b.kind; const fn = (b.filename || "").toLowerCase();
    const srcType = kind === "url" ? "url" : kind === "text" ? "text" : (
      (b.mime_type?.includes("pdf") || fn.endsWith(".pdf")) ? "pdf" : b.mime_type?.startsWith("image/") ? "image" :
      (b.mime_type?.startsWith("audio/") || b.mime_type?.startsWith("video/")) ? "audio" :
      (b.mime_type?.includes("wordprocessingml") || fn.endsWith(".docx")) ? "docx" :
      (b.mime_type?.includes("spreadsheetml") || b.mime_type?.includes("ms-excel") || fn.endsWith(".xlsx") || fn.endsWith(".xls")) ? "spreadsheet" : "other");
    const { data: src, error: srcErr } = await sb.from("knowledge_sources").insert({ user_id: uid, scope, team_id, title: b.title || b.filename || b.url || "Untitled", source_type: srcType, original_path: b.storage_path || null, source_url: b.url || null, mime_type: b.mime_type || null, trust_level: trust, tags: Array.isArray(b.tags) ? b.tags : [], project: b.project || null, status: "processing" }).select("*").single();
    if (srcErr || !src) return J({ error: "Could not create source: " + (srcErr?.message || "") }, 500);
    const process = async () => {
      try {
        let text = "";
        if (kind === "text") text = String(b.text || "");
        else if (kind === "url") { const r = await fetch(b.url, { headers: { "User-Agent": "Mozilla/5.0 PrismOS" } }); text = stripHtml(await r.text()); }
        else if (kind === "file") text = await deriveTextFromFile(sb, uid, b.storage_path, b.mime_type, b.filename, src);
        text = (text || "").trim(); if (!text) throw new Error("No text could be extracted");
        await indexText(sb, uid, src, scope, team_id, b.tags, text);
      } catch (e) { if (!(e instanceof Deferred)) await sb.from("knowledge_sources").update({ status: "error", error: String(e).slice(0, 400) }).eq("id", src.id); }
    };
    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(process()); else process();
    return J({ ok: true, source_id: src.id, status: "processing" }, 202);
  } catch (e) { return J({ error: String(e) }, 500); }
});
