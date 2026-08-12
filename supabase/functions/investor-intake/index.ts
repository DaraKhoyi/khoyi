// investor-intake -- the public, no-auth investor questionnaire an agent shares.
// GET  ?t=<token>  -> serves the branded, mobile-first form (agent resolved from token).
// POST ?t=<token>  -> creates a buy-box OWNED BY THE AGENT (source=self_intake) and
//                     pushes the agent "New investor signed up".
// verify_jwt=false (public).
//
// HARD-WON: two things must be true or the page shows as raw source / mojibake:
//   1) Response header MUST be "text/html; charset=utf-8" (NOT text/plain -- the
//      edge runtime defaults a bare string to text/plain, which the browser then
//      renders as source because of x-content-type-options: nosniff).
//   2) Body served as new TextEncoder().encode(html) so bytes are real UTF-8.
// Belt-and-suspenders: the HTML source below uses ONLY ASCII + HTML entities
// (&middot; &mdash; &hellip; &rsquo; &amp;) so even if the charset is ever lost
// again, punctuation still renders correctly instead of turning into mojibake.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: string) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Mirror listing-present (the working public HTML page): lowercase "content-type"
// key, plain object, plain string body. The edge runtime respects this exact form;
// it overrides a canonical-cased "Content-Type" to text/plain. Body is ASCII-only
// (HTML entities) so a string body carries no mojibake risk.
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" };
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: HTML_HEADERS });

