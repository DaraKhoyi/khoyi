import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DOCTYPE_TO_ITEM: Record<string,string> = { farbar_contract:"farbar_contract", as_is_rider:"as_is_rider", addendum:"addenda", amendment:"addenda", counteroffer:"addenda", buyer_brokerage:"buyer_brokerage", agency_disclosure:"agency_disclosure", seller_disclosure:"seller_disclosure", lead_paint:"lead_paint", hoa_condo:"hoa_condo", financing:"financing", emd_receipt:"emd_receipt", closing_disclosure:"closing_disclosure", cda:"cda" };
const CONSENT = "By checking this box and typing my name below, I agree that my electronic signature is the legal equivalent of my handwritten signature, I consent to conduct this transaction electronically under the U.S. ESIGN Act and Florida's UETA, and I agree to be bound by the contents of this document.";

async function sha256(bytes: Uint8Array) { const h = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, "0")).join(""); }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const db = createClient(SUPABASE_URL, SERVICE);
    const { action, token, consent, signature_name, signature_type, signature_data, decline_reason } = await req.json();
    if (!token) return new Response(JSON.stringify({ error: "Missing token" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: signer } = await db.from("signature_signers").select("*").eq("token", token).single();
    if (!signer) return new Response(JSON.stringify({ error: "Invalid or expired link" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    const { data: request } = await db.from("signature_requests").select("*").eq("id", signer.request_id).single();
    const { data: doc } = request?.document_id ? await db.from("file_documents").select("*").eq("id", request.document_id).single() : { data: null };
    const { data: allSigners } = await db.from("signature_signers").select("name,role,status,signed_at").eq("request_id", signer.request_id).order("sign_order", { ascending: true });

    if (action === "get") {
      let view_url = null;
      const path = request?.signed_storage_path || doc?.storage_path;
      if (path) { const { data: s } = await db.storage.from("file-docs").createSignedUrl(path, 3600); view_url = s?.signedUrl || null; }
      if (signer.status === "pending") await db.from("signature_signers").update({ status: "viewed", viewed_at: new Date().toISOString() }).eq("id", signer.id);
      return new Response(JSON.stringify({ ok: true, consent_text: CONSENT,
        signer: { name: signer.name, role: signer.role, status: signer.status === "pending" ? "viewed" : signer.status },
        request: { title: request?.title, message: request?.message, status: request?.status },
        document: { title: doc?.title || request?.title }, view_url, signers: allSigners || [] }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (request?.status === "completed" || signer.status === "signed") return new Response(JSON.stringify({ ok: true, already: true }), { headers: { ...cors, "Content-Type": "application/json" } });

    if (action === "decline") {
      await db.from("signature_signers").update({ status: "declined", decline_reason: decline_reason || null }).eq("id", signer.id);
      await db.from("signature_requests").update({ status: "declined" }).eq("id", signer.request_id);
      if (request?.file_id) await db.from("file_events").insert({ file_id: request.file_id, user_id: signer.user_id, kind: "esign_declined", detail: `${signer.name || "Signer"} declined to sign ${request?.title || ""}` });
      return new Response(JSON.stringify({ ok: true, declined: true }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    if (action === "sign") {
      if (request?.sign_in_order) {
        const earlier = (allSigners || []).filter((s: any) => (s.sign_order || 1) < (signer.sign_order || 1));
        if (earlier.some((s: any) => s.status !== "signed")) return new Response(JSON.stringify({ error: "It's not your turn yet \u2014 an earlier signer still needs to sign. We'll email you when it's ready." }), { status: 409, headers: { ...cors, "Content-Type": "application/json" } });
      }
      if (!consent) return new Response(JSON.stringify({ error: "Consent is required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      if (!signature_name || !signature_name.trim()) return new Response(JSON.stringify({ error: "Type your name to sign" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
      const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
      const ua = req.headers.get("user-agent") || "unknown";
      const now = new Date().toISOString();
      await db.from("signature_signers").update({ status: "signed", signature_name: signature_name.trim(), signature_type: signature_type === "drawn" ? "drawn" : "typed", signature_data: signature_data || null, consent_at: now, signed_at: now, ip, user_agent: ua }).eq("id", signer.id);

      const { data: refreshed } = await db.from("signature_signers").select("*").eq("request_id", signer.request_id).order("sign_order", { ascending: true });
      const remaining = (refreshed || []).filter((s: any) => s.status !== "signed");
      if (remaining.length === 0 && doc?.storage_path) {
        // finalize: append signature + certificate page, hash, store
        const { data: blob } = await db.storage.from("file-docs").download(doc.storage_path);
        const origBytes = new Uint8Array(await blob!.arrayBuffer());
        const shaOrig = await sha256(origBytes);
        const pdf = await PDFDocument.load(origBytes);
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
        const script = await pdf.embedFont(StandardFonts.HelveticaOblique);
        const GOLD = rgb(0.773, 0.663, 0.369), INK = rgb(0.09, 0.09, 0.11), GREY = rgb(0.42, 0.45, 0.5);
        const page = pdf.addPage([612, 792]); const M = 54; let y = 792;
        page.drawRectangle({ x: 0, y: 792 - 64, width: 612, height: 64, color: INK });
        page.drawRectangle({ x: 0, y: 792 - 68, width: 612, height: 4, color: GOLD });
        page.drawText("Certificate of Completion", { x: M, y: 792 - 38, size: 15, font: bold, color: rgb(1, 1, 1) });
        page.drawText("PrismOS e-Sign \u00B7 ESIGN Act / Florida UETA", { x: M, y: 792 - 54, size: 9, font, color: GOLD });
        y = 792 - 92;
        page.drawText(`Document: ${doc.title || request?.title || ""}`, { x: M, y, size: 11, font: bold, color: INK }); y -= 18;
        page.drawText(`Envelope: ${signer.request_id}`, { x: M, y, size: 8.5, font, color: GREY }); y -= 26;
        for (const s of (refreshed || [])) {
          if (s.signature_type === "drawn" && s.signature_data) {
            try { const b64 = String(s.signature_data).split(",").pop()!; const bin = atob(b64); const arr = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) arr[k] = bin.charCodeAt(k); const png = await pdf.embedPng(arr); const dims = png.scale(1); const w = Math.min(170, dims.width); const h = w * (dims.height / dims.width); page.drawImage(png, { x: M + 6, y: y - h + 16, width: w, height: Math.min(h, 46) }); y -= Math.min(h, 46) - 2; }
            catch (_) { page.drawText(s.signature_name || s.name || "", { x: M + 6, y, size: 20, font: script, color: INK }); y -= 18; }
          } else { page.drawText(s.signature_name || s.name || "", { x: M + 6, y, size: 20, font: script, color: INK }); y -= 18; }
          page.drawLine({ start: { x: M, y: y + 4 }, end: { x: M + 280, y: y + 4 }, thickness: 0.7, color: GREY }); y -= 10;
          page.drawText(`${s.name || ""}${s.role ? " (" + s.role + ")" : ""}`, { x: M, y, size: 9.5, font: bold, color: INK }); y -= 13;
          page.drawText(`Signed (UTC): ${s.signed_at || ""}`, { x: M, y, size: 8.5, font, color: GREY }); y -= 12;
          page.drawText(`IP: ${s.ip || ""} \u00B7 Consent recorded \u00B7 ${(s.user_agent || "").slice(0, 70)}`, { x: M, y, size: 7.5, font, color: GREY }); y -= 22;
          if (y < 150) { y = 740; pdf.addPage([612, 792]); }
        }
        y -= 6;
        page.drawText(`Document SHA-256 (pre-signature): ${shaOrig}`, { x: M, y, size: 7, font, color: GREY }); y -= 12;
        page.drawText(`Sealed by PrismOS e-Sign on ${new Date().toLocaleString("en-US")}`, { x: M, y, size: 8, font, color: GREY });
        const signedBytes = await pdf.save();
        const shaSigned = await sha256(signedBytes);
        const signedPath = `${signer.user_id}/${request!.file_id}/signed-${signer.request_id}.pdf`;
        await db.storage.from("file-docs").upload(signedPath, signedBytes, { contentType: "application/pdf", upsert: true });
        const cert = { signers: (refreshed || []).map((s: any) => ({ name: s.name, role: s.role, signed_at: s.signed_at, ip: s.ip })), sha256_original: shaOrig, sha256_signed: shaSigned, completed_at: now };
        await db.from("signature_requests").update({ status: "completed", completed_at: now, sha256_original: shaOrig, sha256_signed: shaSigned, signed_storage_path: signedPath, certificate: cert }).eq("id", signer.request_id);
        await db.from("file_documents").update({ execution_state: "executed", storage_path: signedPath, review_status: "approved" }).eq("id", doc.id);
        if (doc.doc_type && DOCTYPE_TO_ITEM[doc.doc_type] && request!.file_id) {
          const { data: items } = await db.from("file_checklist_items").select("*").eq("file_id", request!.file_id).eq("item_key", DOCTYPE_TO_ITEM[doc.doc_type]);
          for (const it of (items || [])) await db.from("file_checklist_items").update({ status: "approved", satisfied_by: doc.id, updated_at: now }).eq("id", it.id);
        }
        if (request!.file_id) await db.from("file_events").insert({ file_id: request!.file_id, user_id: signer.user_id, kind: "doc_executed", detail: `${doc.title || request?.title || "Document"} fully executed via PrismOS e-Sign`, meta: { request_id: signer.request_id } });
      }
      return new Response(JSON.stringify({ ok: true, signed: true, completed: remaining.length === 0 }), { headers: { ...cors, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
