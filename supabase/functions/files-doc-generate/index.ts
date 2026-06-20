import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const GOLD = rgb(0.773, 0.663, 0.369);
const DGOLD = rgb(0.604, 0.502, 0.220);
const LGOLD = rgb(0.984, 0.965, 0.914);
const INK = rgb(0.09, 0.09, 0.11);
const GREY = rgb(0.42, 0.45, 0.5);

const money = (n: any) => (n === null || n === undefined || n === "" || isNaN(Number(n))) ? "\u2014" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const sdate = (d: any) => { if (!d) return "\u2014"; try { return new Date(String(d).length <= 10 ? d + "T00:00:00" : d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }); } catch { return String(d); } };

const TEMPLATES: Record<string, { title: string; doc_type: string; item_key: string | null }> = {
  cda: { title: "Commission Disbursement Authorization", doc_type: "cda", item_key: "cda" },
  buyer_rep_cover: { title: "Buyer Representation Summary", doc_type: "misc", item_key: null },
  compliance_attestation: { title: "Broker Compliance Attestation", doc_type: "misc", item_key: null },
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    const uid = user.id;
    const db = createClient(SUPABASE_URL, SERVICE);
    const { file_id, template } = await req.json();
    const tpl = TEMPLATES[template];
    if (!file_id || !tpl) return new Response(JSON.stringify({ error: "file_id and valid template required" }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });

    const { data: f } = await db.from("files").select("*").eq("id", file_id).eq("user_id", uid).single();
    if (!f) return new Response(JSON.stringify({ error: "File not found" }), { status: 404, headers: { ...cors, "Content-Type": "application/json" } });
    const { data: parties } = await db.from("file_parties").select("*").eq("file_id", file_id);
    const { data: chk } = await db.from("file_checklist_items").select("*").eq("file_id", file_id).order("sort", { ascending: true });

    // ---- build PDF ----
    const pdf = await PDFDocument.create();
    const page = pdf.addPage([612, 792]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const W = 612, M = 54;
    let y = 792;

    // header band
    page.drawRectangle({ x: 0, y: 792 - 70, width: W, height: 70, color: INK });
    page.drawRectangle({ x: 0, y: 792 - 74, width: W, height: 4, color: GOLD });
    page.drawText("REALTY ONE GROUP ADVANTAGE", { x: M, y: 792 - 38, size: 15, font: bold, color: rgb(1, 1, 1) });
    page.drawText("powered by PrismOS", { x: M, y: 792 - 56, size: 9, font, color: GOLD });
    y = 792 - 70 - 40;

    page.drawText(tpl.title, { x: M, y, size: 20, font: bold, color: INK });
    y -= 10;
    page.drawLine({ start: { x: M, y: y - 2 }, end: { x: W - M, y: y - 2 }, thickness: 1.5, color: GOLD });
    y -= 28;

    const line = (label: string, val: string, opt: any = {}) => {
      page.drawText(label, { x: M, y, size: 9, font: bold, color: GREY });
      page.drawText(val || "\u2014", { x: M + 150, y, size: 11, font: opt.bold ? bold : font, color: INK });
      y -= opt.gap || 22;
    };
    const para = (text: string, size = 10) => {
      const max = 92; const words = text.split(" "); let cur = "";
      for (const w of words) { if ((cur + " " + w).length > max) { page.drawText(cur, { x: M, y, size, font, color: INK }); y -= size + 5; cur = w; } else cur = cur ? cur + " " + w : w; }
      if (cur) { page.drawText(cur, { x: M, y, size, font, color: INK }); y -= size + 5; }
    };
    const spotlight = (rows: [string, string][]) => {
      const h = rows.length * 22 + 20;
      page.drawRectangle({ x: M, y: y - h + 12, width: W - 2 * M, height: h, color: LGOLD, borderColor: DGOLD, borderWidth: 1 });
      y -= 8;
      for (const [k, v] of rows) { page.drawText(k, { x: M + 16, y: y - 6, size: 10, font: bold, color: DGOLD }); page.drawText(v, { x: W - M - 16 - bold.widthOfTextAtSize(v, 12), y: y - 6, size: 12, font: bold, color: INK }); y -= 22; }
      y -= 18;
    };
    const sigBlock = (who: string) => {
      y -= 14;
      page.drawLine({ start: { x: M, y }, end: { x: M + 240, y }, thickness: 1, color: INK });
      page.drawLine({ start: { x: W - M - 140, y }, end: { x: W - M, y }, thickness: 1, color: INK });
      y -= 12;
      page.drawText(who, { x: M, y, size: 9, font, color: GREY });
      page.drawText("Date", { x: W - M - 140, y, size: 9, font, color: GREY });
      y -= 24;
    };

    const addr = [f.address, [f.city, f.state, f.zip].filter(Boolean).join(", ")].filter(Boolean).join(" \u2014 ");

    if (template === "cda") {
      line("Property", addr, { bold: true });
      line("Buyer", f.buyer_name || "\u2014");
      line("Seller", f.seller_name || "\u2014");
      line("Closing date", sdate(f.closing_date));
      y -= 8;
      spotlight([
        ["Sale price", money(f.contract_price)],
        ["Commission per Closing Disclosure", money(f.commission_cd)],
        ["Commission expected (file)", money(f.commission_gross)],
        ["Agent split", f.commission_split != null ? f.commission_split + "%" : "\u2014"],
        ["Net to agent", money(f.commission_net)],
      ]);
      para("The undersigned broker authorizes and directs the closing agent to disburse the commission stated above to Realty ONE Group Advantage at the closing of the above-referenced transaction. This authorization is issued pursuant to the brokerage's records for this file.");
      y -= 16;
      sigBlock("Authorized Broker \u2014 Realty ONE Group Advantage");
    } else if (template === "buyer_rep_cover") {
      line("Buyer", f.buyer_name || "\u2014", { bold: true });
      line("Property / area", addr);
      line("Effective date", sdate(f.effective_date));
      line("Closing date", sdate(f.closing_date));
      const lender = (parties || []).find((p: any) => p.role === "lender");
      const title = (parties || []).find((p: any) => p.role === "title");
      line("Lender", lender?.name || "\u2014");
      line("Title / closing agent", title?.name || "\u2014");
      y -= 10;
      para("This summary accompanies the buyer's representation file maintained by Realty ONE Group Advantage. It records the engagement details for the above buyer and is for internal brokerage and transaction-coordination use. The governing agreements and disclosures are retained as separate executed documents within this file.");
      y -= 20;
      sigBlock("Buyer's Agent");
    } else if (template === "compliance_attestation") {
      line("Property", addr, { bold: true });
      line("File status", String(f.status || "").replace(/_/g, " "));
      line("Prepared", sdate(new Date().toISOString().slice(0, 10)));
      y -= 8;
      page.drawText("Required document checklist", { x: M, y, size: 11, font: bold, color: INK }); y -= 18;
      for (const it of (chk || []).filter((c: any) => c.required)) {
        const done = ["approved", "waived", "na"].includes(it.status);
        page.drawText(done ? "\u2713" : "\u25CB", { x: M, y, size: 11, font: bold, color: done ? rgb(0.13, 0.77, 0.37) : GREY });
        page.drawText(String(it.label).slice(0, 70), { x: M + 18, y, size: 10, font, color: INK });
        page.drawText(String(it.status).toUpperCase(), { x: W - M - 70, y, size: 9, font: bold, color: done ? rgb(0.13, 0.77, 0.37) : GREY });
        y -= 18;
        if (y < 140) { y = 740; pdf.addPage([612, 792]); }
      }
      y -= 10;
      para("The undersigned broker attests that, to the best of the brokerage's knowledge, the documents marked complete above are on file for this transaction and were handled in accordance with the brokerage's compliance procedures.");
      y -= 16;
      sigBlock("Reviewing Broker");
    }

    // footer
    const footer = `Generated by PrismOS \u00B7 ${new Date().toLocaleString("en-US")} \u00B7 File ${String(file_id).slice(0, 8)}`;
    page.drawText(footer, { x: M, y: 36, size: 7.5, font, color: GREY });

    const bytes = await pdf.save();

    const path = `${uid}/${file_id}/generated-${template}-${Date.now()}.pdf`;
    await db.storage.from("file-docs").upload(path, bytes, { contentType: "application/pdf", upsert: true });
    const { data: doc } = await db.from("file_documents").insert({
      file_id, user_id: uid, doc_type: tpl.doc_type, title: tpl.title, storage_path: path,
      file_name: tpl.title.replace(/[^a-z0-9]+/gi, "_") + ".pdf", mime: "application/pdf",
      size_bytes: bytes.length, source: "generated", execution_state: "draft",
    }).select().single();

    if (tpl.item_key && doc) {
      const { data: items } = await db.from("file_checklist_items").select("*").eq("file_id", file_id).eq("item_key", tpl.item_key);
      for (const it of (items || [])) if (it.status === "missing") await db.from("file_checklist_items").update({ status: "received", satisfied_by: doc.id, updated_at: new Date().toISOString() }).eq("id", it.id);
    }
    await db.from("file_events").insert({ file_id, user_id: uid, kind: "doc_generated", detail: `${tpl.title} generated by PrismOS`, meta: { doc_id: doc?.id, template } });

    return new Response(JSON.stringify({ ok: true, document: doc }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
