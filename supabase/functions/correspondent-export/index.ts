// correspondent-export — the finished piece as a branded newsletter, for print or
// for Word.
//
//   ?t=<piece_id>&format=pdf   print-ready page, Save as PDF from the browser
//   ?t=<piece_id>&format=doc   downloads and opens in Microsoft Word, editable
//
// TWO THINGS THIS REFUSES TO DO, and they are the reason it is a server function
// rather than a print stylesheet on the existing page:
//
// 1. IT WILL NOT MAKE A FAILED COMPLIANCE REVIEW LOOK FINISHED. If the review did
//    not pass, the export is watermarked NOT APPROVED and lists what was flagged,
//    on the page itself. A polished PDF is the form in which a piece escapes into
//    the world — printed at an open house, attached to an email, handed to a
//    client. It must not be possible to produce a clean-looking one from a piece
//    the reviewer rejected.
//
// 2. IT WILL NOT PUBLISH AN AGENT'S NAME WITHOUT THE BROKERAGE'S. Florida requires
//    licensed advertising to carry the brokerage name, and the settled design has
//    the AGENT as author with the brokerage as host. So every page carries both:
//    the agent's byline and the Realty ONE Group Advantage mark plus the licensed
//    disclosure. It is not a toggle.
//
// Branding follows the Prism Editorial PRINT standard, which is a different thing
// from the on-screen one: white page, near-black text, motion frozen, gold static
// rather than the animated ramp. A moving gradient is meaningless on paper.
//
// Sources are printed in full with their per-claim attribution. The whole promise
// of the research engine is that a claim can be checked; a newsletter that drops
// the citations breaks that promise at exactly the moment a reader might act.
//
// verify_jwt: false — called with the agent's JWT and scoped by it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Markdown to HTML — headings, bold, italic, lists, links, paragraphs. Deliberately
// small: the piece is prose, not a document format.
function md(src: string): string {
  const lines = String(src || "").split("\n");
  const out: string[] = [];
  let inList = false;
  const inline = (t: string) =>
    esc(t)
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { if (inList) { out.push("</ul>"); inList = false; } continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { if (inList) { out.push("</ul>"); inList = false; } const n = Math.min(h[1].length + 1, 4); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    const li = /^[-*]\s+(.*)$/.exec(l);
    if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${inline(l)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

function page(piece: any, agentName: string, forWord: boolean): string {
  const comp = piece.compliance || {};
  const passed = comp.pass !== false;
  const findings: any[] = Array.isArray(comp.findings) ? comp.findings : [];
  const published = piece.published_at
    ? new Date(piece.published_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const sources: any[] = Array.isArray(piece.sources) ? piece.sources : [];

  // Word reads a subset of CSS and ignores @page rules and flex, so the Word
  // variant is laid out with margins and borders only. Trying to share one
  // stylesheet produces a document that looks broken in Word, which is worse than
  // a plainer one that looks deliberate.
  const css = forWord ? `
    body{font-family:Georgia,serif;color:#100D09;font-size:11.5pt;line-height:1.55;margin:0}
    .wrap{width:6.5in;margin:0 auto}
    .eyebrow{font-family:Arial,sans-serif;font-size:8.5pt;font-weight:bold;color:#9A7B2E;letter-spacing:2px}
    h1{font-family:Georgia,serif;font-size:24pt;font-weight:normal;margin:6pt 0 4pt}
    .dek{font-size:13pt;color:#5D5648;font-style:italic;margin:0 0 10pt}
    .rule{border-top:2pt solid #9A7B2E;width:64pt;margin:8pt 0 14pt}
    h2{font-family:Georgia,serif;font-size:14pt;font-weight:normal;margin:16pt 0 5pt}
    h3{font-family:Georgia,serif;font-size:12.5pt;margin:14pt 0 4pt}
    p{margin:0 0 9pt}
    .byline{font-family:Arial,sans-serif;font-size:9.5pt;color:#5D5648;margin:0 0 14pt}
    .srcs{font-family:Arial,sans-serif;font-size:8.5pt;color:#5D5648}
    .srcs li{margin:0 0 5pt}
    .foot{border-top:1pt solid #D9D2C2;margin-top:18pt;padding-top:8pt;font-family:Arial,sans-serif;font-size:8pt;color:#5D5648}
    .warn{border:1.5pt solid #8A2B2B;background:#FBEEEE;padding:9pt 11pt;margin:0 0 14pt;font-family:Arial,sans-serif;font-size:9.5pt;color:#8A2B2B}
    .mark{font-family:Arial,sans-serif;font-size:9.5pt;font-weight:bold;letter-spacing:1px}
  ` : `
    @page{size:Letter;margin:18mm 16mm 20mm}
    *{box-sizing:border-box}
    body{margin:0;background:#fff;color:#100D09;font-family:Manrope,-apple-system,system-ui,sans-serif;
      font-size:11.5pt;line-height:1.62;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .wrap{max-width:760px;margin:0 auto;padding:26px 22px 60px}
    .eyebrow{font-family:'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:.24em;
      font-size:10.5pt;font-weight:700;color:#9A7B2E}
    h1{font-family:Fraunces,Georgia,serif;font-weight:300;font-size:27pt;line-height:1.15;margin:6px 0 6px}
    .dek{font-family:Fraunces,Georgia,serif;font-size:13.5pt;line-height:1.5;font-weight:300;color:#4a4437;margin:0 0 10px}
    .rule{height:2px;background:#9A7B2E;width:64px;margin:12px 0 18px}
    h2{font-family:Fraunces,Georgia,serif;font-weight:400;font-size:15pt;margin:24px 0 7px;
      padding-bottom:5px;border-bottom:1px solid #d9d2c2;break-after:avoid}
    h3{font-family:Fraunces,Georgia,serif;font-weight:400;font-size:12.5pt;margin:16px 0 4px;break-after:avoid}
    p{margin:0 0 10px}ul{margin:8px 0 10px 20px}li{margin:4px 0}
    a{color:#7A5020}
    .byline{font-family:'Barlow Condensed',Arial,sans-serif;text-transform:uppercase;letter-spacing:.14em;
      font-size:10pt;font-weight:700;color:#5D5648;margin:0 0 16px}
    .srcs{font-size:9.5pt;color:#5D5648}
    .srcs li{margin:0 0 6px;break-inside:avoid}
    .foot{margin-top:30px;padding-top:12px;border-top:1px solid #d9d2c2;color:#5D5648;font-size:9pt}
    .warn{border:1px solid #8A2B2B;background:#FBEEEE;border-radius:6px;padding:12px 15px;margin:0 0 18px;
      font-size:10pt;color:#8A2B2B}
    .mark{font-family:'Barlow Condensed',Arial,sans-serif;font-weight:700;letter-spacing:.08em;font-size:11pt}
    .mark .one{color:#9A7B2E}
    .mark .prism{font-family:Fraunces,Georgia,serif;font-style:italic;font-weight:400;letter-spacing:0;color:#8a7434}
    .noprint{margin:0 0 20px}
    button{font-family:inherit;font-size:11pt;font-weight:700;background:#100D09;color:#fff;border:none;
      border-radius:8px;padding:11px 20px;cursor:pointer}
    @media print{.noprint{display:none!important}}
  `;

  const fonts = forWord ? "" :
    '<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Barlow+Condensed:wght@700&family=Manrope:wght@400;500;700&display=swap" rel="stylesheet">';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(piece.title || "Newsletter")}</title>${fonts}
<style>${css}</style></head><body><div class="wrap">

${forWord ? "" : `<div class="noprint">
  <button onclick="window.print()">Save as PDF / Print</button>
  <span style="margin-left:10px;color:#5D5648;font-size:10.5pt">On iPhone: Share &rarr; Print &rarr; pinch out to get the PDF.</span>
</div>`}

${!passed ? `<div class="warn"><strong>NOT APPROVED — do not send or hand out.</strong><br>
The compliance review did not pass this piece${findings.length ? ` and raised ${findings.length} item${findings.length === 1 ? "" : "s"}` : ""}. Fix these first:
${findings.length ? `<ul style="margin:8px 0 0 18px">${findings.slice(0, 8).map((f: any) => `<li>${esc(f.problem || f)}</li>`).join("")}</ul>` : ""}
</div>` : ""}
${!piece.published_at ? `<div class="warn"><strong>DRAFT</strong> — this piece has not been published yet, so any link to it will not work.</div>` : ""}

<div class="eyebrow">Realty ONE Group Advantage</div>
<h1>${esc(piece.title || "")}</h1>
${piece.dek ? `<div class="dek">${esc(piece.dek)}</div>` : ""}
<div class="rule"></div>
<div class="byline">By ${esc(agentName)} &nbsp;&middot;&nbsp; ${esc(published)}</div>

${md(piece.body_md || "")}

${sources.length ? `<h2>Sources</h2>
<ol class="srcs">${sources.map((s: any) => `<li><strong>${esc(s.publisher || "")}</strong>${s.date ? ` &middot; ${esc(s.date)}` : ""}${s.claim ? `<br>${esc(s.claim)}` : ""}${s.url ? `<br><span style="word-break:break-all">${esc(s.url)}</span>` : ""}</li>`).join("")}</ol>` : ""}

<div class="foot">
<div class="mark">REALTY<span class="one">ONE</span>GROUP Advantage &nbsp;<span class="prism">powered by Prism</span></div>
<p style="margin-top:7px">Written by ${esc(agentName)}, licensed real estate agent, Realty ONE Group Advantage &mdash; Tampa / Lutz, Florida. Figures are drawn from the sources listed above as at the date of publication and will change as conditions do. Nothing here is legal, tax, or insurance advice, and nothing here is an offer of representation or a solicitation of property already listed with another broker.</p>
</div>

</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const id = url.searchParams.get("t") || "";
  const format = (url.searchParams.get("format") || "pdf").toLowerCase();
  const auth = req.headers.get("Authorization") || "";
  const html = { ...cors, "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };

  if (!id || !auth) return new Response("<p>Missing piece or authorization.</p>", { status: 400, headers: html });

  // Scoped as the CALLER, so an agent can only export their own work.
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: piece } = await asUser.from("correspondent_pieces").select("*").eq("id", id).maybeSingle();
  if (!piece) return new Response("<p>That piece isn't available to you.</p>", { status: 404, headers: html });
  if (piece.no_story) {
    return new Response(`<p>There was no story here: ${esc(piece.no_story_reason || "")}</p>`, { status: 400, headers: html });
  }

  const { data: agent } = await asUser.from("agents").select("name").eq("auth_user_id", piece.user_id).maybeSingle();
  const agentName = agent?.name || "Realty ONE Group Advantage";

  const forWord = format === "doc" || format === "docx" || format === "word";
  const body = page(piece, agentName, forWord);

  if (forWord) {
    const safe = String(piece.slug || piece.title || "newsletter").replace(/[^a-z0-9\-]+/gi, "-").slice(0, 60);
    return new Response(body, {
      headers: {
        ...cors,
        "content-type": "application/msword; charset=utf-8",
        "content-disposition": `attachment; filename="${safe}.doc"`,
        "cache-control": "no-store",
      },
    });
  }
  return new Response(body, { headers: html });
});
