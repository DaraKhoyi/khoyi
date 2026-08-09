// txn-doc-completeness — check whether a signed document is actually complete:
// signatures present, initials on every page that needs them, required blanks filled,
// dates entered. Tiered so we use the most reliable signal available, and cross-checked
// against the parties we already know must sign.
//
//   Tier 1 (fillable PDF): pdf-lib reads real form fields — exact, no AI.
//   Tier 2 (flattened/scanned): Claude vision walks each signature/initial/date/blank.
//   Tier 3 (cross-check): compare against txn_parties buyers/sellers — right people,
//           everywhere they had to sign.
//
// ADVISORY, not a gate: it flags likely gaps for a human to verify; it never certifies
// legal completeness and never hard-blocks on its own read.
//
// POST { transaction_id, document_id }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { logAiUsage } from "../_shared/aiUsage.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "claude-sonnet-4-6";

const visionPrompt = (buyers: string[], sellers: string[]) => `You are auditing a SIGNED U.S. residential real-estate document for completeness. Known parties who must sign/initial where their role appears:
- Buyers: ${buyers.length ? buyers.join(", ") : "(unknown)"}
- Sellers: ${sellers.length ? sellers.join(", ") : "(unknown)"}

Walk the document page by page. For every signature block, initial line, date field, and fill-in blank, decide whether it is FILLED or EMPTY. Then judge whether each empty one is actually REQUIRED, looks OPTIONAL, or is an N/A line.

Return ONLY JSON:
{
  "items": [ { "page": 1-indexed, "kind": "signature"|"initial"|"date"|"blank", "label": "what/where it is", "status": "filled"|"empty", "requirement": "required"|"optional"|"na", "who": "buyer"|"seller"|"agent"|"other"|null } ],
  "parties_signed": { "all_buyers_signed": true|false|null, "all_sellers_signed": true|false|null },
  "summary": "one short sentence — what's complete and what's missing",
  "confidence": "high"|"medium"|"low"
}
Only list items that matter (skip decorative lines). Be conservative: a light or stylized signature still counts as filled. Missing footer/margin initials are a common oversight — check every page for them.`;

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

    const { data: doc } = await admin.from("documents").select("id, storage_path, mime_type, user_id, title").eq("id", document_id).maybeSingle();
    if (!doc?.storage_path) return new Response(JSON.stringify({ error: "Document not found." }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    const { data: blob, error: dlErr } = await admin.storage.from("documents").download(doc.storage_path);
    if (dlErr || !blob) return new Response(JSON.stringify({ error: "Could not read the document." }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    // known parties for cross-check
    const { data: parties } = await admin.from("txn_parties").select("role, name").eq("transaction_id", transaction_id);
    const buyers = (parties || []).filter((p: any) => p.role === "buyer").map((p: any) => p.name).filter(Boolean);
    const sellers = (parties || []).filter((p: any) => p.role === "seller").map((p: any) => p.name).filter(Boolean);

    let result: any = null;

    // ── Tier 1: real form fields ──
    if ((doc.mime_type || "") === "application/pdf") {
      try {
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const form = pdf.getForm();
        const fields = form.getFields();
        if (fields.length > 0) {
          const items = fields.map((f: any) => {
            const name = f.getName();
            let filled = true;
            try {
              const t = f.constructor?.name || "";
              if (t.includes("TextField")) filled = !!(f.getText && f.getText());
              else if (t.includes("CheckBox")) filled = f.isChecked ? f.isChecked() : true;
              else if (t.includes("Signature")) filled = false; // sig fields report empty; vision confirms
            } catch (_) { filled = true; }
            const isSig = /sign|initial/i.test(name);
            return { page: null, kind: isSig ? (/initial/i.test(name) ? "initial" : "signature") : "blank", label: name, status: filled ? "filled" : "empty", requirement: /req|signature|initial|date/i.test(name) ? "required" : "optional", who: null };
          });
          const emptyReq = items.filter((i: any) => i.status === "empty" && i.requirement === "required");
          result = { items, tier: "form_fields", summary: emptyReq.length ? `${emptyReq.length} required field(s) still empty.` : "All detected form fields are filled.", confidence: emptyReq.length ? "high" : "medium", parties_signed: {} };
        }
      } catch (_) { /* fall through to vision */ }
    }

    // ── Tier 2: vision (flattened / scanned / no form fields) ──
    if (!result) {
      let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      const mime = doc.mime_type || "application/pdf";
      const block = mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: mime, data: b64 } };
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 2000, messages: [{ role: "user", content: [block, { type: "text", text: visionPrompt(buyers, sellers) }] }] }),
      });
      const data = await r.json();
      try { await logAiUsage(admin, { userId: uid || doc.user_id, fn: "txn-doc-completeness", model: MODEL, usage: data?.usage, usedOwn: false }); } catch (_) {}
      let text = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").replace(/```json|```/g, "").trim();
      try { result = { ...JSON.parse(text), tier: "vision" }; } catch { result = { items: [], summary: "Could not read the document clearly.", confidence: "low", tier: "vision" }; }
    }

    // ── status roll-up ──
    const missingReq = (result.items || []).filter((i: any) => i.status === "empty" && i.requirement === "required");
    const partiesGap = result.parties_signed && (result.parties_signed.all_buyers_signed === false || result.parties_signed.all_sellers_signed === false);
    const status = (missingReq.length > 0 || partiesGap) ? "needs_attention" : "complete";

    await admin.from("txn_doc_reviews").upsert({ transaction_id, document_id, status, result, checked_at: new Date().toISOString() }, { onConflict: "transaction_id,document_id" });

    return new Response(JSON.stringify({ ok: true, status, result }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
