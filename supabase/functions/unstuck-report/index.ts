// unstuck-report — the printable Unstuck. report, in two audiences.
//
// ?t=<listing_id>&audience=client|agent   (called with the agent's JWT)
//
// WHY TWO DOCUMENTS, AND WHY THEY DIFFER
// The client report is handed to a homeowner in a listing presentation. The agent
// report is working material. They are not the same document with a different
// header: the agent version carries the say-this script, the agent-only findings,
// the negotiation posture and the raw SOURCED/DERIVED/ASSUMED evidence tags. None
// of that belongs in a seller's hands.
//
// HOW THE AGENT IS POSITIONED — this is the part that is easy to get wrong.
// We do NOT print "so-and-so specialises in hard-to-sell homes". That is a claim
// every brochure makes, sellers discount it instantly, it may not be true, and an
// unsubstantiated superiority claim is a real-estate advertising compliance
// problem. Instead:
//   1. The ANALYSIS is the credential. A seller reading reset-millage payment
//      math, a search-band cliff and an honestly-priced uncorrectable defect
//      concludes on their own that this agent is not like the others. A
//      conclusion they reach themselves outperforms one we assert.
//   2. Where we do speak about the agent, every number is MEASURED from closed
//      transactions via unstuck_agent_credentials. Specific and checkable.
//   3. If the agent has thin production, the copy shifts to brokerage strength
//      rather than printing a hollow boast.
//
// NEVER criticise the previous agent. A stalled listing usually sat with another
// brokerage; NAR Article 15 forbids misleading statements about competitors, and
// beyond the rule the seller HIRED that person, so blaming them implies the
// seller chose badly. Findings are framed as what the market is saying.
//
// Print styling follows the Prism Editorial PRINT standard: white background,
// near-black text, motion frozen, static gold.
//
// verify_jwt: false — we forward the caller's JWT to Supabase ourselves.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" };
const money = (n: unknown) =>
  (n === null || n === undefined || n === "" || isNaN(Number(n))) ? "" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
