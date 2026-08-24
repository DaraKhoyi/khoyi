import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const GOLD = rgb(0.773,0.663,0.369), DGOLD = rgb(0.604,0.502,0.220), LGOLD = rgb(0.984,0.965,0.914), INK = rgb(0.09,0.09,0.11), GREY = rgb(0.42,0.45,0.5), RED = rgb(0.83,0.18,0.18), GREEN = rgb(0.13,0.55,0.3);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    const uid = user.id;
    const db = createClient(SUPABASE_URL, SERVICE);
    const body = await req.json();
    const { file_id, doc_title, agent_name, sections, disbursement, note, recruiting_email, ledger, agent_id, closed_on } = body;
    if (!file_id) return new Response(JSON.stringify({ error: "file_id required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const pdf = await PDFDocument.create();
    let page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const W = 612, M = 50; let y = 792;
    const ensure = (need: number) => { if (y < need) { page = pdf.addPage([612, 792]); y = 760; } };

    page.drawRectangle({ x: 0, y: 792 - 66, width: W, height: 66, color: INK });
    page.drawRectangle({ x: 0, y: 792 - 70, width: W, height: 4, color: GOLD });
    page.drawText("REALTY ONE GROUP ADVANTAGE", { x: M, y: 792 - 36, size: 14, font: bold, color: rgb(1,1,1) });
    page.drawText("powered by PrismOS", { x: M, y: 792 - 52, size: 9, font, color: GOLD });
    y = 792 - 92;
    page.drawText(doc_title || "Commission Disbursement Authorization", { x: M, y, size: 18, font: bold, color: INK }); y -= 8;
    page.drawLine({ start: { x: M, y: y - 2 }, end: { x: W - M, y: y - 2 }, thickness: 1.5, color: GOLD }); y -= 22;
    if (agent_name) { page.drawText(`Agent: ${agent_name}`, { x: M, y, size: 11, font: bold, color: INK }); y -= 20; }

    const row = (label: string, value: string, opt: any = {}) => {
      ensure(70);
      page.drawText(String(label), { x: M + (opt.indent || 0), y, size: opt.small ? 9 : 10, font: opt.bold ? bold : font, color: opt.muted ? GREY : INK });
      if (value !== undefined && value !== null && value !== "") { const col = opt.neg ? RED : (opt.pos ? GREEN : INK); const vf = opt.bold ? bold : font; const vs = opt.small ? 9 : 10; page.drawText(String(value), { x: W - M - vf.widthOfTextAtSize(String(value), vs), y, size: vs, font: vf, color: col }); }
      y -= opt.gap || 16;
    };
    const heading = (t: string) => { ensure(80); y -= 6; page.drawText(t, { x: M, y, size: 9, font: bold, color: DGOLD }); y -= 4; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: GOLD }); y -= 14; };

    for (const sec of (sections || [])) {
      heading(sec.heading);
      for (const r of (sec.rows || [])) row(r.label, r.value, { bold: r.bold, muted: r.muted, small: r.small, indent: r.indent });
    }

    if (disbursement) {
      heading("Agent disbursement");
      for (const r of (disbursement.rows || [])) row(r.label, r.value, { bold: r.bold, neg: r.neg, indent: r.indent, muted: r.muted });
      ensure(70);
      const h = 30;
      page.drawRectangle({ x: M, y: y - 8, width: W - 2 * M, height: h, color: LGOLD, borderColor: DGOLD, borderWidth: 1 });
      page.drawText(disbursement.net_label || "NET TO AGENT", { x: M + 12, y: y + 2, size: 12, font: bold, color: DGOLD });
      const nv = disbursement.net_value || "";
      page.drawText(nv, { x: W - M - 12 - bold.widthOfTextAtSize(nv, 14), y: y + 1, size: 14, font: bold, color: INK });
      y -= h + 14;
    }

    if (note) { ensure(80); const words = String(note).split(" "); let cur = ""; for (const w of words) { if ((cur + " " + w).length > 95) { row(cur, "", { small: true, muted: true }); cur = w; } else cur = cur ? cur + " " + w : w; } if (cur) row(cur, "", { small: true, muted: true }); }

    ensure(80); y -= 8;
    page.drawLine({ start: { x: M, y }, end: { x: M + 240, y }, thickness: 1, color: INK });
    page.drawLine({ start: { x: W - M - 150, y }, end: { x: W - M, y }, thickness: 1, color: INK });
    y -= 12; page.drawText("Authorized Broker \u2014 Realty ONE Group Advantage", { x: M, y, size: 8.5, font, color: GREY }); page.drawText("Date", { x: W - M - 150, y, size: 8.5, font, color: GREY });
    page.drawText(`Generated by PrismOS \u00B7 ${new Date().toLocaleString("en-US")} \u00B7 File ${String(file_id).slice(0, 8)}`, { x: M, y: 30, size: 7, font, color: GREY });

    const bytes = await pdf.save();
    const path = `${uid}/${file_id}/cda-${Date.now()}.pdf`;
    await db.storage.from("file-docs").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    const { data: doc } = await db.from("file_documents").insert({ file_id, user_id: uid, doc_type: "cda", title: doc_title || "Commission Disbursement Authorization", storage_path: path, file_name: "CDA.pdf", mime: "application/pdf", size_bytes: bytes.length, source: "generated", execution_state: "draft" }).select().single();
    const { data: items } = await db.from("file_checklist_items").select("*").eq("file_id", file_id).eq("item_key", "cda");
    for (const it of (items || [])) if (it.status === "missing") await db.from("file_checklist_items").update({ status: "received", satisfied_by: doc?.id, updated_at: new Date().toISOString() }).eq("id", it.id);
    await db.from("file_events").insert({ file_id, user_id: uid, kind: "cda_generated", detail: `CDA generated${agent_name ? " for " + agent_name : ""}`, meta: { doc_id: doc?.id } });

    if (ledger) {
      try {
        const { data: f } = await db.from("files").select("user_id").eq("id", file_id).maybeSingle();
        await db.from("cda_ledger").insert({ user_id: f?.user_id || uid, agent_id: agent_id || null, file_id, document_id: doc?.id || null, closed_on: closed_on || null,
          price: ledger.price ?? null, total_comm: ledger.totalComm ?? null, coop_gci: ledger.coopGci ?? null, our_gci: ledger.gciNet ?? null,
          agent_gross: ledger.agentGross ?? null, total_fees: ledger.totalFees ?? null, agent_net: ledger.agentNet ?? null, agent_cash: ledger.agentCash ?? null,
          company_dollar: ledger.companyDollar ?? null, profit_share: ledger.profitShare ?? null, savings: ledger.savings ?? null, retirement: ledger.retirement ?? null, breakdown: ledger });
      } catch (_) {}
    }

    let recruiting_sent = false;
    if (recruiting_email) {
      try {
        const { data: accts } = await db.from("email_accounts").select("id,is_active").eq("user_id", uid);
        const acct = (accts || []).find((a: any) => a.is_active !== false);
        const { data: signed } = await db.storage.from("file-docs").createSignedUrl(path, 7 * 24 * 3600);
        if (acct && signed?.signedUrl) {
          await db.functions.invoke("gmail-send", { body: { account_id: acct.id, user_id: uid, to: recruiting_email, subject: `CDA \u2014 ${doc_title || "Commission Disbursement"}${agent_name ? " \u2014 " + agent_name : ""}`, body_text: `A Commission Disbursement Authorization has been generated.\n\nAgent: ${agent_name || ""}\n\nView (link valid 7 days):\n${signed.signedUrl}\n\n\u2014 Realty ONE Group Advantage \u00B7 PrismOS` } });
          recruiting_sent = true;
        }
      } catch (_) {}
    }
    return new Response(JSON.stringify({ ok: true, document: doc, recruiting_sent }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
