// unstuck-portal — the seller's private page for an Unstuck. report.
//
// Reached by a signed link the agent sends. No login: portal_token is a bearer
// credential, same pattern as investor-portal.
//
// Rules that are NOT negotiable (UNSTUCK-SPEC.md):
//  - NOTHING is visible until the agent explicitly releases the report. Before
//    that this page says so and offers nothing else.
//  - Redaction happens in SQL (unstuck_portal_get), not here. The agent report,
//    the say-this script, agent-eyes-only findings and the SOURCED/DERIVED/
//    ASSUMED audit tags never leave the database.
//  - NO "live" language. There is no MLS feed, so this page says when it was last
//    reviewed and nothing more. Weekly re-runs are Phase 3.
//  - Uncorrectable defects ARE shown, once, with their number, immediately
//    followed by the lever the seller controls. A report that lists only fixable
//    things is a comfortable report, not a true one.
//
// verify_jwt: false (public page).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" };
const money = (n: unknown) =>
  (n === null || n === undefined || n === "") ? "" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

// Minimal, deliberate markdown: headings, bold, lists, paragraphs. We are not
// pulling a parser into an edge function for this.
function md(src: string): string {
  const lines = String(src || "").split("\n");
  const out: string[] = [];
  let inList = false;
  const inline = (t: string) =>
    esc(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*]+)\*/g, "<i>$1</i>");
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) { if (inList) { out.push("</ul>"); inList = false; } continue; }
    const h = l.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      if (inList) { out.push("</ul>"); inList = false; }
      const lvl = Math.min(4, h[1].length);
      out.push(`<h${lvl === 1 ? 2 : 3} class="mdh">${inline(h[2])}</h${lvl === 1 ? 2 : 3}>`);
      continue;
    }
    const li = l.match(/^[-*]\s+(.*)$/);
    if (li) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p>${inline(l)}</p>`);
  }
  if (inList) out.push("</ul>");
  return out.join("\n");
}

const KIND_TITLE: Record<string, string> = {
  correctable_cheap: "Quick wins",
  correctable_costly: "Worth considering",
  uncorrectable: "What we can't change — and how we handle it",
  payment: "What buyers can actually afford",
  exposure: "Who is seeing your home",
  insurability: "Insurance & financing",
  market: "The market right now",
};
const KIND_ORDER = ["exposure", "payment", "insurability", "correctable_cheap", "correctable_costly", "market", "uncorrectable"];

function shell(inner: string, title: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark"><title>${esc(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Barlow+Condensed:wght@600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--gold:#C5A95E;--champ:#EBCB82;--ink:#100D09;--card:#1B1610;--line:rgba(203,169,94,.22);
 --text:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475}
*{box-sizing:border-box}
body{margin:0;font-family:Manrope,-apple-system,system-ui,sans-serif;color:var(--text);
 background:radial-gradient(120% 25% at 50% 0,rgba(203,163,92,.10),transparent 60%),var(--ink);padding:0 0 70px;line-height:1.6}
.wrap{max-width:640px;margin:0 auto;padding:28px 20px}
.eyebrow{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.22em;font-size:12px;font-weight:700;color:var(--gold)}
h1{font-family:Fraunces,serif;font-weight:300;font-size:31px;margin:5px 0 6px;line-height:1.2}
h2.mdh{font-family:Fraunces,serif;font-weight:400;font-size:21px;margin:26px 0 8px;color:var(--text)}
h3.mdh{font-family:Fraunces,serif;font-weight:400;font-size:17.5px;margin:20px 0 6px;color:var(--champ)}
.sub{color:var(--text-2);font-size:14.5px}
.hair{height:1px;background:linear-gradient(90deg,transparent,rgba(203,163,92,.55),transparent);margin:26px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px 17px;margin-bottom:11px}
.card.flat{background:rgba(255,255,255,.03)}
p{margin:9px 0;color:var(--text-2);font-size:15px}
ul{margin:9px 0 9px 18px;padding:0}li{color:var(--text-2);font-size:15px;margin:5px 0}
.ftitle{font-size:15.5px;font-weight:700;color:var(--text);margin:0}
.fdetail{font-size:14px;color:var(--text-2);margin-top:5px}
.fmeta{font-size:12.5px;color:var(--text-3);margin-top:7px}
.tag{display:inline-block;font-size:11px;border-radius:20px;padding:3px 9px;font-weight:700;
 background:rgba(203,163,92,.18);color:var(--champ)}
.done{opacity:.55}
.note{font-size:12.5px;color:var(--text-3);line-height:1.6}
.center{text-align:center}
</style></head><body><div class="wrap">${inner}</div></body></html>`;
}

