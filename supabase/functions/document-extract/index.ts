// document-extract — extracts text from an uploaded document, summarizes and
// classifies it, and generates a search embedding. Routing:
//   txt/md        -> decode directly
//   docx          -> unzip + pull text from word/document.xml
//   pdf (any)     -> Claude vision/document (OCR for scans)
//   image (scan)  -> Claude vision (OCR)
// POST { document_id }  (auth: user JWT)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encodeBase64 } from "https://deno.land/std@0.208.0/encoding/base64.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI = Deno.env.get("OPENAI_API_KEY") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function claudeMedia(base64: string, mediaType: string, isPdf: boolean): Promise<string> {
  const content: any = isPdf
    ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } },
       { type: "text", text: "Transcribe ALL text in this document verbatim, in reading order, preserving structure (headings, lists, and tables as best you can). Output only the transcribed text — no preamble." }]
    : [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
       { type: "text", text: "Transcribe ALL text visible in this image verbatim, preserving structure. Output only the transcribed text — no preamble." }];
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "anthropic-beta": "pdfs-2024-09-25", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 8000, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(`Claude OCR error ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const d = await r.json();
  return (d.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
}

async function claudeSummarize(text: string): Promise<{ summary: string; doc_type: string; signed_state: string; action_needed: boolean; action_label: string }> {
  const fb = { summary: "", doc_type: "other", signed_state: "na", action_needed: false, action_label: "" };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 500, messages: [{ role: "user", content: `Document text:\n"""${text.slice(0, 14000)}"""\n\nReturn STRICT JSON only:\n{ "summary": "2-3 sentence summary of what this document is and its key points",\n  "doc_type": "one of: contract, disclosure, lease, agreement, id, invoice, statement, letter, report, flyer, note, other",\n  "signed_state": "signed | unsigned | na",\n  "action_needed": true or false,\n  "action_label": "a short imperative next step for the agent, or empty" }\nGuidance: signed_state='na' for non-signable docs (notes, flyers, statements, IDs). Set action_needed=true mainly when a contract/disclosure/lease/agreement appears UNSIGNED, or the document clearly implies a follow-up; otherwise false. Keep action_label short, specific, imperative (e.g. "Send the disclosure for signature").` }] }),
    });
    const d = await r.json(); const t = (d.content || []).map((c: any) => c.text || "").join("");
    const p = JSON.parse(t.match(/\{[\s\S]*\}/)[0]);
    return { summary: p.summary || "", doc_type: p.doc_type || "other", signed_state: p.signed_state || "na", action_needed: !!p.action_needed, action_label: p.action_label || "" };
  } catch (_) { return fb; }
}

async function embed(text: string): Promise<string | null> {
  if (!OPENAI || !text.trim()) return null;
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${OPENAI}`, "content-type": "application/json" }, body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }) });
    const d = await r.json(); const v = d?.data?.[0]?.embedding;
    return Array.isArray(v) ? `[${v.join(",")}]` : null;
  } catch (_) { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let docId: string | null = null;
  const admin = createClient(SUPABASE_URL, SERVICE);
  try {
    const body = await req.json(); docId = body.document_id;
    if (!docId) throw new Error("document_id required");
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return J({ error: "Unauthorized" }, 401);

    const { data: doc } = await admin.from("documents").select("*").eq("id", docId).eq("user_id", user.id).maybeSingle();
    if (!doc || !doc.storage_path) throw new Error("Document not found");
    await admin.from("documents").update({ status: "extracting", extraction_error: null }).eq("id", docId);

    const { data: file, error: dlErr } = await admin.storage.from("documents").download(doc.storage_path);
    if (dlErr || !file) throw new Error(`Download failed: ${dlErr?.message || "unknown"}`);
    const buf = new Uint8Array(await file.arrayBuffer());
    const mime = (doc.mime_type || "").toLowerCase();
    const name = (doc.storage_path || "").toLowerCase();

    let text = "";
    if (mime.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md") || name.endsWith(".csv")) {
      text = new TextDecoder().decode(buf);
    } else if (mime.includes("wordprocessingml") || name.endsWith(".docx")) {
      const zip = await JSZip.loadAsync(buf);
      const xml = await zip.file("word/document.xml")?.async("string") || "";
      text = xml.replace(/<w:p[ >]/g, "\n<w:p ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    } else if (mime === "application/pdf" || name.endsWith(".pdf")) {
      if (buf.byteLength > 30 * 1024 * 1024) throw new Error("PDF over 30MB — please split it (multi-hundred-page scans exceed the OCR limit).");
      text = await claudeMedia(encodeBase64(buf), "application/pdf", true);
    } else if (mime.startsWith("image/") || /\.(jpe?g|png|webp|gif)$/.test(name)) {
      if (buf.byteLength > 5 * 1024 * 1024) throw new Error("Image over 5MB — please downscale the scan.");
      const mt = mime.startsWith("image/") ? mime : "image/jpeg";
      text = await claudeMedia(encodeBase64(buf), mt, false);
    } else {
      throw new Error(`Unsupported type: ${mime || name}`);
    }

    text = (text || "").trim();
    const meta = text ? await claudeSummarize(text) : { summary: "", doc_type: "other", signed_state: "na", action_needed: false, action_label: "" };
    const embedding = await embed(`${doc.title || ""}\n${meta.summary}\n${text}`);

    await admin.from("documents").update({
      extracted_text: text, summary: meta.summary, doc_type: meta.doc_type,
      signed_state: meta.signed_state, action_needed: meta.action_needed, action_label: meta.action_label,
      embedding, status: "ready", extraction_error: null, updated_at: new Date().toISOString(),
    }).eq("id", docId);

    // Timeline: a note on each linked contact so the document shows in their history.
    try {
      const { data: links } = await admin.from("document_contacts").select("contact_id").eq("document_id", docId);
      for (const l of (links || [])) {
        await admin.from("contact_interactions").insert({
          user_id: user.id, contact_id: l.contact_id, channel: "document", kind: "note",
          occurred_at: new Date().toISOString(),
          brief: `\uD83D\uDCCE Document: ${doc.title || "file"}${meta.doc_type && meta.doc_type !== "other" ? " (" + meta.doc_type + ")" : ""}`,
          body: meta.summary || "", entity_type: "document", entity_id: docId,
        });
      }
    } catch (_) { /* timeline is best-effort */ }

    return J({ ok: true, chars: text.length, doc_type: meta.doc_type, action_needed: meta.action_needed, embedded: !!embedding });
  } catch (e) {
    if (docId) { try { await admin.from("documents").update({ status: "error", extraction_error: String(e).slice(0, 600) }).eq("id", docId); } catch (_) {} }
    return J({ error: String(e) }, 500);
  }
});