function shell(inner: string, title: string): string {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Barlow+Condensed:wght@600;700&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{
  --gold:#C5A95E;--champ:#EBCB82;--gold-deep:#9A8038;
  --ink:#100D09;--ink-2:#0a0806;--card:#1B1610;--card-2:#221c14;
  --line:rgba(203,169,94,.22);--line-2:rgba(203,169,94,.38);
  --text:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;
  --danger:#ef7d7d;--ok:#7fae8f;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{-webkit-text-size-adjust:100%}
body{
  margin:0;font-family:'Manrope',-apple-system,BlinkMacSystemFont,system-ui,sans-serif;
  background:
    radial-gradient(130% 30% at 50% -4%,rgba(203,169,94,.16),transparent 62%),
    linear-gradient(180deg,var(--ink) 0%,var(--ink-2) 100%);
  background-attachment:fixed;color:var(--text);
  padding:0 0 max(48px,env(safe-area-inset-bottom));line-height:1.5;
}
.wrap{max-width:600px;margin:0 auto;padding:calc(26px + env(safe-area-inset-top)) 20px 0}
.card{background:linear-gradient(180deg,rgba(34,28,20,.9),rgba(27,22,16,.9));
  border:1px solid var(--line);border-radius:18px;padding:22px 18px;margin-top:18px;
  box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 18px 50px -28px rgba(0,0,0,.9)}
.fork{width:26px;height:26px;flex:0 0 auto}
.brandrow{display:flex;align-items:center;gap:10px;margin-bottom:2px}
.eyebrow{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.24em;
  font-size:12.5px;font-weight:700;color:var(--gold)}
h1{font-family:'Fraunces',Georgia,serif;font-weight:300;font-size:31px;line-height:1.12;margin:10px 0 8px;letter-spacing:.2px}
.sub{color:var(--text-2);font-size:15px;line-height:1.6;margin:0 0 4px}
.hair{height:1px;background:linear-gradient(90deg,transparent,var(--line-2),transparent);margin:18px 0 4px;border:0}
.priv{display:flex;gap:10px;align-items:flex-start;background:rgba(203,169,94,.07);
  border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:13px;color:var(--text-2);margin:16px 0 2px}
.priv svg{flex:0 0 auto;margin-top:1px}
.grp{margin-top:20px}
label.f{display:block;font-family:'Barlow Condensed',sans-serif;font-size:15px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--text);font-weight:700;margin:0 0 9px}
.req{color:var(--gold)}
.opt{color:var(--text-3);font-weight:600;font-size:12px;letter-spacing:.04em}
input[type=text],input[type=email],input[type=tel],input[type=number],textarea,select{
  width:100%;background:var(--card);border:1px solid var(--line);border-radius:12px;
  color:var(--text);padding:14px 14px;font-size:16px;font-family:inherit;outline:none;
  transition:border-color .15s ease,box-shadow .15s ease}
input::placeholder,textarea::placeholder{color:#6f6a5e}
input:focus,textarea:focus,select:focus{border-color:var(--gold);box-shadow:0 0 0 3px rgba(203,169,94,.16)}
textarea{min-height:84px;resize:vertical}
select{appearance:none;-webkit-appearance:none;
  background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23C5A95E' stroke-width='2.5'><path d='M6 9l6 6 6-6'/></svg>");
  background-repeat:no-repeat;background-position:right 14px center;padding-right:40px}
.row{display:flex;gap:12px}.row>div{flex:1;min-width:0}
.chips{display:flex;flex-wrap:wrap;gap:9px}
.chip{position:relative}
.chip input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.chip span{display:inline-flex;align-items:center;min-height:44px;border:1px solid var(--line-2);
  border-radius:999px;padding:0 16px;font-size:14.5px;color:var(--text-2);cursor:pointer;
  transition:all .14s ease;user-select:none}
.chip input:focus-visible+span{box-shadow:0 0 0 3px rgba(203,169,94,.28)}
.chip input:checked+span{background:linear-gradient(180deg,rgba(235,203,130,.22),rgba(203,169,94,.16));
  border-color:var(--gold);color:var(--champ);font-weight:700}
.hint{font-size:12.5px;color:var(--text-3);line-height:1.55;margin-top:8px}
.cond{display:none;animation:fade .2s ease}
@keyframes fade{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
.err{color:var(--danger);font-size:13.5px;margin-top:10px;min-height:16px}
button{width:100%;margin-top:8px;background:linear-gradient(180deg,var(--champ),var(--gold));
  color:var(--ink);border:none;border-radius:14px;padding:17px;font-size:16.5px;font-weight:800;
  font-family:inherit;letter-spacing:.2px;cursor:pointer;min-height:54px;
  box-shadow:0 10px 26px -12px rgba(203,169,94,.6);transition:transform .08s ease,filter .15s ease}
button:hover{filter:brightness(1.04)}button:active{transform:translateY(1px)}
button:disabled{filter:grayscale(.3) brightness(.85);cursor:default}
.foot{text-align:center;color:var(--text-3);font-size:12px;margin:22px 0 0;letter-spacing:.02em}
.foot b{color:var(--gold);font-weight:700}
.foot .ital{font-family:'Fraunces',serif;font-style:italic;color:var(--champ);font-weight:400}
@media (max-width:380px){.row{flex-direction:column;gap:0}.row>div{margin-bottom:2px}h1{font-size:28px}}
</style></head><body><div class="wrap">${inner}
<div class="foot">Powered by <b>REALTY ONE GROUP</b> Advantage &middot; <span class="ital">Prism</span></div>
</div></body></html>`;
}

const FORK = `<svg class="fork" viewBox="0 0 24 24" fill="none" stroke="#C5A95E" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v7a4 4 0 0 0 8 0V3"/><path d="M12 14v7"/></svg>`;

function thanksPage(agentName: string): string {
  const inner = `<div class="card" style="text-align:center;padding:40px 22px">
<div style="font-size:46px;line-height:1">&#10003;</div>
<h1 style="margin-top:6px">Thank you.</h1>
<p class="sub" style="max-width:420px;margin:0 auto">Your buy-box is now with <b style="color:var(--champ)">${esc(agentName)}</b>. The moment a matching off-market or coming-soon deal shows up, you&rsquo;ll hear about it &mdash; directly, no spam.</p>
<p class="sub" style="color:var(--text-3);font-size:13px;margin-top:16px">You can close this window.</p></div>`;
  return shell(inner, "Thank you");
}

function notActivePage(): string {
  const inner = `<div class="card" style="text-align:center;padding:40px 22px">
<div style="font-size:40px;line-height:1">&#128274;</div>
<h1 style="margin-top:6px">This link isn&rsquo;t active.</h1>
<p class="sub" style="max-width:400px;margin:0 auto">The link may have expired or been mistyped. Please ask your agent for a fresh one.</p></div>`;
  return shell(inner, "Link unavailable");
}

function chips(name: string, opts: [string, string][]): string {
  return `<div class="chips">` + opts.map(([v, l]) =>
    `<label class="chip"><input type="checkbox" name="${name}" value="${esc(v)}"><span>${l}</span></label>`
  ).join("") + `</div>`;
}

function formPage(agentName: string): string {
  const a = esc(agentName);
  const inner = `
<div class="brandrow">${FORK}<span class="eyebrow">Investor Preferences</span></div>
<h1>What are you looking for?</h1>
<p class="sub">Share your buy-box with <b style="color:var(--champ)">${a}</b> and get matched to off-market &amp; coming-soon deals that actually fit &mdash; no spam, just real opportunities.</p>

<div class="priv">
<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#C5A95E" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
<span>Private &mdash; this goes straight to ${a}. Your details are never shared with anyone else.</span></div>

<form id="f" novalidate>
<div class="card">
  <div class="grp"><label class="f">Your name <span class="req">*</span></label>
    <input type="text" name="name" autocomplete="name" required></div>
  <div class="grp"><div class="row">
    <div><label class="f">Email <span class="opt">optional</span></label><input type="email" name="email" autocomplete="email" inputmode="email"></div>
    <div><label class="f">Phone <span class="opt">optional</span></label><input type="tel" name="phone" autocomplete="tel" inputmode="tel"></div>
  </div></div>
  <div class="grp"><label class="f">Best way to reach you</label>
    <select name="contact_pref"><option value="">No preference</option><option value="text">Text</option><option value="call">Call</option><option value="email">Email</option></select></div>
</div>

<div class="card">
  <div class="grp"><label class="f">What kind of investor are you?</label>
    ${chips("investor_types", [["fix_flip", "Fix &amp; Flip"], ["wholesaler", "Wholesaler"], ["rental", "Buy &amp; Hold"], ["multifamily", "Multifamily"], ["developer", "Developer"], ["land", "Land"]])}
    <div id="types_sentinel"></div></div>

  <div class="grp"><label class="f">Property types</label>
    ${chips("property_types", [["sfr", "Single-family"], ["condo", "Condo/Townhome"], ["duplex", "Duplex/Tri/Quad"], ["multi", "5+ Multifamily"], ["manufactured", "Manufactured"], ["land", "Land"], ["commercial", "Commercial"]])}</div>

  <div class="grp"><label class="f">Markets you want <span class="opt">cities or ZIPs</span></label>
    <input type="text" name="markets" placeholder="Wesley Chapel, Lutz, 33543"></div>
</div>

<div class="card">
  <div class="grp"><div class="row">
    <div><label class="f">Price min</label><input type="number" name="price_min" inputmode="numeric" placeholder="250000"></div>
    <div><label class="f">Price max</label><input type="number" name="price_max" inputmode="numeric" placeholder="450000"></div>
  </div></div>
  <div class="grp"><div class="row">
    <div><label class="f">Beds min</label><input type="number" name="beds_min" inputmode="numeric"></div>
    <div><label class="f">Baths min</label><input type="number" name="baths_min" inputmode="numeric"></div>
  </div></div>
  <div class="grp"><label class="f">Condition you&rsquo;ll take</label>
    ${chips("condition_tolerance", [["turnkey", "Turnkey"], ["light", "Light cosmetic"], ["full_rehab", "Full rehab"], ["teardown", "Teardown"]])}</div>
  <div class="grp"><label class="f">Tenant-occupied OK?</label>
    <select name="occupancy_ok"><option value="any">Either is fine</option><option value="vacant_only">Vacant only</option></select></div>

  <div class="cond grp" id="capWrap"><label class="f">Minimum cap rate you need <span class="opt">%</span></label>
    <input type="number" name="cap_rate_min" step="0.1" inputmode="decimal" placeholder="7"></div>
  <div class="cond grp" id="flipWrap"><div class="row">
    <div><label class="f">Min flip margin <span class="opt">%</span></label><input type="number" name="flip_margin_min" inputmode="numeric" placeholder="20"></div>
    <div><label class="f">Max rehab budget <span class="opt">$</span></label><input type="number" name="rehab_budget_max" inputmode="numeric" placeholder="60000"></div>
  </div></div>
</div>

<div class="card">
  <div class="grp"><label class="f">How do you buy?</label>
    ${chips("financing", [["cash", "Cash"], ["hard_money", "Hard money"], ["conventional", "Conventional"], ["dscr", "DSCR"], ["seller_finance", "Seller finance"], ["1031", "1031 exchange"]])}</div>
  <div class="grp"><div class="row">
    <div><label class="f">Proof of funds?</label>
      <select name="proof_of_funds"><option value="">Prefer not to say</option><option value="true">Yes</option><option value="false">Not yet</option></select></div>
    <div><label class="f">Close in <span class="opt">days</span></label><input type="number" name="close_speed_days" inputmode="numeric" placeholder="14"></div>
  </div></div>
  <div class="grp"><label class="f">Pay a buyer&rsquo;s-agent commission?</label>
    <select name="pays_buyer_comp"><option value="">Prefer not to say</option><option value="true">Yes</option><option value="false">Expect the listing side to offer it</option></select></div>
</div>

<div class="card">
  <div class="grp"><label class="f">Absolute dealbreakers</label>
    <input type="text" name="dealbreakers" placeholder="flood zone, HOA, 55+, mobile home">
    <div class="hint">A hard filter &mdash; we&rsquo;ll never send you anything matching these. Only list what you&rsquo;d truly never buy.</div></div>
  <div class="grp"><label class="f">Deals per week you want to see</label>
    <input type="number" name="freq_cap_per_week" inputmode="numeric" placeholder="5"></div>
  <div class="grp"><label class="f">Anything else we should know?</label>
    <textarea name="notes" placeholder="Timeline, financing, how many you&rsquo;re looking to do&hellip;"></textarea></div>
</div>

<div class="err" id="err" role="alert"></div>
<button type="submit" id="btn">Send my preferences</button>
</form>

<script>
(function(){
  var caps=document.getElementById('capWrap'),flip=document.getElementById('flipWrap');
  function checked(n){return [].slice.call(document.querySelectorAll('input[name='+n+']:checked')).map(function(x){return x.value});}
  function upd(){
    var t=checked('investor_types');
    caps.style.display=(t.indexOf('rental')>-1||t.indexOf('multifamily')>-1)?'block':'none';
    flip.style.display=(t.indexOf('fix_flip')>-1||t.indexOf('wholesaler')>-1)?'block':'none';
  }
  document.addEventListener('change',function(e){if(e.target&&e.target.name==='investor_types')upd();});
  upd();

  document.getElementById('f').addEventListener('submit',function(e){
    e.preventDefault();
    var btn=document.getElementById('btn'),err=document.getElementById('err');err.textContent='';
    var fd=new FormData(e.target);
    var name=(fd.get('name')||'').trim();
    if(!name){err.textContent='Please add your name so we know who to reach out to.';
      var el=e.target.querySelector('input[name=name]');if(el){el.focus();el.scrollIntoView({block:'center',behavior:'smooth'});}return;}
    function multi(n){return fd.getAll(n);}
    var dm={};
    if(fd.get('cap_rate_min'))dm.cap_rate_min=fd.get('cap_rate_min');
    if(fd.get('flip_margin_min'))dm.flip_margin_min=fd.get('flip_margin_min');
    if(fd.get('rehab_budget_max'))dm.rehab_budget_max=fd.get('rehab_budget_max');
    var payload={name:name,email:fd.get('email'),phone:fd.get('phone'),
      investor_types:multi('investor_types'),property_types:multi('property_types'),
      condition_tolerance:multi('condition_tolerance'),markets:fd.get('markets'),
      price_min:fd.get('price_min'),price_max:fd.get('price_max'),
      beds_min:fd.get('beds_min'),baths_min:fd.get('baths_min'),
      occupancy_ok:fd.get('occupancy_ok'),deal_metrics:dm,
      pays_buyer_comp:fd.get('pays_buyer_comp')||null,notes:fd.get('notes'),
      dealbreakers:fd.get('dealbreakers'),financing:multi('financing'),
      proof_of_funds:fd.get('proof_of_funds')||null,close_speed_days:fd.get('close_speed_days'),
      freq_cap_per_week:fd.get('freq_cap_per_week'),contact_pref:fd.get('contact_pref')};
    btn.disabled=true;btn.textContent='Sending\\u2026';
    fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
     .then(function(r){return r.json();})
     .then(function(d){
        if(d&&d.ok){document.open();document.write(d.html);document.close();window.scrollTo(0,0);}
        else{err.textContent=(d&&d.error)||'Something went wrong. Please try again.';btn.disabled=false;btn.textContent='Send my preferences';}
     })
     .catch(function(){err.textContent='Network error \\u2014 please check your connection and try again.';btn.disabled=false;btn.textContent='Send my preferences';});
  });
})();
</script>`;
  return shell(inner, "Investor Preferences &middot; " + a);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Accept ?t= (current) and ?token= (legacy links) so no shared link ever breaks.
  const token = url.searchParams.get("t") || url.searchParams.get("token") || "";

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "content-type" } });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let agentName = "your agent", ownerId: string | null = null;
  if (token) {
    try {
      const { data } = await admin.rpc("investor_intake_owner", { p_token: token });
      if (data && data.owner_user_id) { ownerId = data.owner_user_id; agentName = data.agent_name || "your agent"; }
    } catch (_) { /* fall through to not-active page */ }
  }

  if (!ownerId) return html(notActivePage());

  if (req.method === "GET") return html(formPage(agentName));

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { data, error } = await admin.rpc("investor_intake_submit", { p_token: token, p: body });
      if (error || !data || !data.ok) {
        return new Response(JSON.stringify({ ok: false, error: (data && data.error) || (error && error.message) || "Could not save your preferences." }), { headers: JSON_HEADERS });
      }
      try {
        await admin.functions.invoke("push-send", { body: {
          user_id: ownerId, title: "\uD83C\uDFAF New investor signed up",
          body: (body.name || "An investor") + " shared their buy-box with you. Tap to review.",
          url: "https://darasapp.com/?view=investor_pipeline&tab=investors", tag: "investor-intake",
        } });
      } catch (_) { /* best-effort */ }
      return new Response(JSON.stringify({ ok: true, html: thanksPage(agentName) }), { headers: JSON_HEADERS });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }), { headers: JSON_HEADERS });
    }
  }

  return new Response("Method not allowed", { status: 405, headers: { "Access-Control-Allow-Origin": "*" } });
});
