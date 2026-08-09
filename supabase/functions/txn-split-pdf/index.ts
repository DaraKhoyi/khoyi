// txn-split-pdf — one emailed PDF often holds several documents end-to-end (contract,
// addenda, disclosures, inspection…). This finds the seams and cuts the bundle into one
// file per document, routes each to its milestone by type, and links them to the deal.
//
// Two modes, so nothing commits until the human confirms:
//   mode:'detect' -> Claude reads the whole PDF and returns proposed segments
//                    [{title,type,start_page,end_page,confidence}], plus page_count.
//   mode:'apply'  -> given (possibly user-adjusted) segments, pdf-lib copies each page
//                    range into a new PDF, uploads it, creates a documents row + link,
//                    and returns the new pieces with a suggested milestone per type.
//
// POST { transaction_id, document_id, mode, segments? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { logAiUsage } from "../_shared/aiUsage.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "claude-sonnet-4-6";

const TYPE_TO_MILESTONE: Record<string, string> = {
  purchase_contract: "executed_contract",
  earnest_money_receipt: "deposit_made",
  inspection_report: "inspection",
  appraisal_report: "appraisal",
  title_commitment: "title_clear",
  clear_to_close: "clear_to_close",
  closing_disclosure: "closing_disclosure",
  commission_disbursement: "cda",
  final_walkthrough: "final_walkthrough",
};

const DETECT_PROMPT = (pageCount: number) => `This PDF contains ${pageCount} pages and may hold SEVERAL separate real-estate documents placed end-to-end (e.g. a purchase contract, then addenda, then a disclosure, then an inspection report). Identify each distinct document. Use form headers, form numbers, "Page 1 of N" resets, and title blocks to find where one document ends and the next begins.

Return ONLY JSON, no prose:
{ "documents": [ { "title": "short human name", "type": one of ["purchase_contract","earnest_money_receipt","inspection_report","appraisal_report","title_commitment","clear_to_close","closing_disclosure","commission_disbursement","final_walkthrough","addendum","disclosure","other"], "start_page": 1-indexed first page, "end_page": 1-indexed last page, "confidence": "high"|"medium"|"low" } ] }

Rules: pages are 1-indexed. Ranges must be contiguous and cover the document fully. If the whole PDF is a single document, return one entry spanning all pages. Do not overlap ranges.`;

async function loadBytes(admin: any, document_id: string) {
  const { data: doc } = await admin.from("documents").select("id, storage_path, mime_type, user_id, title").eq("id", document_id).maybeSingle();
  if (!doc?.storage_path) return { error: "Document not found." };
  const { data: blob, error } = await admin.storage.from("documents").download(doc.storage_path);
  if (error || !blob) return { error: "Could not read the document file." };
  return { doc, bytes: new Uint8Array(await blob.arrayBuffer()) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    const { data: u } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    const uid = u?.user?.id;
    const body = await req.json();
    const { transaction_id, document_id, mode } = body;
    if (!transaction_id || !document_id) return new Response(JSON.stringify({ error: "transaction_id and document_id required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: canEdit } = await admin.rpc("txn_can_edit", { p_id: transaction_id });
    if (uid && canEdit === false) return new Response(JSON.stringify({ error: "Not permitted." }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

    const loaded = await loadBytes(admin, document_id);
    if ((loaded as any).error) return new Response(JSON.stringify({ error: (loaded as any).error }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    const { doc, bytes } = loaded as any;
    if ((doc.mime_type || "") !== "application/pdf") return new Response(JSON.stringify({ error: "Only PDFs can be split." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

    // page count up front (also validates the PDF is readable by pdf-lib)
    let srcPdf: any, pageCount = 0;
    try { srcPdf = await PDFDocument.load(bytes, { ignoreEncryption: false }); pageCount = srcPdf.getPageCount(); }
    catch { return new Response(JSON.stringify({ error: "This PDF is locked or malformed — pdf-lib can't open it. Try re-saving or printing to a fresh PDF." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } }); }

    // ── DETECT ──
    if (mode === "detect") {
      if (pageCount <= 1) return new Response(JSON.stringify({ ok: true, page_count: pageCount, documents: [{ title: doc.title || "Document", type: "other", start_page: 1, end_page: pageCount, confidence: "high" }], single: true }), { headers: { ...cors, "Content-Type": "application/json" } });
      let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: DETECT_PROMPT(pageCount) }] }] }),
      });
      const data = await r.json();
      try { await logAiUsage(admin, { userId: uid || doc.user_id, fn: "txn-split-pdf", model: MODEL, usage: data?.usage, usedOwn: false }); } catch (_) {}
      let text = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").replace(/```json|```/g, "").trim();
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { return new Response(JSON.stringify({ error: "Could not read the bundle cleanly." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } }); }
      // sanitize ranges to the real page count, clamp + sort
      const docs = (parsed.documents || [])
        .map((d: any) => ({ title: d.title || "Document", type: d.type || "other", start_page: Math.max(1, Math.min(pageCount, d.start_page || 1)), end_page: Math.max(1, Math.min(pageCount, d.end_page || pageCount)), confidence: d.confidence || "medium" }))
        .filter((d: any) => d.end_page >= d.start_page)
        .sort((a: any, b: any) => a.start_page - b.start_page);
      return new Response(JSON.stringify({ ok: true, page_count: pageCount, documents: docs, single: docs.length <= 1 }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    // ── APPLY ──
    if (mode === "apply") {
      const segments = (body.segments || []).filter((s: any) => s.start_page && s.end_page && s.end_page >= s.start_page);
      if (!segments.length) return new Response(JSON.stringify({ error: "No segments to split." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const pieces: any[] = [];
      for (const seg of segments) {
        const start = Math.max(1, Math.min(pageCount, seg.start_page));
        const end = Math.max(start, Math.min(pageCount, seg.end_page));
        const out = await PDFDocument.create();
        const idxs = []; for (let p = start - 1; p <= end - 1; p++) idxs.push(p);
        const copied = await out.copyPages(srcPdf, idxs);
        copied.forEach((pg: any) => out.addPage(pg));
        const outBytes = await out.save();
        const safeTitle = (seg.title || "Document").replace(/[^\w.\-]+/g, "_").slice(0, 60);
        const path = `${doc.user_id}/split/${crypto.randomUUID()}-${safeTitle}.pdf`;
        const { error: upErr } = await admin.storage.from("documents").upload(path, outBytes, { contentType: "application/pdf", upsert: false });
        if (upErr) { pieces.push({ title: seg.title, ok: false, error: upErr.message }); continue; }
        const { data: newDoc, error: docErr } = await admin.from("documents").insert({
          user_id: doc.user_id, title: `${seg.title || "Document"}.pdf`, storage_path: path,
          mime_type: "application/pdf", size_bytes: outBytes.length, status: "extracting", doc_type: seg.type || null,
        }).select("id").single();
        if (docErr) { pieces.push({ title: seg.title, ok: false, error: docErr.message }); continue; }
        await admin.from("entity_links").insert({ user_id: doc.user_id, item_type: "document", item_id: newDoc.id, target_type: "transaction", target_id: transaction_id });
        admin.functions.invoke("document-extract", { body: { document_id: newDoc.id, user_id: doc.user_id } }).catch(() => {});
        pieces.push({ ok: true, document_id: newDoc.id, title: seg.title, type: seg.type, milestone_key: TYPE_TO_MILESTONE[seg.type] || null, pages: `${start}-${end}` });
      }
      return new Response(JSON.stringify({ ok: true, pieces }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "mode must be 'detect' or 'apply'" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
