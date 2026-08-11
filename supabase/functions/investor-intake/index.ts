// investor-intake — the public, no-auth investor questionnaire an agent shares.
// GET ?t=<token>  -> serves the branded form (agent name resolved from the token).
// POST ?t=<token> -> creates a buy-box OWNED BY THE AGENT (source=self_intake) and
//                    pushes the agent "New investor signed up".
// verify_jwt=false (public). Mirrors the listing-present public-page pattern.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPA = "https://xlgfspnojjgvkuitcoaf.supabase.co";
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(agentName: string, token: string, done = false): string {
  const gold = "#C5A95E", champ = "#EBCB82", ink = "#100D09";
  if (done) return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Thank you</title><style>body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:${ink};color:#F6F1E7;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}
h1{font-family:Georgia,serif;font-weight:400;font-size:30px}</style></head>
<body><div><div style="font-size:44px">✓</div><h1>Thank you.</h1>
<p style="color:#C8BFAE;max-width:420px;line-height:1.6">Your details are with <b style="color:${champ}">${esc(agentName)}</b>. When a matching opportunity comes up, they'll reach out to you directly.</p></div></body></html>`;

  const chips = (name: string, opts: [string, string][]) => opts.map(([v, l]) =>
    `<label class="chip"><input type="checkbox" name="${name}" value="${v}"><span>${l}</span></label>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Investor Preferences · ${esc(agentName)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@300;400&family=Barlow+Condensed:wght@700&display=swap" rel="stylesheet">
<style>
:root{--gold:${gold};--champ:${champ};--ink:${ink}}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:radial-gradient(120% 25% at 50% 0,rgba(203,163,92,.10),transparent 60%),var(--ink);color:#F6F1E7;padding:0 0 60px}
.wrap{max-width:560px;margin:0 auto;padding:26px 20px}
.eyebrow{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.22em;font-size:12px;font-weight:700;color:var(--gold)}
h1{font-family:'Fraunces',serif;font-weight:300;font-size:30px;margin:4px 0 6px}
.sub{color:#C8BFAE;font-size:14px;line-height:1.55;margin-bottom:22px}
label.f{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#8C8475;margin:16px 0 6px;font-weight:600}
input[type=text],input[type=email],input[type=tel],input[type=number],textarea,select{width:100%;background:#1B1610;border:1px solid rgba(203,163,92,.25);border-radius:10px;color:#F6F1E7;padding:12px;font-size:15px;font-family:inherit}
textarea{min-height:70px}
.row{display:flex;gap:10px}.row>div{flex:1}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.chip{position:relative}.chip input{position:absolute;opacity:0}
.chip span{display:inline-block;border:1px solid rgba(203,163,92,.3);border-radius:20px;padding:8px 14px;font-size:13.5px;color:#C8BFAE;cursor:pointer}
.chip input:checked+span{background:rgba(203,163,92,.18);border-color:var(--gold);color:var(--champ);font-weight:700}
button{width:100%;margin-top:24px;background:var(--champ);color:var(--ink);border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:800;cursor:pointer}
.priv{background:rgba(203,163,92,.06);border:1px solid rgba(203,163,92,.22);border-radius:12px;padding:11px 14px;font-size:13px;color:#C8BFAE;margin-bottom:20px}
.err{color:#ef7d7d;font-size:13px;margin-top:8px;min-height:16px}
.cond{display:none}
</style></head><body><div class="wrap">
<div class="eyebrow">Investor Preferences</div>
<h1>What are you looking for?</h1>
<div class="sub">Share your buy-box with <b style="color:var(--champ)">${esc(agentName)}</b> and you'll be matched to off-market and coming-soon opportunities that actually fit — no spam, just real deals.</div>
<div class="priv">Private: this goes straight to ${esc(agentName)}. Your details are private and won't be shared with anyone else.</div>
<form id="f">
  <label class="f">Your name *</label><input type="text" name="name" required>
  <div class="row"><div><label class="f">Email</label><input type="email" name="email"></div><div><label class="f">Phone</label><input type="tel" name="phone"></div></div>

  <label class="f">What kind of investor are you?</label>
  <div class="chips" id="types">${chips("investor_types", [["fix_flip", "Fix & Flip"], ["wholesaler", "Wholesaler"], ["rental", "Buy & Hold"], ["multifamily", "Multifamily"], ["developer", "Developer"], ["land", "Land"]])}</div>

  <label class="f">Markets you want (cities or ZIPs, comma-separated)</label>
  <input type="text" name="markets" placeholder="Wesley Chapel, Lutz, 33543">

  <label class="f">Property types</label>
  <div class="chips">${chips("property_types", [["sfr", "Single-family"], ["condo", "Condo/Townhome"], ["duplex", "Duplex/Tri/Quad"], ["multi", "5+ Multifamily"], ["manufactured", "Manufactured"], ["land", "Land"], ["commercial", "Commercial"]])}</div>

  <div class="row"><div><label class="f">Price min</label><input type="number" name="price_min" placeholder="250000"></div><div><label class="f">Price max</label><input type="number" name="price_max" placeholder="450000"></div></div>
  <div class="row"><div><label class="f">Beds min</label><input type="number" name="beds_min"></div><div><label class="f">Baths min</label><input type="number" name="baths_min"></div></div>

  <label class="f">Condition you'll take</label>
  <div class="chips">${chips("condition_tolerance", [["turnkey", "Turnkey"], ["light", "Light cosmetic"], ["full_rehab", "Full rehab"], ["teardown", "Teardown"]])}</div>

  <label class="f">Tenant-occupied OK?</label>
  <select name="occupancy_ok"><option value="any">Either is fine</option><option value="vacant_only">Vacant only</option></select>

  <div class="cond" id="capWrap"><label class="f">Minimum cap rate you need (%)</label><input type="number" name="cap_rate_min" step="0.1" placeholder="7"></div>
  <div class="cond" id="flipWrap"><div class="row"><div><label class="f">Min flip margin (%)</label><input type="number" name="flip_margin_min" placeholder="20"></div><div><label class="f">Max rehab budget ($)</label><input type="number" name="rehab_budget_max" placeholder="60000"></div></div></div>

  <label class="f">Will you pay a buyer's-agent commission?</label>
  <select name="pays_buyer_comp"><option value="">Prefer not to say</option><option value="true">Yes</option><option value="false">Expect the listing side to offer it</option></select>

  <label class="f">Anything else we should know?</label>
  <textarea name="notes" placeholder="Timeline, financing, dealbreakers, how many you're looking to do…"></textarea>

  <div class="err" id="err"></div>
  <button type="submit" id="btn">Send my preferences</button>
</form>
<script>
var tset=document.getElementById('types'), cap=document.getElementById('capWrap'), flip=document.getElementById('flipWrap');
function upd(){var v=[].slice.call(document.querySelectorAll('input[name=investor_types]:checked')).map(function(x){return x.value});
 cap.style.display=(v.indexOf('rental')>-1||v.indexOf('multifamily')>-1)?'block':'none';
 flip.style.display=(v.indexOf('fix_flip')>-1||v.indexOf('wholesaler')>-1)?'block':'none';}
tset.addEventListener('change',upd);
document.getElementById('f').addEventListener('submit',function(e){e.preventDefault();
 var btn=document.getElementById('btn'),err=document.getElementById('err');err.textContent='';
 var fd=new FormData(e.target);
 function multi(n){return fd.getAll(n);}
 var dm={};if(fd.get('cap_rate_min'))dm.cap_rate_min=fd.get('cap_rate_min');
 if(fd.get('flip_margin_min'))dm.flip_margin_min=fd.get('flip_margin_min');
 if(fd.get('rehab_budget_max'))dm.rehab_budget_max=fd.get('rehab_budget_max');
 var payload={name:fd.get('name'),email:fd.get('email'),phone:fd.get('phone'),
  investor_types:multi('investor_types'),property_types:multi('property_types'),condition_tolerance:multi('condition_tolerance'),
  markets:fd.get('markets'),price_min:fd.get('price_min'),price_max:fd.get('price_max'),
  beds_min:fd.get('beds_min'),baths_min:fd.get('baths_min'),occupancy_ok:fd.get('occupancy_ok'),
  deal_metrics:dm,pays_buyer_comp:fd.get('pays_buyer_comp')||null,notes:fd.get('notes')};
 if(!payload.name){err.textContent='Please add your name.';return;}
 btn.disabled=true;btn.textContent='Sending…';
 fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
  .then(function(r){return r.json()}).then(function(d){
    if(d.ok){document.open();document.write(d.html);document.close();}
    else{err.textContent=d.error||'Something went wrong.';btn.disabled=false;btn.textContent='Send my preferences';}
  }).catch(function(){err.textContent='Network error — please try again.';btn.disabled=false;btn.textContent='Send my preferences';});
});
</script></div></body></html>`;
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // resolve token -> agent
  let agentName = "your agent", ownerId: string | null = null;
  if (token) {
    const { data } = await admin.rpc("investor_intake_owner", { p_token: token });
    if (data && data.owner_user_id) { ownerId = data.owner_user_id; agentName = data.agent_name || "your agent"; }
  }
  const htmlHeaders = { "Content-Type": "text/html; charset=utf-8", "Access-Control-Allow-Origin": "*" };

  if (!ownerId) {
    return new Response(new TextEncoder().encode(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#100D09;color:#F6F1E7;text-align:center;padding:60px"><h2>This link isn't active.</h2><p style="color:#C8BFAE">Please ask your agent for a fresh link.</p></body>`), { status: 200, headers: htmlHeaders });
  }

  if (req.method === "GET") {
    return new Response(new TextEncoder().encode(page(agentName, token)), { headers: htmlHeaders });
  }

  if (req.method === "POST") {
    try {
      const body = await req.json();
      const { data, error } = await admin.rpc("investor_intake_submit", { p_token: token, p: body });
      if (error || !data || !data.ok) {
        return new Response(JSON.stringify({ ok: false, error: (data && data.error) || (error && error.message) || "Could not save." }), { headers: { "Content-Type": "application/json" } });
      }
      // notify the agent
      try {
        await admin.functions.invoke("push-send", { body: {
          user_id: ownerId, title: "🎯 New investor signed up",
          body: (body.name || "An investor") + " shared their buy-box with you. Tap to review.",
          url: "https://darasapp.com/?view=investor_pipeline&tab=investors", tag: "investor-intake",
        } });
      } catch (_) { /* best-effort */ }
      return new Response(JSON.stringify({ ok: true, html: page(agentName, token, true) }), { headers: { "Content-Type": "application/json" } });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }), { headers: { "Content-Type": "application/json" } });
    }
  }
  return new Response("Method not allowed", { status: 405 });
});
