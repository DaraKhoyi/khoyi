// docxNewsletter — the piece as a real Word document.
//
// Not HTML wearing a .doc extension. This produces genuine OOXML: real styles,
// real page setup, a real header and footer with page numbers, a real numbered
// source list. Word can edit it, Track Changes works, and it survives being
// re-saved — none of which is true of HTML renamed to .doc.
//
// It carries the same two refusals as the PDF path, because the file is the thing
// that escapes into the world:
//   - a failed compliance review is watermarked NOT APPROVED, with the findings
//   - the agent's byline never appears without the brokerage's licensed disclosure
//
// Prism Editorial PRINT standard: white page, near-black text, STATIC gold. The
// on-screen gold ramp and its motion are meaningless in a document.

import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle,
  Table, TableRow, TableCell, WidthType, ShadingType, PageNumber, Footer, Header,
  ExternalHyperlink, convertInchesToTwip,
} from "https://esm.sh/docx@8.5.0";

const INK = "100D09", GOLD = "9A7B2E", DGOLD = "9A8038", MUTED = "5D5648", RULE = "D9D2C2", WARN = "8A2B2B", WARNBG = "FBEEEE";
const SERIF = "Georgia";          // stands in for Fraunces, which Word will not have
const SANS = "Calibri";
const COND = "Arial Narrow";      // stands in for Barlow Condensed

const P = (text: string, o: any = {}) => new Paragraph({
  spacing: { after: o.after ?? 140, line: 288 },
  alignment: o.align,
  children: [new TextRun({ text, font: o.font ?? SANS, size: o.size ?? 22, color: o.color ?? INK, bold: !!o.b, italics: !!o.i })],
});

/** Inline markdown -> runs. Bold, italic and links only; the piece is prose. */
function runs(src: string, base: any = {}): any[] {
  const out: any[] = [];
  const re = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\))|(\*\*([^*]+)\*\*)|(\*([^*]+)\*)/g;
  let last = 0, m: RegExpExecArray | null;
  const push = (t: string, extra: any = {}) => {
    if (!t) return;
    out.push(new TextRun({ text: t, font: base.font ?? SANS, size: base.size ?? 22, color: base.color ?? INK, ...extra }));
  };
  while ((m = re.exec(src))) {
    push(src.slice(last, m.index));
    if (m[1]) {
      out.push(new ExternalHyperlink({
        link: m[3],
        children: [new TextRun({ text: m[2], font: base.font ?? SANS, size: base.size ?? 22, color: "7A5020", underline: {} })],
      }));
    } else if (m[4]) push(m[5], { bold: true });
    else if (m[6]) push(m[7], { italics: true });
    last = re.lastIndex;
  }
  push(src.slice(last));
  return out.length ? out : [new TextRun({ text: src, font: base.font ?? SANS, size: base.size ?? 22, color: base.color ?? INK })];
}

/** Block markdown -> paragraphs. */
function body(md: string): any[] {
  const out: any[] = [];
  for (const raw of String(md || "").split("\n")) {
    const l = raw.trim();
    if (!l) continue;
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      const lvl = h[1].length;
      out.push(new Paragraph({
        spacing: { before: lvl <= 2 ? 300 : 240, after: 110 },
        keepNext: true,
        border: lvl <= 2 ? { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 5 } } : undefined,
        children: [new TextRun({ text: h[2], font: SERIF, size: lvl <= 2 ? 30 : 25, color: INK })],
      }));
      continue;
    }
    const li = /^[-*]\s+(.*)$/.exec(l);
    if (li) {
      out.push(new Paragraph({ bullet: { level: 0 }, spacing: { after: 90, line: 288 }, children: runs(li[1]) }));
      continue;
    }
    out.push(new Paragraph({ spacing: { after: 150, line: 288 }, children: runs(l) }));
  }
  return out;
}

const warnBox = (title: string, lines: string[]) => new Table({
  width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
  borders: {
    top: { style: BorderStyle.SINGLE, size: 10, color: WARN }, bottom: { style: BorderStyle.SINGLE, size: 10, color: WARN },
    left: { style: BorderStyle.SINGLE, size: 10, color: WARN }, right: { style: BorderStyle.SINGLE, size: 10, color: WARN },
  },
  rows: [new TableRow({ children: [new TableCell({
    width: { size: 9360, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: WARNBG },
    margins: { top: 150, bottom: 150, left: 180, right: 180 },
    children: [
      new Paragraph({ spacing: { after: 70 }, children: [new TextRun({ text: title, font: SANS, size: 23, bold: true, color: WARN })] }),
      ...lines.map((t) => new Paragraph({ spacing: { after: 60, line: 280 }, children: [new TextRun({ text: t, font: SANS, size: 20, color: WARN })] })),
    ],
  })] })],
});

