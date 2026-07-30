import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const DOC_TYPES = ["farbar_contract","as_is_rider","addendum","amendment","counteroffer","buyer_brokerage","agency_disclosure","seller_disclosure","lead_paint","hoa_condo","financing","loan_estimate","emd_receipt","inspection","wdo","appraisal","dd_waiver","appraisal_waiver","financing_waiver","title_commitment","closing_disclosure","cda","wire_instructions","misc"];

function bytesToB64(bytes: Uint8Array) {
  let bin = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    const uid = user.id;
    const db = createClient(SUPABASE_URL, SERVICE);
    const { document_id } = await req.json();
    if (!document_id) return new Response(JSON.stringify({ error: "document_id required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: doc } = await db.from("file_documents").select("*").eq("id", document_id).eq("user_id", uid).single();
    if (!doc || !doc.storage_path) return new Response(JSON.stringify({ error: "Document not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: blob, error: dlErr } = await db.storage.from("file-docs").download(doc.storage_path);
    if (dlErr || !blob) throw new Error("download failed");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) return new Response(JSON.stringify({ error: "File too large for extraction (>8MB)" }), { status: 413, headers: { ...cors, "Content-Type": "application/json" } });
    const b64 = bytesToB64(bytes);
    const mime = doc.mime || "application/pdf";
    const isPdf = mime.includes("pdf");
    const block = isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
      : { type: "image", source: { type: "base64", media_type: mime, data: b64 } };
    const prompt = `Read this Florida real-estate transaction document and return ONLY JSON (no prose):
{"doc_type": one of ${JSON.stringify(DOC_TYPES)}, "is_executed": boolean,
"address": string|null, "buyer": string|null, "seller": string|null,
"price": number|null, "emd": number|null,
"effective_date":"YYYY-MM-DD"|null, "closing_date":"YYYY-MM-DD"|null,
"inspection_deadline":"YYYY-MM-DD"|null, "financing_deadline":"YYYY-MM-DD"|null, "appraisal_deadline":"YYYY-MM-DD"|null,
"waives": array subset of ["inspection","appraisal","financing"],
"commission_total": number|null, "commission_to_brokerage": number|null,
"confidence": number 0..1, "summary": one short sentence}
For closing disclosure / settlement statements fill commission_total and commission_to_brokerage (commission paid to the buyer's-side/selling brokerage). Otherwise leave them null.`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }] }),
    });
    if (!r.ok) throw new Error("Claude " + r.status + " " + (await r.text()).slice(0, 200));
    const data = await r.json();
    try { await logAiUsage(db, { userId: uid, fn: "files-doc-extract", model: MODEL, usage: data?.usage, usedOwn: false }); } catch (_) {}
    let txt = (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
    txt = txt.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const ai = JSON.parse(txt);

    const merged = { ...(doc.extracted_terms || {}), ...ai };
    await db.from("file_documents").update({ extracted_terms: merged }).eq("id", document_id);
    return new Response(JSON.stringify({ ok: true, ai: merged }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
