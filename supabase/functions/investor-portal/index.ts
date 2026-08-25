// investor-portal — the investor's own private page, reached by a signed link.
//
//   GET  ?t=<portal_token>   -> the branded profile page
//   POST ?t=<portal_token>   -> { action: ... }
//
// Design decisions worth knowing before editing this file:
//
// 1. NO LOGIN. The portal_token is a bearer credential. Profile editing is open
//    on the link alone; anything sensitive is behind a one-time code (step-up),
//    because a link in an email gets forwarded and cannot be un-forwarded.
//
// 2. THE BROWSER NEVER TALKS TO POSTGREST. Every portal RPC is revoked from anon
//    and granted only to service_role, so all traffic passes through here.
//
// 3. PROPERTY DETAIL IS REDACTED IN SQL, NOT HERE. investor_portal_matches
//    already strips address / zip / city / exact price / ARV / rehab / rent /
//    cap rate / agent notes / submitting agent. Never widen that payload from
//    this file -- the whole point is that no client bug can leak a property.
//
// 4. The step-up code goes out from the PRIMARY AGENT's own Quo number (or their
//    Gmail), so it arrives from the person the investor already knows.
//
// verify_jwt=false (public page).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const QUO_BASE = "https://api.openphone.com";
const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

const TYPES: [string, string][] = [
  ["fix_flip", "Fix & Flip"], ["wholesaler", "Wholesaler"], ["rental", "Buy & Hold"],
  ["multifamily", "Multifamily"], ["developer", "Developer"], ["land", "Land"],
];
const PROPS: [string, string][] = [
  ["sfr", "Single-family"], ["condo", "Condo / Townhome"], ["duplex", "Duplex/Tri/Quad"],
  ["multi", "5+ Multifamily"], ["manufactured", "Manufactured"], ["land", "Land"], ["commercial", "Commercial"],
];
const CONDS: [string, string][] = [
  ["turnkey", "Turnkey"], ["light", "Light cosmetic"], ["full_rehab", "Full rehab"], ["teardown", "Teardown"],
];
const FIN: [string, string][] = [
  ["cash", "Cash"], ["hard_money", "Hard money"], ["conventional", "Conventional"],
  ["dscr", "DSCR"], ["seller_finance", "Seller finance"], ["1031", "1031 exchange"],
];