export async function buildNewsletterDocx(piece: any, agentName: string): Promise<Uint8Array> {
  const comp = piece.compliance || {};
  const passed = comp.pass !== false;
  const findings: any[] = Array.isArray(comp.findings) ? comp.findings : [];
  const published = piece.published_at
    ? new Date(piece.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const sources: any[] = Array.isArray(piece.sources) ? piece.sources : [];

  const children: any[] = [];

  if (!passed) {
    children.push(warnBox("NOT APPROVED — do not send or hand this out", [
      `The fair-housing review did not pass this piece${findings.length ? ` and raised ${findings.length} item${findings.length === 1 ? "" : "s"}` : ""}. Fix these before it goes anywhere.`,
      ...findings.slice(0, 8).map((f: any) => "• " + String(f.problem || f)),
    ]));
    children.push(P("", { after: 180 }));
  }
  if (!piece.published_at) {
    children.push(warnBox("DRAFT", ["This piece has not been published, so any link to it will not work yet."]));
    children.push(P("", { after: 180 }));
  }

  children.push(new Paragraph({
    spacing: { after: 60 },
    children: [new TextRun({ text: "REALTY ONE GROUP ADVANTAGE", font: COND, size: 19, bold: true, color: GOLD, characterSpacing: 60 })],
  }));
  children.push(new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: String(piece.title || ""), font: SERIF, size: 46, color: INK })],
  }));
  if (piece.dek) {
    children.push(new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: String(piece.dek), font: SERIF, size: 26, color: "4A4437", italics: true })],
    }));
  }
  // static gold rule — the on-screen animated ramp has no meaning on paper
  children.push(new Paragraph({
    spacing: { after: 140 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 14, color: GOLD, space: 2 } },
    children: [new TextRun({ text: "", size: 2 })],
  }));
  children.push(new Paragraph({
    spacing: { after: 240 },
    children: [new TextRun({ text: `By ${agentName}  ·  ${published}`, font: COND, size: 20, bold: true, color: MUTED, characterSpacing: 30 })],
  }));

  children.push(...body(piece.body_md || ""));

  if (sources.length) {
    children.push(new Paragraph({
      spacing: { before: 340, after: 110 }, keepNext: true,
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 5 } },
      children: [new TextRun({ text: "Sources", font: SERIF, size: 30, color: INK })],
    }));
    sources.forEach((s: any, i: number) => {
      const bits: any[] = [
        new TextRun({ text: `${i + 1}. `, font: SANS, size: 19, bold: true, color: MUTED }),
        new TextRun({ text: String(s.publisher || "Source"), font: SANS, size: 19, bold: true, color: INK }),
      ];
      if (s.date) bits.push(new TextRun({ text: `  ·  ${s.date}`, font: SANS, size: 19, color: MUTED }));
      children.push(new Paragraph({ spacing: { after: 40, line: 276 }, children: bits }));
      if (s.claim) children.push(P(String(s.claim), { size: 19, color: MUTED, after: 40 }));
      if (s.url) {
        children.push(new Paragraph({
          spacing: { after: 130 },
          children: [new ExternalHyperlink({ link: String(s.url), children: [new TextRun({ text: String(s.url), font: SANS, size: 17, color: "7A5020", underline: {} })] })],
        }));
      }
    });
  }

  children.push(new Paragraph({
    spacing: { before: 380, after: 80 },
    border: { top: { style: BorderStyle.SINGLE, size: 10, color: GOLD, space: 10 } },
    children: [
      new TextRun({ text: "REALTY", font: COND, size: 21, bold: true, color: INK, characterSpacing: 30 }),
      new TextRun({ text: "ONE", font: COND, size: 21, bold: true, color: GOLD, characterSpacing: 30 }),
      new TextRun({ text: "GROUP Advantage   ", font: COND, size: 21, bold: true, color: INK, characterSpacing: 30 }),
      new TextRun({ text: "powered by Prism", font: SERIF, size: 19, italics: true, color: DGOLD }),
    ],
  }));
  children.push(P(
    `Written by ${agentName}, licensed real estate agent, Realty ONE Group Advantage — Tampa / Lutz, Florida. ` +
    `Figures are drawn from the sources listed above as at the date of publication and will change as conditions do. ` +
    `Nothing here is legal, tax, or insurance advice, and nothing here is an offer of representation or a solicitation of property already listed with another broker.`,
    { size: 17, color: MUTED, i: true },
  ));

  const doc = new Document({
    creator: agentName,
    title: String(piece.title || "Newsletter"),
    description: "Realty ONE Group Advantage · powered by Prism",
    styles: { default: { document: { run: { font: SANS, size: 22, color: INK } } } },
    sections: [{
      properties: {
        page: {
          size: { width: convertInchesToTwip(8.5), height: convertInchesToTwip(11) },
          margin: { top: convertInchesToTwip(0.9), bottom: convertInchesToTwip(0.9), left: convertInchesToTwip(0.9), right: convertInchesToTwip(0.9) },
        },
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
          children: [new TextRun({ text: String(piece.title || ""), font: SANS, size: 16, color: MUTED })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({ text: `${agentName} · Realty ONE Group Advantage · Page `, font: SANS, size: 16, color: MUTED }),
            new TextRun({ children: [PageNumber.CURRENT], font: SANS, size: 16, color: MUTED }),
            new TextRun({ text: " of ", font: SANS, size: 16, color: MUTED }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: SANS, size: 16, color: MUTED }),
          ],
        })] }),
      },
      children,
    }],
  });

  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
