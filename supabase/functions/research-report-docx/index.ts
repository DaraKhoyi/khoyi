// research-report-docx
// Generates a CLEANED-UP, BRANDED Microsoft Word (.docx) research report for a
// contact, from the structured research already stored on public.profiles.
//
// Two modes (client picks per download):
//   mode = 'client' — a polished factual dossier to share WITH the person or a
//                     third party: bio, career, expertise, interests, overlaps,
//                     sources. NO coaching, NO DISC.
//   mode = 'agent'  — the agent's prep sheet: everything in 'client' PLUS the
//                     DISC behavioral read. Still EXCLUDES the internal coaching
//                     (how-to-build-rapport / conversation starters / topics to
//                     lean into / topics to AVOID / add-value / follow-ups).
//
// Both are branded "Realty ONE Group Advantage · powered by Prism" with the
// agent's contact block in the footer.
//
// POST body: { contact_id: uuid, mode?: 'client'|'agent' }
// Returns:   { ok:true, filename, base64 }  (the client triggers the download)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, Footer, Header,
} from "https://esm.sh/docx@8.5.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Brand tokens (Prism Editorial)
const GOLD = "9A8038";
const NEARBLACK = "100D09";
const INK = "2B2620";

const asArr = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.filter((x) => x != null && String(x).trim()).map(String);
  if (typeof v === "string" && v.trim()) return v.split(/\s*[;\n\u2022]\s*/).map((s) => s.trim()).filter(Boolean);
  return [];
};

