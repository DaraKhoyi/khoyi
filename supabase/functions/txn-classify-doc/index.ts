// txn-classify-doc — look at a document already filed to a transaction and say what
// kind it is, so it can be routed to the right milestone slot (Closing Disclosure ->
// closing_disclosure, inspection report -> inspection, etc). Assisted, not automatic:
// it returns a suggestion; the human confirms in the UI (money/legal docs never
// self-file). Lightweight Claude-vision classification.
//
// POST { transaction_id, document_id }
//   -> { ok, doc_type, milestone_key, milestone_label, confidence }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "claude-sonnet-4-6";

// doc_type -> the milestone its upload satisfies
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

const PROMPT = `You are classifying a single U.S. residential real-estate transaction document. Return ONLY JSON, no prose:
{ "doc_type": one of ["purchase_contract","earnest_money_receipt","inspection_report","appraisal_report","title_commitment","clear_to_close","closing_disclosure","commission_disbursement","final_walkthrough","other"], "confidence": "high"|"medium"|"low", "label": "a short human name for the document" }
Look at headers, titles, and form numbers. A "Closing Disclosure" (CD) is the standardized 5-page federal form. A "Commission Disbursement Authorization" (CDA) authorizes the title company to pay the brokerage. An inspection report describes property condition. Be precise.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    const { data: u } = await admin.auth.getUser(authHeader.replace("Bearer ", ""));
    const uid = u?.user?.id;
    const { transaction_id, document_id } = await req.json();
    if (!transaction_id || !document_id) return new Response(JSON.stringify({ error: "transaction_id and document_id required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: canEdit } = await admin.rpc("txn_can_edit", { p_id: transaction_id });
    if (uid && canEdit === false) return new Response(JSON.stringify({ error: "Not permitted." }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: doc } = await admin.from("documents").select("id, storage_path, mime_type, title, user_id").eq("id", document_id).maybeSingle();
    if (!doc?.storage_path) return new Response(JSON.stringify({ error: "Document not found." }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: blob, error: dlErr } = await admin.storage.from("documents").download(doc.storage_path);
    if (dlErr || !blob) return new Response(JSON.stringify({ error: "Could not read the document." }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = btoa(bin);
    const mime = doc.mime_type || "application/pdf";
    const block = mime === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mime, data: b64 } };

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }] }),
    });
    const data = await r.json();
    try { await logAiUsage(admin, { userId: uid || doc.user_id, fn: "txn-classify-doc", model: MODEL, usage: data?.usage, usedOwn: false }); } catch (_) {}

    let text = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").replace(/```json|```/g, "").trim();
    let out: any;
    try { out = JSON.parse(text); } catch { return new Response(JSON.stringify({ ok: false, error: "Could not classify." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } }); }

    const milestone_key = TYPE_TO_MILESTONE[out.doc_type] || null;
    // fetch the milestone's human label if we have a match
    let milestone_label = null;
    if (milestone_key) {
      const { data: md } = await admin.from("txn_milestone_defs").select("label").eq("key", milestone_key).maybeSingle();
      milestone_label = md?.label || null;
    }
    return new Response(JSON.stringify({ ok: true, doc_type: out.doc_type, label: out.label, confidence: out.confidence, milestone_key, milestone_label }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