function page(b: any, agents: any[], oppCount: number, oppAvail: boolean, token: string): string {
  const gold = "#C5A95E", champ = "#EBCB82", ink = "#100D09";
  const arr = (x: unknown) => (Array.isArray(x) ? x : []);
  const has = (list: unknown, v: string) => arr(list).indexOf(v) > -1;
  const chips = (name: string, opts: [string, string][], sel: unknown) => opts.map(([v, l]) =>
    `<label class="chip"><input type="checkbox" name="${name}" value="${v}"${has(sel, v) ? " checked" : ""}><span>${l}</span></label>`).join("");
  const val = (x: unknown) => (x === null || x === undefined ? "" : esc(x));
  const dm = b.deal_metrics || {};
  const primary = agents.find((a) => a.is_primary);
  const multi = agents.length > 1;

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your Investor Profile</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:wght@300;400&family=Barlow+Condensed:wght@700&display=swap" rel="stylesheet">
<style>
:root{--gold:${gold};--champ:${champ};--ink:${ink}}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:radial-gradient(120% 25% at 50% 0,rgba(203,163,92,.10),transparent 60%),var(--ink);color:#F6F1E7;padding:0 0 70px}
.wrap{max-width:580px;margin:0 auto;padding:26px 20px}
.eyebrow{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.22em;font-size:12px;font-weight:700;color:var(--gold)}
h1{font-family:'Fraunces',serif;font-weight:300;font-size:30px;margin:4px 0 6px}
h2{font-family:'Fraunces',serif;font-weight:300;font-size:22px;margin:0 0 4px}
.sub{color:#C8BFAE;font-size:14px;line-height:1.55;margin-bottom:20px}
.hair{height:1px;background:linear-gradient(90deg,transparent,rgba(203,163,92,.55),transparent);margin:26px 0}
label.f{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#8C8475;margin:16px 0 6px;font-weight:600}
input[type=text],input[type=email],input[type=tel],input[type=number],textarea,select{width:100%;background:#1B1610;border:1px solid rgba(203,163,92,.25);border-radius:10px;color:#F6F1E7;padding:12px;font-size:15px;font-family:inherit}
textarea{min-height:70px}
.row{display:flex;gap:10px}.row>div{flex:1}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:4px}
.chip{position:relative}.chip input{position:absolute;opacity:0}
.chip span{display:inline-block;border:1px solid rgba(203,163,92,.3);border-radius:20px;padding:8px 14px;font-size:13.5px;color:#C8BFAE;cursor:pointer}
.chip input:checked+span{background:rgba(203,163,92,.18);border-color:var(--gold);color:var(--champ);font-weight:700}
button{width:100%;margin-top:22px;background:var(--champ);color:var(--ink);border:none;border-radius:12px;padding:15px;font-size:16px;font-weight:800;cursor:pointer}
button.ghost{background:transparent;color:var(--champ);border:1px solid var(--gold)}
button.danger{background:transparent;color:#c98b8b;border:1px solid rgba(201,139,139,.45);font-weight:600;font-size:14px;padding:12px}
.card{background:rgba(255,255,255,.03);border:1px solid rgba(203,163,92,.22);border-radius:14px;padding:14px 16px;margin-bottom:11px}
.hint{font-size:12px;color:#8C8475;line-height:1.5;margin-top:6px}
.pill{display:inline-block;font-size:11px;border-radius:20px;padding:3px 9px;font-weight:700;background:rgba(203,163,92,.18);color:var(--champ);margin-left:6px}
.err{color:#ef7d7d;font-size:13px;margin-top:8px;min-height:16px}
.ok{color:var(--champ);font-size:13px;margin-top:8px;min-height:16px}
.opp{display:flex;justify-content:space-between;align-items:center;gap:10px}
.opp .band{font-size:15px;font-weight:800;color:var(--champ);white-space:nowrap}
.meta{font-size:12.5px;color:#8C8475;margin-top:3px}
.agentrow{display:flex;align-items:center;gap:10px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.agentrow:last-child{border-bottom:none}
.agentrow .nm{flex:1;font-size:14.5px}
.small{font-size:12.5px;color:#8C8475;line-height:1.55}
</style></head><body><div class="wrap">

<div class="eyebrow">Investor Profile</div>
<h1>${esc(b.name || "Your buy-box")}</h1>
<div class="sub">Keep this current and ${primary ? esc(primary.name) : "your agent"} will match you to off-market and coming-soon opportunities that actually fit.</div>

<div class="hair"></div>

<div class="eyebrow">Opportunities</div>
<h2>What we're tracking for you.</h2>
<div id="oppIntro" class="small" style="margin-top:8px">
${oppAvail
      ? `We're reviewing <b style="color:var(--champ)">${oppCount}</b> possible fits for you right now. For your privacy and the sellers', details are only visible after we confirm it's you.`
      : oppCount === 1
        ? `We're reviewing one possible fit for you. We'll open this up once there's more than one to compare — until then ${primary ? esc(primary.name) : "your agent"} will reach out directly.`
        : `Nothing in the pipeline yet. The more complete your buy-box below, the better we can hunt.`}
</div>
${oppAvail ? `<button class="ghost" id="btnCode">View my opportunities</button>` : ""}
<div id="codeBox" style="display:none">
  <label class="f">Enter the 6-digit code we just sent</label>
  <input type="text" id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="000000">
  <button id="btnVerify">Verify</button>
</div>
<div id="oppList" style="margin-top:14px"></div>
<div class="err" id="oppErr"></div>

<div class="hair"></div>

${multi ? `
<div class="eyebrow">Your point of contact</div>
<h2>Who should we route through?</h2>
<div class="small" style="margin:8px 0 12px">More than one of our agents is helping you. Pick who your opportunities should come through — you can change this any time.</div>
<div class="card" style="padding:4px 16px">
${agents.map((a) => `<div class="agentrow">
  <div class="nm">${esc(a.name)}${a.is_primary ? '<span class="pill">Primary</span>' : ""}</div>
  ${a.is_primary ? "" : `<button class="ghost" style="width:auto;margin:0;padding:8px 14px;font-size:13px" onclick="setPrimary('${esc(a.agent_user_id)}')">Make primary</button>`}
</div>`).join("")}
</div>
<div class="hair"></div>` : ""}

<div class="eyebrow">Your buy-box</div>
<h2>What you're looking for.</h2>
<div class="small" style="margin:8px 0 4px">Most of these are hard filters, so answer with the widest range you'd genuinely consider — being too specific hides deals from you.</div>

<form id="f" onsubmit="return false">
  <div class="row"><div><label class="f">Name</label><input type="text" name="name" value="${val(b.name)}"></div>
  <div><label class="f">Company</label><input type="text" name="company" value="${val(b.company)}"></div></div>
  <div class="row"><div><label class="f">Email</label><input type="email" name="email" value="${val(b.email)}"></div>
  <div><label class="f">Phone</label><input type="tel" name="phone" value="${val(b.phone)}"></div></div>

  <label class="f">Best way to reach you</label>
  <select name="contact_pref">
    ${[["", "No preference"], ["text", "Text"], ["call", "Call"], ["email", "Email"]]
      .map(([v, l]) => `<option value="${v}"${(b.contact_pref || "") === v ? " selected" : ""}>${l}</option>`).join("")}
  </select>

  <label class="f">What kind of investor are you?</label>
  <div class="chips">${chips("investor_types", TYPES, b.investor_types)}</div>

  <label class="f">Markets you want (cities or ZIPs, comma-separated)</label>
  <input type="text" name="markets" value="${val(arr(b.markets).join(", "))}" placeholder="Wesley Chapel, Lutz, 33543">

  <label class="f">Property types</label>
  <div class="chips">${chips("property_types", PROPS, b.property_types)}</div>

  <div class="row"><div><label class="f">Price min</label><input type="number" name="price_min" value="${val(b.price_min)}"></div>
  <div><label class="f">Price max</label><input type="number" name="price_max" value="${val(b.price_max)}"></div></div>
  <div class="row"><div><label class="f">Beds min</label><input type="number" name="beds_min" value="${val(b.beds_min)}"></div>
  <div><label class="f">Baths min</label><input type="number" name="baths_min" value="${val(b.baths_min)}"></div></div>

  <label class="f">Condition you'll take</label>
  <div class="chips">${chips("condition_tolerance", CONDS, b.condition_tolerance)}</div>

  <label class="f">Tenant-occupied OK?</label>
  <select name="occupancy_ok">
    <option value="any"${b.occupancy_ok === "any" ? " selected" : ""}>Either is fine</option>
    <option value="vacant_only"${b.occupancy_ok === "vacant_only" ? " selected" : ""}>Vacant only</option>
  </select>

  <div class="row">
    <div><label class="f">Min cap rate (%)</label><input type="number" step="0.1" name="cap_rate_min" value="${val(dm.cap_rate_min)}"></div>
    <div><label class="f">Min flip margin (%)</label><input type="number" name="flip_margin_min" value="${val(dm.flip_margin_min)}"></div>
  </div>
  <label class="f">Max rehab budget ($)</label><input type="number" name="rehab_budget_max" value="${val(dm.rehab_budget_max)}">

  <label class="f">Absolute dealbreakers (comma-separated)</label>
  <input type="text" name="dealbreakers" value="${val(arr(b.dealbreakers).join(", "))}" placeholder="flood zone, HOA, 55+">
  <div class="hint">A hard filter — we will never send you anything matching these.</div>

  <label class="f">How do you buy?</label>
  <div class="chips">${chips("financing", FIN, b.financing)}</div>

  <div class="row">
    <div><label class="f">Proof of funds ready?</label>
      <select name="proof_of_funds">
        <option value=""${b.proof_of_funds === null ? " selected" : ""}>Prefer not to say</option>
        <option value="true"${b.proof_of_funds === true ? " selected" : ""}>Yes</option>
        <option value="false"${b.proof_of_funds === false ? " selected" : ""}>Not yet</option>
      </select></div>
    <div><label class="f">Close in (days)</label><input type="number" name="close_speed_days" value="${val(b.close_speed_days)}"></div>
  </div>

  <div class="row">
    <div><label class="f">Deals/week you want</label><input type="number" name="freq_cap_per_week" value="${val(b.freq_cap_per_week)}"></div>
    <div><label class="f">Pay a buyer's-agent fee?</label>
      <select name="pays_buyer_comp">
        <option value=""${b.pays_buyer_comp === null ? " selected" : ""}>Prefer not to say</option>
        <option value="true"${b.pays_buyer_comp === true ? " selected" : ""}>Yes</option>
        <option value="false"${b.pays_buyer_comp === false ? " selected" : ""}>Listing side</option>
      </select></div>
  </div>

  <label class="f">Anything else we should know?</label>
  <textarea name="notes">${val(b.notes)}</textarea>

  <div class="err" id="err"></div><div class="ok" id="okmsg"></div>
  <button id="btnSave">Save my profile</button>
</form>

<div class="hair"></div>
<div class="small">Want us to stop tracking for you? We'll remove your buy-box and everything tied to it. We'll ask you to confirm with a code first.</div>
<button class="danger" id="btnDel">Delete my profile</button>
<div class="err" id="delErr"></div>

<script>
var T=${JSON.stringify(token)}, SESSION=null, DEL_MODE=false;
function post(action, extra){
  var body=Object.assign({action:action}, extra||{});
  return fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
    .then(function(r){return r.json()});
}
function multi(fd,n){return fd.getAll(n)}

document.getElementById('btnSave').addEventListener('click',function(){
  var btn=this, err=document.getElementById('err'), ok=document.getElementById('okmsg');
  err.textContent='';ok.textContent='';
  var fd=new FormData(document.getElementById('f'));
  var dm={};
  if(fd.get('cap_rate_min'))dm.cap_rate_min=fd.get('cap_rate_min');
  if(fd.get('flip_margin_min'))dm.flip_margin_min=fd.get('flip_margin_min');
  if(fd.get('rehab_budget_max'))dm.rehab_budget_max=fd.get('rehab_budget_max');
  var p={name:fd.get('name'),company:fd.get('company'),email:fd.get('email'),phone:fd.get('phone'),
    contact_pref:fd.get('contact_pref'),investor_types:multi(fd,'investor_types'),
    property_types:multi(fd,'property_types'),condition_tolerance:multi(fd,'condition_tolerance'),
    financing:multi(fd,'financing'),markets:fd.get('markets'),dealbreakers:fd.get('dealbreakers'),
    price_min:fd.get('price_min'),price_max:fd.get('price_max'),beds_min:fd.get('beds_min'),
    baths_min:fd.get('baths_min'),occupancy_ok:fd.get('occupancy_ok'),deal_metrics:dm,
    proof_of_funds:fd.get('proof_of_funds'),close_speed_days:fd.get('close_speed_days'),
    freq_cap_per_week:fd.get('freq_cap_per_week'),pays_buyer_comp:fd.get('pays_buyer_comp'),
    notes:fd.get('notes')};
  btn.disabled=true;btn.textContent='Saving…';
  post('save',{payload:p}).then(function(d){
    btn.disabled=false;btn.textContent='Save my profile';
    if(d.ok){ok.textContent='Saved. Thank you — this helps us hunt more accurately.';}
    else{err.textContent=d.error||'Could not save.';}
  }).catch(function(){btn.disabled=false;btn.textContent='Save my profile';err.textContent='Network error.';});
});

var bc=document.getElementById('btnCode');
if(bc) bc.addEventListener('click',function(){
  var err=document.getElementById('oppErr');err.textContent='';
  this.disabled=true;this.textContent='Sending…';
  var self=this;
  post('request_code').then(function(d){
    self.disabled=false;self.textContent='View my opportunities';
    if(d.ok){document.getElementById('codeBox').style.display='block';self.style.display='none';
      err.textContent='';document.getElementById('oppIntro').innerHTML='We sent a code to your '+(d.channel||'contact')+'.';}
    else{err.textContent=d.error||'Could not send a code.';}
  }).catch(function(){self.disabled=false;self.textContent='View my opportunities';err.textContent='Network error.';});
});

document.getElementById('btnVerify').addEventListener('click',function(){
  var err=document.getElementById('oppErr');err.textContent='';
  var code=document.getElementById('code').value;
  this.disabled=true;this.textContent='Checking…';
  var self=this;
  post('verify_code',{code:code}).then(function(d){
    self.disabled=false;self.textContent='Verify';
    if(!d.ok){err.textContent=d.error||'Not right.';return;}
    SESSION=d.session;
    document.getElementById('codeBox').style.display='none';
    if(DEL_MODE){doDelete();return;}
    renderOpps(d.items||[]);
  }).catch(function(){self.disabled=false;self.textContent='Verify';err.textContent='Network error.';});
});

function money(n){return '$'+Number(n).toLocaleString('en-US')}
function renderOpps(items){
  var host=document.getElementById('oppList');
  document.getElementById('oppIntro').innerHTML='These fit your criteria. Addresses stay private until we walk you through it — tap Interested and we\\'ll take it from there.';
  if(!items.length){host.innerHTML='<div class="small">Nothing to show right now.</div>';return;}
  host.innerHTML=items.map(function(it){
    var bits=[];
    if(it.beds)bits.push(it.beds+' bd');
    if(it.baths)bits.push(it.baths+' ba');
    if(it.condition)bits.push(it.condition.replace('_',' '));
    if(it.occupancy)bits.push(it.occupancy==='tenant'?'tenant-occupied':'vacant');
    if(it.area)bits.push('your '+it.area+' criteria');
    return '<div class="card"><div class="opp"><div><div style="font-size:15px;font-weight:700">'+
      (it.kind||'Property').replace('_',' ')+'</div><div class="meta">'+bits.join(' · ')+'</div></div>'+
      '<div class="band">'+money(it.price_low)+'–'+money(it.price_high)+'</div></div>'+
      (it.flagged?'<div class="meta" style="margin-top:8px;color:'+'#EBCB82'+'">You flagged this — your agent has been told.</div>'
        :'<button class="ghost" style="margin-top:10px" onclick="flag(\\''+it.ref+'\\',this)">I\\'m interested</button>')+
      '</div>';
  }).join('');
}
function flag(ref,btn){
  btn.disabled=true;btn.textContent='Sending…';
  post('interest',{session:SESSION,ref:ref}).then(function(d){
    btn.outerHTML='<div class="meta" style="margin-top:8px;color:#EBCB82">Sent — your agent will reach out.</div>';
  }).catch(function(){btn.disabled=false;btn.textContent="I'm interested";});
}
function setPrimary(id){
  post('set_primary',{agent_user_id:id}).then(function(d){
    if(d.ok)location.reload(); else alert(d.error||'Could not change that.');
  });
}
document.getElementById('btnDel').addEventListener('click',function(){
  var err=document.getElementById('delErr');err.textContent='';
  if(!confirm('Remove your buy-box and stop matching for you? This cannot be undone.'))return;
  if(SESSION){doDelete();return;}
  DEL_MODE=true;
  post('request_code').then(function(d){
    if(d.ok){document.getElementById('codeBox').style.display='block';
      document.getElementById('code').scrollIntoView({behavior:'smooth'});
      err.textContent='Enter the code we just sent to confirm.';}
    else{err.textContent=d.error||'Could not send a code.';DEL_MODE=false;}
  });
});
function doDelete(){
  post('delete',{session:SESSION}).then(function(d){
    if(d.ok){document.open();document.write('<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#100D09;color:#F6F1E7;text-align:center;padding:70px"><h2 style="font-family:Georgia,serif;font-weight:400">Removed.</h2><p style="color:#C8BFAE">Your buy-box is deleted and we\\'ve stopped matching for you. Thank you.</p></body>');document.close();}
    else{document.getElementById('delErr').textContent=d.error||'Could not delete.';}
  });
}
</script>
</div></body></html>`;
}

const dead = (msg: string) =>
  new Response(new TextEncoder().encode(
    `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;background:#100D09;color:#F6F1E7;text-align:center;padding:60px">
<h2 style="font-family:Georgia,serif;font-weight:400">${esc(msg)}</h2>
<p style="color:#C8BFAE">Please ask your agent for a fresh link.</p></body>`),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  if (!token) return dead("This link isn't active.");

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  if (req.method === "GET") {
    const { data, error } = await admin.rpc("investor_portal_get", { p_token: token });
    if (error || !data || !data.ok) return dead("This link isn't active.");
    return new Response(
      new TextEncoder().encode(page(data.buyer, data.agents || [], data.opportunity_count || 0, !!data.opportunities_available, token)),
      { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }

  if (req.method !== "POST") return j({ ok: false, error: "Method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch (_) { return j({ ok: false, error: "Bad request" }); }
  const action = String(body.action || "");

  try {
    if (action === "save") {
      const { data, error } = await admin.rpc("investor_portal_save", { p_token: token, p: body.payload || {} });
      if (error) return j({ ok: false, error: error.message });
      return j(data);
    }

    if (action === "set_primary") {
      const { data, error } = await admin.rpc("investor_portal_set_primary", { p_token: token, p_agent: body.agent_user_id });
      if (error) return j({ ok: false, error: error.message });
      return j(data);
    }

    if (action === "request_code") {
      const { data, error } = await admin.rpc("investor_portal_code_issue", { p_token: token });
      if (error) return j({ ok: false, error: error.message });
      if (!data || !data.ok) return j(data || { ok: false, error: "Could not send a code." });

      // Deliver from the PRIMARY agent's own line, so it arrives from someone the
      // investor recognises. SMS preferred; email is the fallback.
      const code = data.code as string;
      const text = `Your verification code is ${code}. It expires in 10 minutes.`;
      let channel = "";

      const wantsEmail = data.contact_pref === "email";
      if (!wantsEmail && data.phone) {
        const { data: qs } = await admin.from("quo_settings")
          .select("active_number").eq("user_id", data.owner_user_id).maybeSingle();
        const from = qs?.active_number;
        const apiKey = Deno.env.get("QUO_API_KEY");
        if (from && apiKey) {
          const r = await fetch(`${QUO_BASE}/v1/messages`, {
            method: "POST",
            headers: { "Authorization": apiKey, "Content-Type": "application/json" },
            body: JSON.stringify({ from, to: [data.phone], content: text }),
          });
          if (r.ok) channel = "phone";
        }
      }
      if (!channel && data.email) {
        // gmail-send needs an account_id belonging to that user; prefer their default
        const { data: acct } = await admin.from("email_accounts")
          .select("id").eq("user_id", data.owner_user_id)
          .order("is_default", { ascending: false }).limit(1).maybeSingle();
        if (acct?.id) {
          const { data: sent, error: sendErr } = await admin.functions.invoke("gmail-send", {
            headers: { "x-qcp-token": Deno.env.get("QCP_TOKEN") || "" },
            body: {
              user_id: data.owner_user_id, account_id: acct.id, to: data.email,
              subject: "Your verification code",
              body_text: `${text}\n\nIf you didn't request this, you can ignore this message.`,
              body_html: `<p>${text}</p><p style="color:#777">If you didn't request this, you can ignore this message.</p>`,
            },
          });
          if (!sendErr && !(sent && sent.error)) channel = "email";
        }
      }
      if (!channel) return j({ ok: false, error: "We couldn't reach you. Please contact your agent." });
      return j({ ok: true, channel });
    }

    if (action === "verify_code") {
      const { data, error } = await admin.rpc("investor_portal_code_verify", { p_token: token, p_code: String(body.code || "") });
      if (error) return j({ ok: false, error: error.message });
      if (!data || !data.ok) return j(data || { ok: false, error: "That code is not right." });
      const { data: m } = await admin.rpc("investor_portal_matches", { p_session: data.session });
      return j({ ok: true, session: data.session, items: (m && m.items) || [], gated: !!(m && m.gated) });
    }

    if (action === "interest") {
      const { data, error } = await admin.rpc("investor_portal_interest", { p_session: body.session, p_ref: body.ref });
      if (error) return j({ ok: false, error: error.message });
      if (data && data.notify_user_id) {
        try {
          await admin.functions.invoke("push-send", { body: {
            user_id: data.notify_user_id,
            title: "🔥 " + (data.buyer_name || "Your investor") + " flagged a match",
            body: "They tapped Interested on one of their opportunities. Tap to follow up.",
            url: "https://darasapp.com/?view=investor_pipeline&tab=matches", tag: "investor-interest",
          } });
        } catch (_) { /* best-effort */ }
      }
      return j({ ok: true });
    }

    if (action === "delete") {
      const { data, error } = await admin.rpc("investor_portal_delete", { p_session: body.session });
      if (error) return j({ ok: false, error: error.message });
      return j(data);
    }

    return j({ ok: false, error: "Unknown action" });
  } catch (err) {
    return j({ ok: false, error: String(err) });
  }
});