function eyebrow(text: string) {
  return new Paragraph({
    spacing: { before: 260, after: 60 },
    children: [new TextRun({ text: text.toUpperCase(), bold: true, size: 18, color: GOLD, characterSpacing: 60 })],
  });
}
function heading(text: string) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 40, after: 120 },
    children: [new TextRun({ text, size: 30, color: NEARBLACK, font: "Georgia" })],
  });
}
function body(text: string) {
  return new Paragraph({
    spacing: { after: 120, line: 300 },
    children: [new TextRun({ text, size: 21, color: INK, font: "Calibri" })],
  });
}
function bullet(text: string) {
  return new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60, line: 290 },
    children: [new TextRun({ text, size: 21, color: INK, font: "Calibri" })],
  });
}
function goldRule() {
  return new Paragraph({
    spacing: { before: 40, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: GOLD, space: 1 } },
    children: [new TextRun({ text: "", size: 2 })],
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE);

    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return J({ error: "Unauthorized" }, 401);

    const bodyIn = await req.json().catch(() => ({}));
    const contact_id = bodyIn.contact_id;
    const mode = bodyIn.mode === "agent" ? "agent" : "client";
    if (!contact_id) return J({ error: "contact_id required" }, 400);

    // Load contact — authorize by VISIBILITY (same rule as research): if the
    // caller's own JWT can read the row, they may export it.
    const { data: contact } = await supabase.from("contacts").select("*").eq("id", contact_id).single();
    if (!contact) return J({ error: "Contact not found" }, 404);
    if (contact.user_id !== user.id) {
      const asUser = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const { data: vis } = await asUser.from("contacts").select("id").eq("id", contact_id).maybeSingle();
      if (!vis) return J({ error: "Forbidden" }, 403);
    }

    const { data: profile } = await supabase.from("profiles").select("*").eq("contact_id", contact_id).eq("subject_kind", "contact").maybeSingle();
    if (!profile || profile.research_status !== "done") return J({ error: "No completed research to export for this contact." }, 400);

    // Agent's own info for the footer block
    const { data: agent } = await supabase.from("agents").select("name, email, phone, license_no").eq("auth_user_id", user.id).maybeSingle();

    const rp = (profile.research_profile && typeof profile.research_profile === "object") ? profile.research_profile : {};
    const summary = profile.research_summary || "";
    const overlaps = Array.isArray(profile.research_overlaps) ? profile.research_overlaps : [];
    const sources = Array.isArray(profile.research_sources) ? profile.research_sources : [];

    // ─── Build the document body ─────────────────────────────────────────────
    const children: Paragraph[] = [];

    // Title block
    children.push(new Paragraph({
      spacing: { after: 20 },
      children: [new TextRun({ text: contact.name || "Research report", bold: true, size: 44, color: NEARBLACK, font: "Georgia" })],
    }));
    if (rp.headline) {
      children.push(new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: String(rp.headline), italics: true, size: 24, color: GOLD, font: "Georgia" })],
      }));
    }
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: `Relationship dossier${mode === "agent" ? " · agent prep" : ""} · prepared ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`, size: 17, color: "7A7266", font: "Calibri" })],
    }));
    children.push(goldRule());

    // Overview / summary — the stored summary is the analytical writeup and
    // often contains DISC reasoning ("textbook C sequencing", "S-style"), so it
    // is coaching, not a clean bio. Only include it in AGENT mode; the client
    // dossier is built purely from the factual profile fields below.
    if (summary && mode === "agent") {
      children.push(eyebrow("Overview"));
      String(summary).split(/\n+/).map((s) => s.trim()).filter(Boolean).forEach((line) => children.push(body(line)));
    }

    // Background & education
    if (rp.background_education) { children.push(eyebrow("Background & education")); children.push(body(String(rp.background_education))); }
    // Career
    if (rp.career) { children.push(eyebrow("Career")); children.push(body(String(rp.career))); }
    // Expertise
    const expertise = asArr(rp.expertise);
    if (expertise.length) { children.push(eyebrow("Areas of expertise")); expertise.forEach((e) => children.push(bullet(e))); }
    // Interests & values
    const interests = asArr(rp.interests_values);
    if (interests.length) { children.push(eyebrow("Interests & values")); interests.forEach((e) => children.push(bullet(e))); }
    // Causes
    const causes = asArr(rp.causes);
    if (causes.length) { children.push(eyebrow("Causes they support")); causes.forEach((e) => children.push(bullet(e))); }
    // Community & media
    const media = asArr(rp.community_media);
    if (media.length) { children.push(eyebrow("Community & media")); media.forEach((e) => children.push(bullet(e))); }
    // Personal (public)
    if (rp.personal) { children.push(eyebrow("Personal")); children.push(body(String(rp.personal))); }

    // Overlaps with you (kept — this is factual common ground, not coaching)
    if (overlaps.length) {
      children.push(eyebrow("Common ground"));
      overlaps.forEach((o: any) => {
        const detail = typeof o === "string" ? o : (o?.detail || "");
        if (detail) children.push(bullet(detail));
      });
    }

    // ─── AGENT MODE ONLY: the DISC behavioral read (NOT the coaching plan) ────
    if (mode === "agent" && (profile.research_d_score != null || profile.d_score != null)) {
      children.push(goldRule());
      children.push(eyebrow("Behavioral read (DISC)"));
      const d = profile.d_score ?? profile.research_d_score;
      const i = profile.i_score ?? profile.research_i_score;
      const s = profile.s_score ?? profile.research_s_score;
      const c = profile.c_score ?? profile.research_c_score;
      const prim = profile.primary_letter || profile.research_primary || "";
      const sec = profile.secondary_letter || profile.research_secondary || "";
      children.push(body(`Primary style: ${prim}${sec ? " / " + sec : ""}`));
      children.push(body(`D ${d ?? "—"}   ·   I ${i ?? "—"}   ·   S ${s ?? "—"}   ·   C ${c ?? "—"}`));
      const conf = profile.research_confidence || (profile.confidence_pct ? `${profile.confidence_pct}%` : "tentative");
      children.push(new Paragraph({ spacing: { after: 100 }, children: [new TextRun({ text: `Confidence: ${conf}. Inferred from public evidence — treat as a hypothesis to confirm in person.`, italics: true, size: 18, color: "7A7266", font: "Calibri" })] }));
      // key evidence, if present
      const ev = asArr(rp.key_evidence || profile.research_key_evidence);
      if (ev.length) { ev.forEach((e) => children.push(bullet(e))); }
    }

    // Sources
    if (sources.length) {
      children.push(goldRule());
      children.push(eyebrow("Sources"));
      sources.forEach((s: any) => {
        const label = typeof s === "string" ? s : [s?.label, s?.url].filter(Boolean).join(" — ");
        if (label) children.push(bullet(label));
      });
    }

    // Confidentiality note
    children.push(new Paragraph({ spacing: { before: 240 }, children: [new TextRun({ text: mode === "client"
      ? "Compiled from public sources for relationship purposes. Not for tenant, employment, or credit screening."
      : "Internal preparation document. Compiled from public sources. Not for tenant, employment, or credit screening.", italics: true, size: 15, color: "9A948A", font: "Calibri" })] }));

    // Footer: brand + agent block
    const agentLine = agent ? [agent.name, agent.phone, agent.email, agent.license_no ? `Lic. ${agent.license_no}` : ""].filter(Boolean).join("  ·  ") : "";
    const footer = new Footer({
      children: [
        new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 6, color: GOLD, space: 4 } }, spacing: { before: 40 },
          children: [new TextRun({ text: "REALTY ONE GROUP Advantage", bold: true, size: 16, color: NEARBLACK, font: "Calibri" }), new TextRun({ text: "   ·   powered by Prism", italics: true, size: 16, color: GOLD, font: "Georgia" })] }),
        ...(agentLine ? [new Paragraph({ children: [new TextRun({ text: agentLine, size: 15, color: "7A7266", font: "Calibri" })] })] : []),
      ],
    });
    const header = new Header({
      children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: "Prepared by Realty ONE Group Advantage", size: 13, color: "B8B0A4", font: "Calibri" })] })],
    });

    const doc = new Document({
      creator: "PrismOS · Realty ONE Group Advantage",
      title: `Research — ${contact.name}`,
      styles: { default: { document: { run: { font: "Calibri" } } } },
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1200, right: 1200 } } },
        headers: { default: header },
        footers: { default: footer },
        children,
      }],
    });

    const buf = await Packer.toBuffer(doc);
    // base64 encode
    let binary = "";
    const bytes = new Uint8Array(buf);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
    }
    const base64 = btoa(binary);
    const safeName = String(contact.name || "contact").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
    const filename = `${safeName}-research${mode === "agent" ? "-prep" : ""}.docx`;

    return J({ ok: true, filename, base64 });
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
