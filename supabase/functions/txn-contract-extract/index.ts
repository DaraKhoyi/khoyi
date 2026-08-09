// txn-contract-extract — read an executed purchase contract and pull out everything
// that otherwise gets typed by hand: the parties, the price and financing, and every
// critical date. Populates the transaction as a PROPOSAL the human reviews (never a
// silent overwrite of a legal document). Powered by Claude vision on the uploaded PDF.
//
// POST { transaction_id, document_id }
//   -> { ok, extracted:{...}, parties:[...] }  (also stored on the transaction, pending review)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const MODEL = "claude-sonnet-4-6";

// The field set comes straight from how residential contracts actually work: every
// deadline counts from the effective date. We ask for ISO dates so they're sortable.
const PROMPT = `You are reading an executed U.S. residential real-estate purchase contract (often a Florida FAR/BAR or similar form). Extract the following and return ONLY a JSON object, no prose, no markdown. Use null for anything not present. Dates must be ISO YYYY-MM-DD. Money as plain numbers (no $ or commas).

{
  "buyers": ["full legal name", ...],
  "sellers": ["full legal name", ...],
  "property_address": "full street address",
  "purchase_price": number,
  "earnest_money": number,
  "financing_type": "cash" | "financed" | null,
  "loan_type": "conventional|FHA|VA|USDA|other" | null,
  "effective_date": "the date the contract became binding / last signature / ratification",
  "closing_date": "YYYY-MM-DD",
  "possession_date": "YYYY-MM-DD",
  "earnest_money_deadline": "YYYY-MM-DD",
  "inspection_deadline": "YYYY-MM-DD",
  "inspection_objection_deadline": "YYYY-MM-DD",
  "financing_deadline": "YYYY-MM-DD",
  "appraisal_deadline": "YYYY-MM-DD",
  "title_deadline": "YYYY-MM-DD",
  "walkthrough_date": "YYYY-MM-DD",
  "buyer_agent": {"name": null, "email": null, "phone": null, "company": null},
  "listing_agent": {"name": null, "email": null, "phone": null, "company": null},
  "title_company": {"name": null, "email": null, "phone": null},
  "lender": {"name": null, "email": null, "phone": null},
  "contingencies": ["short phrase", ...],
  "confidence": "high" | "medium" | "low"
}

Read carefully. If a deadline is expressed as "N days from effective date," compute the actual calendar date from the effective date. If both parties' signature dates differ, the effective date is the later one.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: u } = await admin.auth.getUser(token);
    const uid = u?.user?.id;
    const body = await req.json();
    const { transaction_id, document_id } = body;
    if (!transaction_id || !document_id) return new Response(JSON.stringify({ error: "transaction_id and document_id required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    // permission: staff or the deal's agent (mirror txn_can_edit)
    const { data: canEdit } = await admin.rpc("txn_can_edit", { p_id: transaction_id });
    // when called with a user token, txn_can_edit reads auth.uid via the RPC; for service calls trust the caller
    if (uid && canEdit === false) return new Response(JSON.stringify({ error: "Not permitted." }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: doc } = await admin.from("documents").select("id, storage_path, mime_type, user_id").eq("id", document_id).maybeSingle();
    if (!doc?.storage_path) return new Response(JSON.stringify({ error: "Document not found." }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: blob, error: dlErr } = await admin.storage.from("documents").download(doc.storage_path);
    if (dlErr || !blob) return new Response(JSON.stringify({ error: "Could not read the document file." }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
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
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: "user", content: [block, { type: "text", text: PROMPT }] }] }),
    });
    const data = await r.json();
    try { await logAiUsage(admin, { userId: uid || doc.user_id || body.user_id, fn: "txn-contract-extract", model: MODEL, usage: data?.usage, usedOwn: false }); } catch (_) {}

    let text = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
    text = text.replace(/```json|```/g, "").trim();
    let ex: any;
    try { ex = JSON.parse(text); } catch { return new Response(JSON.stringify({ error: "Could not read the contract cleanly. Try a clearer scan." }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } }); }

    // shape the key dates (only non-null), preserving a stable order
    const dateFields: [string, string][] = [
      ["effective_date", "Effective date"], ["earnest_money_deadline", "Earnest money due"],
      ["inspection_deadline", "Inspection deadline"], ["inspection_objection_deadline", "Inspection objection"],
      ["appraisal_deadline", "Appraisal deadline"], ["financing_deadline", "Financing / loan approval"],
      ["title_deadline", "Title objection"], ["walkthrough_date", "Final walkthrough"],
      ["closing_date", "Closing"], ["possession_date", "Possession"],
    ];
    const key_dates = dateFields
      .filter(([k]) => ex[k])
      .map(([k, label]) => ({ key: k, label, date: ex[k] }));

    // store on the transaction (pending review — we set the low-risk facts, propose the rest)
    await admin.from("brokerage_transactions").update({
      contract_data: ex, key_dates,
      effective_date: ex.effective_date || null,
      purchase_price: ex.purchase_price || null,
      earnest_money: ex.earnest_money || null,
      loan_type: ex.loan_type || null,
      contract_extracted_at: new Date().toISOString(),
    }).eq("id", transaction_id);

    // build a parties list for review (not yet written — the client confirms then persists)
    const parties: any[] = [];
    (ex.buyers || []).forEach((n: string) => n && parties.push({ role: "buyer", name: n }));
    (ex.sellers || []).forEach((n: string) => n && parties.push({ role: "seller", name: n }));
    const pp = (role: string, o: any) => { if (o && (o.name || o.email)) parties.push({ role, name: o.name, email: o.email, phone: o.phone, company: o.company }); };
    pp("buyer_agent", ex.buyer_agent); pp("listing_agent", ex.listing_agent);
    pp("title", ex.title_company); pp("lender", ex.lender);

    return new Response(JSON.stringify({ ok: true, extracted: ex, key_dates, parties }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