const plain = (title: string, body: string) =>
  new Response(shell(`<div class="card center" style="padding:44px 22px">
<h1>${esc(title)}</h1><p class="note" style="max-width:420px;margin:10px auto 0">${esc(body)}</p></div>`, title),
    { headers: HTML });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "access-control-allow-origin": "*" } });
  const token = new URL(req.url).searchParams.get("t") || "";
  if (!token) return plain("This link isn't active.", "Please ask your agent for a fresh link.");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await admin.rpc("unstuck_portal_get", { p_token: token });

  if (error || !data || !data.ok) {
    if (data && data.error === "not_released") {
      return plain("Not quite ready.",
        "Your agent is still finishing this review. They'll let you know the moment it's ready — this same link will work then.");
    }
    return plain("This link isn't active.", "Please ask your agent for a fresh link.");
  }

  const findings: any[] = Array.isArray(data.findings) ? data.findings : [];
  const reviewed = data.reviewed_at
    ? new Date(data.reviewed_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "";

  const groups = KIND_ORDER
    .map((k) => ({ k, rows: findings.filter((f) => f.kind === k) }))
    .filter((g) => g.rows.length);

  const findingsHtml = groups.map(({ k, rows }) => `
<h3 class="mdh">${esc(KIND_TITLE[k] || k)}</h3>
${rows.map((f) => `<div class="card${f.status === "done" ? " done" : ""}">
  <p class="ftitle">${esc(f.title)}</p>
  ${f.detail ? `<div class="fdetail">${esc(f.detail)}</div>` : ""}
  <div class="fmeta">
    ${f.dollar_impact ? `<span class="tag">${money(Math.abs(Number(f.dollar_impact)))}</span> ` : ""}
    ${f.effort ? esc(f.effort) : ""}${f.status === "done" ? " · handled" : ""}
  </div>
</div>`).join("")}
${k === "uncorrectable" ? `<p class="note">These are the parts of the property no amount of work changes. We can't remove them, so the honest move is to account for them in how the home is priced and positioned — that's the part still fully in your control.</p>` : ""}
`).join("");

  const sources = data.public_sources && (data.public_sources.note || data.public_sources.summary);

  const inner = `
<div class="eyebrow">Unstuck.</div>
<h1>${esc(data.address)}</h1>
<div class="sub">A working review of what's holding your sale up${data.city ? `, prepared by ${esc(data.agent_name)}` : ""}.</div>
${reviewed ? `<p class="note" style="margin-top:10px">Last reviewed ${esc(reviewed)}.</p>` : ""}

<div class="hair"></div>
${md(data.seller_report || "")}

${sources ? `<div class="hair"></div>
<h3 class="mdh">What you may have seen online</h3>
<div class="card flat"><div class="fdetail">${esc(sources)}</div></div>` : ""}

${findings.length ? `<div class="hair"></div>
<div class="eyebrow">The detail</div>
<h2 class="mdh" style="margin-top:4px">Everything we're working on.</h2>
${findingsHtml}` : ""}

<div class="hair"></div>
<p class="note">Questions on any of this belong in a conversation, not an email — call ${esc(data.agent_name)} and talk it through. This page updates as the review is refreshed.</p>`;

  return new Response(shell(inner, "Unstuck. — " + String(data.address || "")), { headers: HTML });
});