const compact = (n: number) =>
  n >= 1e6 ? "$" + (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? "$" + Math.round(n / 1e3) + "K" : "$" + n;

// SOURCED / DERIVED / ASSUMED are an INTERNAL audit device. The prompt asks for
// them so the agent can check the model's work — but the model also writes them
// inline in the seller report prose, and a homeowner reading "(ASSUMED)" in their
// own listing report is being shown our workings, not our conclusion. Stripped
// deterministically here rather than trusted to the prompt, same reasoning as the
// seller_safe backstop in unstuck-analyze.
function stripAuditTags(src: string): string {
  return String(src || "")
    .replace(/\s*\((?:SOURCED|DERIVED|ASSUMED)[^)]*\)/g, "")
    .replace(/^\s*(?:SOURCED|DERIVED|ASSUMED)\s*:\s*/gim, "")
    .replace(/\s*\[(?:SOURCED|DERIVED|ASSUMED)[^\]]*\]/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

function md(src: string): string {
  const lines = String(src || "").split("\n");
  const out: string[] = [];
  let inList = false;
  const inline = (t: string) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { if (inList) { out.push("</ul>"); inList = false; } continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) { if (inList) { out.push("</ul>"); inList = false; } out.push(`<h3>${inline(h[2])}</h3>`); continue; }
    const li = l.match(/^[-*]\s+(.*)$/);
    if (li) { if (!inList) { out.push("<ul>"); inList = true; } out.push(`<li>${inline(li[1])}</li>`); continue; }
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${inline(l)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

const KIND_CLIENT: Record<string, string> = {
  exposure: "Who is seeing the home",
  payment: "What buyers can actually afford",
  insurability: "Insurance &amp; financing",
  correctable_cheap: "Quick wins",
  correctable_costly: "Worth considering",
  market: "The market right now",
  uncorrectable: "What we can&rsquo;t change &mdash; and how we price for it",
};
const KIND_AGENT: Record<string, string> = { ...KIND_CLIENT, uncorrectable: "Uncorrectable &mdash; must be priced" };
const ORDER = ["exposure", "payment", "insurability", "correctable_cheap", "correctable_costly", "market", "uncorrectable"];

function credLine(c: any): string {
  const a = c?.agent || {}, b = c?.brokerage || {};
  const name = esc(c?.agent_name || "Your agent");
  const t = c?.tier;
  const cities = Array.isArray(a.cities) && a.cities.length
    ? ` across ${a.cities.slice(0, 3).map((x: string) => esc(x)).join(", ")}` : "";
  if (t === "established") {
    return `<p><b>${name}</b> has closed <b>${a.txns}</b> transactions since the start of 2025 &mdash;
      <b>${compact(Number(a.volume) || 0)}</b> in volume${cities}, averaging ${money(a.avg_price)} a home.
      Behind that sits Realty ONE Group Advantage: <b>${b.txns}</b> closings and
      <b>${compact(Number(b.volume) || 0)}</b> across ${b.agents} agents in the same period.</p>`;
  }
  if (t === "active") {
    return `<p><b>${name}</b> has closed <b>${a.txns}</b> transactions since the start of 2025${cities},
      backed by a brokerage that has closed <b>${b.txns}</b> in the same period &mdash;
      <b>${compact(Number(b.volume) || 0)}</b> across ${b.agents} agents. Every comparable sale, lender
      relationship and title contact in that book is available to this listing.</p>`;
  }
  return `<p><b>${name}</b> works inside Realty ONE Group Advantage, which has closed
    <b>${b.txns}</b> transactions and <b>${compact(Number(b.volume) || 0)}</b> since the start of 2025
    across ${b.agents} agents. That book of comparable sales, lender relationships and title contacts
    is what stands behind the analysis in these pages.</p>`;
}

function page(d: any, findings: any[], cred: any, audience: string): string {
  const isClient = audience === "client";
  const KIND = isClient ? KIND_CLIENT : KIND_AGENT;
  const rows = findings.filter((f) => (isClient ? f.seller_safe !== false : true) && f.status !== "dismissed");
  const groups = ORDER.map((k) => ({ k, items: rows.filter((f) => f.kind === k) })).filter((g) => g.items.length);
  const reviewed = d.reviewed_at
    ? new Date(d.reviewed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const agentName = esc(cred?.agent_name || "Your agent");

  const findingsHtml = groups.map(({ k, items }) => `
<h2>${KIND[k] || k}</h2>
${items.map((f) => `<div class="finding">
  <div class="ft">${esc(isClient ? stripAuditTags(f.title) : f.title)}${f.dollar_impact ? `<span class="impact">${money(Math.abs(Number(f.dollar_impact)))}</span>` : ""}</div>
  ${f.detail ? `<div class="fd">${esc(isClient ? stripAuditTags(f.detail) : f.detail)}</div>` : ""}
  ${(!isClient && f.evidence) ? `<div class="fe">${esc(f.evidence)}</div>` : ""}
  ${f.effort ? `<div class="fm">${esc(f.effort)}</div>` : ""}
</div>`).join("")}
${k === "uncorrectable" ? `<p class="note">These are the parts of the property that no amount of work changes. Since they can&rsquo;t be repaired, the honest response is to account for them in price and positioning &mdash; which is the part still entirely within your control.</p>` : ""}
`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${isClient ? "Why It Hasn&rsquo;t Sold" : "Unstuck. &mdash; agent analysis"} &mdash; ${esc(d.address)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Barlow+Condensed:wght@600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@page { size: Letter; margin: 18mm 16mm 20mm; }
:root{--gold:#9A7B2E;--ink:#100D09;--rule:#d9d2c2;--muted:#5d5648}
*{box-sizing:border-box}
body{margin:0;background:#fff;color:var(--ink);font-family:Manrope,-apple-system,system-ui,sans-serif;
 font-size:11.5pt;line-height:1.62;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.wrap{max-width:760px;margin:0 auto;padding:26px 22px 60px}
.eyebrow{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.24em;
 font-size:10.5pt;font-weight:700;color:var(--gold)}
h1{font-family:Fraunces,Georgia,serif;font-weight:300;font-size:27pt;line-height:1.15;margin:6px 0 4px}
h2{font-family:Fraunces,Georgia,serif;font-weight:400;font-size:15pt;margin:26px 0 8px;
 padding-bottom:5px;border-bottom:1px solid var(--rule);break-after:avoid}
h3{font-family:Fraunces,Georgia,serif;font-weight:400;font-size:12.5pt;margin:16px 0 5px;break-after:avoid}
p{margin:8px 0}ul{margin:8px 0 8px 20px}li{margin:4px 0}
.sub{color:var(--muted);font-size:11pt}
.rule{height:2px;background:var(--gold);margin:14px 0 4px;width:64px}
.lede{font-family:Fraunces,Georgia,serif;font-size:13.5pt;line-height:1.5;font-weight:300;margin:16px 0 6px}
.box{border:1px solid #9A8038;background:#FBF6E9;border-radius:6px;padding:13px 16px;margin:16px 0;break-inside:avoid}
.finding{break-inside:avoid;margin:10px 0;padding-left:12px;border-left:2px solid var(--rule)}
.ft{font-weight:700;font-size:11.5pt}
.impact{float:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;color:var(--gold);letter-spacing:.04em}
.fd{color:#332f28;margin-top:3px}
.fe{color:var(--muted);font-size:9.5pt;font-style:italic;margin-top:4px}
.fm{color:var(--muted);font-size:9.5pt;margin-top:3px}
.note{color:var(--muted);font-size:10.5pt;font-style:italic}
.cred{border-top:2px solid var(--gold);padding-top:14px;margin-top:30px;break-inside:avoid}
.mark{font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.08em;font-size:12pt}
.mark .one{color:var(--gold)}
.mark .prism{font-family:Fraunces,Georgia,serif;font-style:italic;font-weight:400;letter-spacing:0;color:#8a7434}
.foot{margin-top:34px;padding-top:12px;border-top:1px solid var(--rule);color:var(--muted);font-size:9.5pt}
.conf{background:#f3efe4;border:1px dashed #9A8038;border-radius:6px;padding:9px 13px;margin:0 0 16px;
 font-size:10pt;color:#5a4a1e;font-weight:600}
.noprint{margin:0 0 18px}
button{font-family:inherit;font-size:11pt;font-weight:700;background:var(--ink);color:#fff;border:none;
 border-radius:8px;padding:11px 20px;cursor:pointer}
@media print{.noprint{display:none!important}}
</style></head><body><div class="wrap">

<div class="noprint">
  <button onclick="window.print()">Save as PDF / Print</button>
  <span class="sub" style="margin-left:10px">On iPhone: tap Share &rarr; Print &rarr; pinch out to get the PDF.</span>
</div>

${isClient ? "" : `<div class="conf">AGENT COPY &mdash; internal working document. Contains strategy notes and evidence tags. Do not hand this version to the seller.</div>`}

<div class="eyebrow">${isClient ? "Prepared for the owner of" : "Unstuck. &mdash; agent analysis"}</div>
<h1>${esc(d.address)}</h1>
<div class="rule"></div>
<div class="sub">${[esc(d.city), d.list_price ? "Listed at " + money(d.list_price) : "", "Reviewed " + esc(reviewed)].filter(Boolean).join(" &nbsp;&middot;&nbsp; ")}</div>

${isClient ? `<p class="lede">This is not a pitch. It is the same analysis ${agentName} would run before taking the listing &mdash; the payment a real buyer faces, who is seeing the home and who isn&rsquo;t, what can be fixed, and what can&rsquo;t and therefore has to be priced.</p>
<div class="box"><b>A note on what follows.</b> Some of it is uncomfortable. A report that lists only the fixable things is a comfortable report, not a true one &mdash; and a comfortable report is why a home sits. Nothing here is a comment on anyone&rsquo;s effort so far; it is what the market is currently saying.</div>` : ""}

${d.diagnosis ? `<h2>The diagnosis</h2><p class="lede" style="margin-top:4px">${esc(isClient ? stripAuditTags(d.diagnosis) : d.diagnosis)}</p>` : ""}

${(!isClient && d.say_this) ? `<h2>What to say</h2><div class="box">${md(d.say_this)}</div>` : ""}

${isClient
      ? (d.seller_report ? `<h2>What we found</h2>${md(stripAuditTags(d.seller_report))}` : "")
      : (d.agent_report ? `<h2>Full analysis</h2>${md(d.agent_report)}` : "")}

${d.public_sources && (d.public_sources.note || d.public_sources.summary)
      ? `<h2>What you may have seen online</h2><p>${esc(isClient ? stripAuditTags(d.public_sources.note || d.public_sources.summary) : (d.public_sources.note || d.public_sources.summary))}</p>` : ""}

${findingsHtml}

${isClient ? `<div class="cred">
<div class="eyebrow">Who is behind this analysis</div>
<h2 style="border:none;margin-top:6px;padding:0">The work above is the credential.</h2>
<p>Any agent can promise a faster sale. The pages before this one are what the promise
actually looks like: the buyer&rsquo;s real monthly payment at the taxes a <i>new</i> owner pays,
where the asking price falls against the brackets buyers actually search in, which
findings are worth money and which simply have to be priced in.</p>
${credLine(cred)}
<p>If that is the way you want this home represented, the next conversation is a short one.</p>
</div>` : ""}

<div class="foot">
<div class="mark">REALTY<span class="one">ONE</span>GROUP Advantage &nbsp;<span class="prism">powered by Prism</span></div>
<p style="margin-top:6px">${isClient
      ? "Prepared " + esc(reviewed) + " by " + agentName + ". Figures are drawn from public sources and current market data at the date of preparation and will move as the market does. Nothing here is legal, tax or insurance advice &mdash; where those matter, we will tell you who to ask."
      : "AGENT COPY. Contains agent-only findings and evidence tags. Prepared " + esc(reviewed) + "."}</p>
</div>

</div></body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, apikey" } });
  }
  const url = new URL(req.url);
  const id = url.searchParams.get("t") || "";
  const audience = (url.searchParams.get("audience") || "client").toLowerCase() === "agent" ? "agent" : "client";
  const auth = req.headers.get("Authorization") || "";
  if (!id || !auth) return new Response("<p>Missing listing or authorization.</p>", { status: 400, headers: HTML });

  // Call as the SIGNED-IN AGENT, not the service role, so the existing RLS and
  // ownership checks on unstuck_get still decide what this person may see.
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });

  const { data, error } = await asUser.rpc("unstuck_get", { p_id: id });
  if (error || !data || !data.ok) {
    return new Response("<p>That listing isn't available to you.</p>", { status: 404, headers: HTML });
  }
  const runs = data.runs || [];
  const run = runs.find((r: any) => r.status === "done") || null;
  if (!run) {
    return new Response("<p>Run the analysis before creating a report.</p>", { status: 400, headers: HTML });
  }

  const { data: cred } = await asUser.rpc("unstuck_agent_credentials", { p_user: data.listing.user_id });

  const merged = {
    address: data.listing.address, city: data.listing.city, list_price: data.listing.list_price,
    reviewed_at: run.created_at, diagnosis: run.diagnosis, seller_report: run.seller_report,
    agent_report: run.agent_report, say_this: run.say_this, public_sources: run.public_sources,
  };
  return new Response(page(merged, data.findings || [], cred || {}, audience), { headers: HTML });
});
