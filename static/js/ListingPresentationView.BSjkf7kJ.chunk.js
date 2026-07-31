import{r as F,j as e}from"./vendor-react.DecIrkRQ.chunk.js";import{s as Q,d as we,i as he}from"./main.C_OR5OfS.js";import"./vendor-react-dom.CLTjDK3B.chunk.js";import"./vendor-supabase.Bv9NtBh5.chunk.js";import"./vendor.Ks84_326.chunk.js";function be(i,o,T={}){const H=i||{},P=(o||[]).map(c=>{const n=(c.adjustments||[]).reduce((a,w)=>a+Number(w.amount||0),0),b=Number(c.agent_adj||0),N=n+b,S=Number(c.sale_price||0),q=S+N,I=(c.adjustments||[]).reduce((a,w)=>a+Math.abs(Number(w.amount||0)),0),E=I+Math.abs(b);return{sale:S,adjusted:q,weight_gross_pct:S?I/S*100:100,gross_pct:S?E/S*100:100,net_pct:S?N/S*100:0,usable:q>0&&S>0}}),p=P.filter(c=>c.usable),M=p.filter(c=>c.weight_gross_pct<=25),s=M.length>=3?M:p;let y=null;if(s.length){let c=0,n=0;for(const b of s){const N=1/(1+Math.pow((b.weight_gross_pct||25)/10,2));c+=b.adjusted*N,n+=N}y=n?c/n:null}const _=c=>Math.round(c/1e3)*1e3;let g=0;const R=s.length;R>=5?g+=1.4:R>=4?g+=1.1:R>=3?g+=.8:R>=2&&(g+=.4);const z=s.map(c=>c.adjusted);if(z.length>=2&&y){const c=z.reduce((N,S)=>N+S,0)/z.length,n=Math.sqrt(z.reduce((N,S)=>N+Math.pow(S-c,2),0)/z.length),b=c?n/c:1;b<=.05?g+=1.6:b<=.08?g+=1.2:b<=.12?g+=.8:b<=.18&&(g+=.4)}H.gla&&(g+=.8);const l=z.length?[...s].map(c=>c.gross_pct).sort((c,n)=>c-n)[Math.floor(s.length/2)]:100;l<=8?g+=.9:l<=15?g+=.6:l<=25&&(g+=.3);const L=(T.research_confidence||"").toLowerCase();L==="high"?g+=.5:L==="medium"&&(g+=.25);let W=Math.max(1,Math.min(5,Math.round(g)));s.length||(W=1);const D=["","Low — verify before relying on it","Fair — treat as a starting point","Moderate — solid with local review","Strong — well-supported by comps","Very strong — tightly supported"][W];return{reconciled:y?_(y):null,tiers:y?{opportunistic:_(y*1.06),target:_(y),fast:_(y*.95)}:{opportunistic:null,target:null,fast:null},stars:W,confidence_label:D,comps_used:s.length,comps_total:P.length}}const fe=[{n:1,label:"Full Rehab",say:"“Down to the studs.” Everything needs replacing — this sells as a project to investors or renovators."},{n:2,label:"Major Overhaul",say:"“Good bones, big to-do list.” Structurally sound, but systems and finishes are all at the end of their life."},{n:3,label:"Heavy Updating",say:"“A fixer with real upside.” Livable for now, but kitchen, baths, and mechanicals all need work."},{n:4,label:"Dated but Solid",say:"“Tired, not broken.” Everything functions — the look is a generation behind."},{n:5,label:"Cosmetic Refresh",say:"“Paint, floors, and polish.” A solid home that shows and photographs better with light updates."},{n:6,label:"Well-Kept & Classic",say:"“Loved and maintained — just not on-trend.” Move-in ready with a timeless rather than current style."},{n:7,label:"Move-In Ready",say:"“Bring your toothbrush.” Nothing needs doing; a buyer might modernize a few touches over time."},{n:8,label:"Turnkey Modern",say:"“Updated and easy to love.” Current finishes — nothing on the buyer’s list for years."},{n:9,label:"Designer-Done",say:"“Magazine-ready.” Recently and tastefully renovated; it shows like a model home."},{n:10,label:"Flawless",say:"“Not one thing to change.” A buyer moves in and wouldn’t touch a single detail."}],ee=i=>fe.find(o=>o.n===Number(i))||fe[6],ve={analytical:{eyebrow:"The evidence, in order",intro:"Every number here is defensible and sourced. Read it top to bottom — the pricing follows from the data, not the other way around."},direct:{eyebrow:"The bottom line first",intro:"Here is where your home stands, what it’s worth, and what you’ll net. The detail is below if you want it — but the headline is the number."},relational:{eyebrow:"Your home’s next chapter",intro:"You’ve made this house a home. Here’s how we honor that story while positioning it to sell for everything it’s worth — together."},auto:{eyebrow:"Your listing strategy",intro:"A complete, defensible plan for pricing, positioning, and netting the most from the sale of your home."}},v=i=>String(i??"").replace(/[&<>"']/g,o=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[o]),V=i=>i||i===0?"$"+Number(i).toLocaleString("en-US",{maximumFractionDigits:0}):"—";function je(i){const o=i.subject||{},T=i.market||{},H=i.comps||[],P=i.tiers||{},p=i.netsheet||{},M=ee(o.condition_score),s=ve[i.seller_tone]||ve.auto,y=v(i.address||"Your Property"),_=v(i.agent_name||""),g="Realty ONE Group Advantage",R=v(i.seller_name||""),z=(i.hero_image_url||"").trim(),l=(i.agent_video_url||"").trim(),L=!!i.sign_mode,W=v(i.share_token||""),D=(()=>{if(!l)return"";const a=l.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]+)/);if(a)return`<iframe src="https://www.youtube.com/embed/${a[1]}" allow="fullscreen" style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px"></iframe>`;const w=l.match(/vimeo\.com\/(\d+)/);return w?`<iframe src="https://player.vimeo.com/video/${w[1]}" allow="fullscreen" style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px"></iframe>`:/\.(mp4|webm|mov)(\?|$)/i.test(l)?`<video src="${v(l)}" controls playsinline style="width:100%;border-radius:14px;background:#000"></video>`:""})(),c=Number(p.commission_pct??6)/100,n=a=>{if(!a)return null;const w=a*c,B=Number(p.title_fees||0),O=Number(p.tax_proration||0),U=Number(p.mortgage_payoff||0),J=Number(p.other||0);return a-w-B-O-U-J},b=be(o,H,{research_confidence:i.research_confidence}),N=(a,w,B)=>{const O=Number(a||0);return O>0?O:b.tiers&&b.tiers[w]?b.tiers[w]:0},S=[{key:"opportunistic",label:"Opportunistic",sub:"Test the ceiling",price:N(P.opportunistic,"opportunistic"),dom:"Longer",prob:"Lower"},{key:"target",label:"Target Market",sub:"Priced to sell right",price:N(P.target,"target"),dom:"Market pace",prob:"Strong"},{key:"fast",label:"Fast Sale",sub:"Move it quickly",price:N(P.fast,"fast"),dom:"Fastest",prob:"Highest"}],q=a=>Array.from({length:5},(w,B)=>`<span style="color:${B<a?"var(--gold)":"rgba(203,163,92,.25)"};font-size:20px">★</span>`).join(""),I=H.map((a,w)=>{const B=(a.adjustments||[]).filter(r=>Number(r.amount)!==0).slice(),O=Number(a.agent_adj||0);O&&B.push({label:"Agent adjustment",amount:O});const U=B.reduce((r,m)=>r+Number(m.amount||0),0),J=Number(a.sale_price||0)+U,t=B.length?`<div class="adj-items">${B.map(r=>`<span class="adj-item"><span class="adj-lab">${v(r.label)}</span><span class="${Number(r.amount)>=0?"pos":"neg"}">${Number(r.amount)>=0?"+":"−"}${V(Math.abs(Number(r.amount)))}</span></span>`).join("")}</div>`:"";return`<tr>
      <td class="comp-addr">${v(a.address||"Comp "+(w+1))}${t}</td>
      <td>${V(a.sale_price)}</td>
      <td>${a.gla?v(a.gla)+" sf":"—"}</td>
      <td class="${U>=0?"pos":"neg"}">${U>=0?"+":"−"}${V(Math.abs(U))}</td>
      <td class="adjusted">${V(J)}</td>
    </tr>`}).join(""),E=[];return o.gla&&E.push(["GLA",v(o.gla)+" sf"]),o.beds&&E.push(["Beds",v(o.beds)]),o.baths&&E.push(["Baths",v(o.baths)]),o.lot_size&&E.push(["Lot",v(o.lot_size)]),o.year_built&&E.push(["Built",v(o.year_built)]),E.push(["Condition",M.n+"/10 · "+v(M.label)]),`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${y} — Listing Presentation</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500&family=Manrope:wght@400;500;600;700;800&family=Barlow+Condensed:wght@600;700&display=swap" rel="stylesheet">
<style>
  :root{--ink:#100D09;--cream:#F6F1E7;--gold:#CBA35C;--champ:#EBCB82;--dgold:#9A8038;--mut:#8C8475;--line:rgba(203,163,92,.22);--card:#171310;}
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{background:var(--ink);color:var(--cream);font-family:Manrope,system-ui,sans-serif;line-height:1.6;-webkit-font-smoothing:antialiased}
  .wrap{max-width:1040px;margin:0 auto;padding:0 24px}
  .eyebrow{font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);font-size:13px}
  h1,h2,h3{font-family:Fraunces,Georgia,serif;font-weight:400;line-height:1.1}
  section{padding:76px 0;border-bottom:1px solid var(--line)}
  .mod-num{font-family:Fraunces,serif;font-size:15px;color:var(--dgold);letter-spacing:.1em}
  /* HERO */
  .hero{min-height:78vh;display:flex;flex-direction:column;justify-content:center;background:radial-gradient(120% 90% at 80% -10%,rgba(203,163,92,.14),transparent 60%),linear-gradient(180deg,#0c0a07,var(--ink));border-bottom:1px solid var(--line);position:relative}
  .hero.has-photo{background-size:cover;background-position:center}
  .printbtn{position:absolute;top:calc(18px + env(safe-area-inset-top,0px));right:20px;background:rgba(203,163,92,.14);border:1px solid var(--line);color:var(--gold);border-radius:100px;padding:8px 15px;font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.08em;font-size:14px;cursor:pointer}
  @media print{.printbtn{display:none}}
  /* equity over time */
  .equity{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:0;margin-top:24px;font-size:15px;border:1px solid var(--line);border-radius:14px;overflow:hidden}
  .equity>div{padding:14px 16px;border-bottom:1px solid rgba(203,163,92,.1)}
  .equity .eh{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.1em;color:var(--gold);font-size:13px;background:rgba(203,163,92,.06)}
  .equity .er{color:#c9bfa9}.equity .en{color:var(--champ);font-weight:800;text-align:right}
  .equity .ev{color:var(--cream);text-align:right}
  /* signature pad */
  .signwrap{max-width:560px}
  .sigpad{background:#fff;border-radius:12px;touch-action:none;width:100%;height:170px;display:block;cursor:crosshair}
  .sign-row{display:flex;gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap}
  .sign-row input[type=text]{flex:1 1 200px;background:#0c0a07;border:1px solid var(--line);color:var(--cream);border-radius:10px;padding:11px 13px;font-size:15px}
  .sign-consent{display:flex;gap:9px;align-items:flex-start;margin-top:12px;color:#c9bfa9;font-size:13px;line-height:1.5}
  .sign-btn{background:var(--champ);color:var(--ink);border:none;border-radius:100px;padding:13px 26px;font-weight:800;font-size:15px;cursor:pointer}
  .sign-clear{background:none;border:1px solid var(--line);color:var(--mut);border-radius:10px;padding:11px 16px;cursor:pointer;font-size:13px}
  .hero h1{font-size:clamp(40px,7vw,84px);color:var(--cream);margin:14px 0 8px}
  .hero .sub{font-family:Fraunces,serif;font-style:italic;color:var(--champ);font-size:clamp(20px,3vw,30px)}
  .brandline{display:flex;align-items:center;gap:10px;margin-top:34px;color:var(--mut);font-size:13px;letter-spacing:.06em}
  .fork{width:22px;height:22px;color:var(--gold)}
  .badges{display:flex;flex-wrap:wrap;gap:10px;margin-top:30px}
  .badge{border:1px solid var(--line);border-radius:100px;padding:8px 15px;font-size:13px;color:var(--cream);background:rgba(203,163,92,.06)}
  .badge b{color:var(--gold);font-weight:800;margin-right:6px}
  /* generic card */
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:26px}
  .lead{font-size:19px;color:#d9d0bd;max-width:70ch}
  h2.title{font-size:clamp(28px,4vw,42px);color:var(--cream);margin:10px 0 22px}
  /* market meter */
  .meter{height:14px;border-radius:100px;background:linear-gradient(90deg,#7fae8f,var(--champ),#e0794f);position:relative;margin:20px 0 8px}
  .meter .pin{position:absolute;top:-7px;width:4px;height:28px;background:var(--cream);border-radius:3px;box-shadow:0 0 0 3px var(--ink)}
  .grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:8px}
  .stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
  .stat .k{font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em}
  .stat .v{font-family:Fraunces,serif;font-size:30px;color:var(--gold);margin-top:4px}
  /* comps table */
  table{width:100%;border-collapse:collapse;margin-top:8px;font-size:15px}
  th{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.1em;color:var(--gold);font-size:13px;text-align:left;padding:12px 10px;border-bottom:1px solid var(--line)}
  td{padding:14px 10px;border-bottom:1px solid rgba(203,163,92,.1)}
  td.comp-addr{color:var(--cream);font-weight:600}
  .adj-items{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:6px;font-weight:400}
  .adj-item{display:inline-flex;gap:5px;font-size:11px;white-space:nowrap}
  .adj-item .adj-lab{color:var(--mut)}
  td.adjusted{color:var(--champ);font-weight:800}
  .pos{color:#7fae8f}.neg{color:#e0794f}
  /* condition strip */
  .cond{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
  .cond .dial{font-family:Fraunces,serif;font-size:56px;color:var(--gold);line-height:1}
  .cond .of{color:var(--mut);font-size:22px}
  /* tiers */
  .tiers{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
  .tier{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px;position:relative}
  .tier.target{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold),0 20px 60px -30px rgba(203,163,92,.5)}
  .tier .tlab{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.12em;color:var(--gold);font-size:14px}
  .tier .price{font-family:Fraunces,serif;font-size:38px;color:var(--cream);margin:6px 0}
  .tier .sub{color:var(--mut);font-size:14px}
  .tier .meta{margin-top:14px;font-size:13px;color:#c9bfa9;display:flex;justify-content:space-between;border-top:1px solid var(--line);padding-top:12px}
  .flag{position:absolute;top:-11px;right:18px;background:var(--gold);color:var(--ink);font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.1em;font-size:12px;padding:3px 12px;border-radius:100px}
  /* net sheet */
  .ns{display:grid;grid-template-columns:1fr;gap:0;max-width:560px}
  .ns .row{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid rgba(203,163,92,.1)}
  .ns .row.net{border-top:2px solid var(--gold);border-bottom:none;margin-top:6px;padding-top:16px}
  .ns .row.net .lab{color:var(--champ);font-weight:800}.ns .row.net .val{font-family:Fraunces,serif;font-size:28px;color:var(--champ)}
  .ns .lab{color:#c9bfa9}.ns .val{color:var(--cream);font-weight:700}
  .calc{margin-top:20px}
  .calc label{display:block;font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px}
  .calc input{background:#0c0a07;border:1px solid var(--line);color:var(--cream);border-radius:10px;padding:11px 13px;font-size:16px;width:220px;font-family:Manrope}
  /* timeline */
  .phases{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;counter-reset:ph}
  .phase{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;position:relative}
  .phase::before{counter-increment:ph;content:counter(ph);font-family:Fraunces,serif;font-size:34px;color:var(--dgold);opacity:.6}
  .phase h4{font-family:Manrope;font-weight:800;color:var(--cream);margin:6px 0 6px;font-size:16px}
  .phase p{color:#b8ad98;font-size:14px}
  /* cta */
  .cta{text-align:center;padding:90px 0}
  .cta h2{font-size:clamp(30px,5vw,52px);color:var(--cream)}
  .cta .btn{display:inline-block;margin-top:22px;background:var(--champ);color:var(--ink);font-weight:800;padding:15px 34px;border-radius:100px;text-decoration:none;font-size:16px}
  footer{padding:40px 0;text-align:center;color:var(--mut);font-size:13px}
  .disc-note{margin-top:10px;font-size:13px;color:var(--mut);font-style:italic}
  @media print{body{background:#fff;color:#111}.hero,section{border-color:#ddd}.card,.stat,.tier,.phase{background:#fafafa;border-color:#ddd}}
</style></head>
<body>
  <header class="hero${z?" has-photo":""}"${z?` style="background-image:linear-gradient(180deg,rgba(16,13,9,.55),rgba(16,13,9,.92)),url('${v(z)}')"`:""}><div class="wrap">
    <div class="eyebrow">${R?"Prepared exclusively for "+R:v(s.eyebrow)}</div>
    <h1>${y}</h1>
    <div class="sub">Executive Listing Presentation</div>
    <div class="badges">${E.map(([a,w])=>`<span class="badge"><b>${a}</b>${w}</span>`).join("")}</div>
    <div class="brandline">
      <svg class="fork" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v8a4 4 0 0 0 8 0V3M12 15v6"/></svg>
      <span>${g} · powered by <i style="font-family:Fraunces,serif;color:var(--champ)">Prism</i>${_?" · "+_:""}</span>
    </div>
  </div>
  <button class="printbtn" onclick="window.print()" title="Save as PDF or print">⤓ PDF</button>
  </header>
  ${D?`<section style="padding-top:56px"><div class="wrap"><div class="eyebrow">A word from your agent</div><h2 class="title" style="margin-bottom:18px">${_?"Hi"+(R?" "+R.split(" ")[0]:"")+" — a quick hello":"Welcome"}</h2><div class="card" style="padding:14px">${D}</div></div></section>`:""}

  <!-- MODULE 1 -->
  <section><div class="wrap">
    <div class="mod-num">01</div><div class="eyebrow">Property Profile</div>
    <h2 class="title">${y}</h2>
    <p class="lead">${v(s.intro)}</p>
    <div class="grid3" style="margin-top:24px">
      ${o.upgrades?`<div class="stat"><div class="k">Recent Upgrades</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${v(o.upgrades)}</div></div>`:""}
      ${o.hidden_changes?`<div class="stat"><div class="k">Not in Public Record</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${v(o.hidden_changes)}</div></div>`:""}
      ${o.motivation?`<div class="stat"><div class="k">Owner Objective</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${v(o.motivation)}</div></div>`:""}
    </div>
    <div class="card" style="margin-top:20px">
      <div class="eyebrow">Condition Assessment</div>
      <div class="cond" style="margin-top:12px">
        <div class="dial">${M.n}<span class="of">/10</span></div>
        <div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--champ)">${v(M.label)}</div>
        <div style="color:#c9bfa9;margin-top:4px;max-width:52ch">${v(M.say)}</div></div>
      </div>
    </div>
  </div></section>

  <!-- MODULE 2 -->
  <section><div class="wrap">
    <div class="mod-num">02</div><div class="eyebrow">Micro-Market Dynamics</div>
    <h2 class="title">How fast this market is moving</h2>
    <div class="meter"><div class="pin" style="left:${Math.min(95,Math.max(3,Number(T.speed||50)))}%"></div></div>
    <div style="display:flex;justify-content:space-between;color:var(--mut);font-size:13px"><span>Buyer’s market</span><span>Balanced</span><span>Seller’s market</span></div>
    <div class="grid3" style="margin-top:26px">
      <div class="stat"><div class="k">Months of Inventory</div><div class="v">${T.moi??"—"}</div></div>
      <div class="stat"><div class="k">List-to-Sale</div><div class="v">${T.list_to_sale?v(T.list_to_sale)+"%":"—"}</div></div>
      <div class="stat"><div class="k">Active / Pending / Closed</div><div class="v" style="font-size:22px">${v(T.active||"—")} / ${v(T.pending||"—")} / ${v(T.closed||"—")}</div></div>
    </div>
  </div></section>

  <!-- MODULE 3 -->
  <section><div class="wrap">
    <div class="mod-num">03</div><div class="eyebrow">Comparables & Adjustments</div>
    <h2 class="title">The math behind the price</h2>
    <p class="lead">These are the homes a buyer and their appraiser will measure yours against. We adjust line-by-line for the real differences — so the number is defensible, not a guess.</p>
    ${H.length?`<table><thead><tr><th>Comparable</th><th>Sold</th><th>Size</th><th>Adjustment</th><th>Adjusted</th></tr></thead><tbody>${I}</tbody></table>`:'<p style="color:var(--mut);margin-top:20px">Comparable properties will be added here.</p>'}
  </div></section>

  <!-- MODULE 4 -->
  <section><div class="wrap">
    <div class="mod-num">04</div><div class="eyebrow">Marketing & Launch Plan</div>
    <h2 class="title">How we bring buyers to the door</h2>
    <div class="phases" style="margin-top:8px">
      <div class="phase"><h4>Pre-Launch</h4><p>Staging direction, professional photography, video, and copy — the home is dressed to sell before a single buyer sees it.</p></div>
      <div class="phase"><h4>Launch Week</h4><p>Coordinated MLS debut, just-listed campaign to matched buyers, social, and a curated first-weekend showing schedule.</p></div>
      <div class="phase"><h4>Active Exposure</h4><p>Targeted digital ads, open houses, and weekly feedback loops with pricing checkpoints against real buyer response.</p></div>
      <div class="phase"><h4>Escrow Management</h4><p>Offer strategy, negotiation, and deadline-by-deadline management through to a clean close.</p></div>
    </div>
  </div></section>

  <!-- MODULE 5 -->
  <section><div class="wrap">
    <div class="mod-num">05</div><div class="eyebrow">Strategic Pricing</div>
    <h2 class="title">Three ways to position — your call</h2>
    <p class="lead">There isn’t one right price; there’s a right price for <i>your</i> timeline. Here’s the trade-off between reaching for more and selling faster.</p>
    ${b.reconciled?`<div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:18px 0 6px;padding:14px 18px;background:rgba(203,163,92,.06);border:1px solid rgba(203,163,92,.2);border-radius:12px">
      <div><div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);font-weight:700">Valuation confidence</div>
      <div style="margin-top:2px">${q(b.stars)}</div></div>
      <div style="flex:1;min-width:180px;color:var(--mut);font-size:13px;line-height:1.5">${v(b.confidence_label)} — reconciled from ${b.comps_used} adjusted comparable${b.comps_used===1?"":"s"}.</div>
    </div>`:""}
    <div class="tiers" style="margin-top:24px">
      ${S.map(a=>`<div class="tier ${a.key==="target"?"target":""}">${a.key==="target"?'<div class="flag">Recommended</div>':""}
        <div class="tlab">${a.label}</div><div class="price">${a.price>0?V(a.price):'<span style="font-size:20px;color:var(--mut);font-weight:400">To be set</span>'}</div><div class="sub">${a.sub}</div>
        <div class="meta"><span>Days on market: ${a.dom}</span><span>Sale odds: ${a.prob}</span></div></div>`).join("")}
    </div>
  </div></section>

  <!-- MODULE 6 -->
  <section><div class="wrap">
    <div class="mod-num">06</div><div class="eyebrow">Your Net Proceeds</div>
    <h2 class="title">What you actually walk away with</h2>
    <p class="lead">Your equity is the price minus what you still owe. Here's how it lands at each pricing strategy — then try any number yourself.</p>
    <div class="equity">
      <div class="eh">Strategy</div><div class="eh en">Sale price</div><div class="eh en">Less payoff & costs</div><div class="eh en">Net to you</div>
      ${S.filter(a=>a.price).map(a=>{const w=n(a.price),B=a.price-(w||0);return`<div class="er">${a.label}</div><div class="ev">${V(a.price)}</div><div class="ev">−${V(B)}</div><div class="en">${V(w)}</div>`}).join("")}
    </div>
    <div class="card" style="margin-top:20px">
      <div class="ns" id="nsTable"></div>
      <div class="calc">
        <label for="salePrice">Try any sale price</label>
        <input id="salePrice" type="text" inputmode="numeric" value="${P.target||""}" placeholder="Enter a price">
      </div>
    </div>
  </div></section>
  ${L?`
  <!-- SIGN ON THE SPOT (seller share only) -->
  <section id="signSection"><div class="wrap">
    <div class="mod-num">07</div><div class="eyebrow">Ready to move forward</div>
    <h2 class="title">Sign to get started</h2>
    <p class="lead">If you're ready to list with ${_||"us"}, sign below. This records your intent to proceed and notifies your agent right away — they'll follow up with the full agreement.</p>
    <div class="signwrap card" style="margin-top:18px">
      <div style="font-size:12px;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;margin-bottom:8px">Sign here</div>
      <canvas id="sigpad" class="sigpad"></canvas>
      <div class="sign-row"><input id="sigName" type="text" placeholder="Type your full legal name"><button class="sign-clear" onclick="sigClear()">Clear</button></div>
      <label class="sign-consent"><input type="checkbox" id="sigConsent" style="margin-top:3px"><span>I agree that this electronic signature reflects my intent to move forward with listing this property, and I understand my agent will contact me with the formal listing agreement.</span></label>
      <div style="margin-top:16px"><button class="sign-btn" onclick="doSign()">Sign & notify my agent</button></div>
      <div id="sigMsg" style="margin-top:12px;font-size:14px"></div>
    </div>
  </div></section>`:""}

  <div class="cta"><div class="wrap">
    <div class="eyebrow">Ready when you are</div>
    <h2>Let’s bring this home to market.</h2>
    ${_?`<p style="color:#c9bfa9;margin-top:10px">Prepared for you by ${_}, ${g}.</p>`:""}
  </div></div>
  <footer><div class="wrap">${g} · powered by <i style="font-family:Fraunces,serif;color:var(--champ)">Prism</i> · This presentation is confidential and prepared for the property owner.</div></footer>

<script>
  var NS = ${JSON.stringify({commissionPct:c,title:Number(p.title_fees||0),tax:Number(p.tax_proration||0),payoff:Number(p.mortgage_payoff||0),other:Number(p.other||0)})};
  function money(n){ return (n||n===0) ? '$'+Math.round(n).toLocaleString('en-US') : '—'; }
  function renderNet(price){
    var commission = price*NS.commissionPct;
    var net = price - commission - NS.title - NS.tax - NS.payoff - NS.other;
    var rows = [
      ['Sale price', price], ['Brokerage commission', -commission],
      ['Mortgage payoff', -NS.payoff], ['Title & closing', -NS.title],
      ['Tax proration', -NS.tax], ['Other', -NS.other]
    ].filter(function(r){ return r[1] !== 0 || r[0]==='Sale price'; });
    var html = rows.map(function(r){ return '<div class="row"><span class="lab">'+r[0]+'</span><span class="val">'+(r[1]<0?'−':'')+money(Math.abs(r[1]))+'</span></div>'; }).join('');
    html += '<div class="row net"><span class="lab">Estimated net to you</span><span class="val">'+money(net)+'</span></div>';
    document.getElementById('nsTable').innerHTML = html;
  }
  var input = document.getElementById('salePrice');
  function parse(v){ return Number(String(v).replace(/[^0-9.]/g,''))||0; }
  input.addEventListener('input', function(){ renderNet(parse(input.value)); });
  renderNet(parse(input.value));
  ${L?`
  // signature pad
  (function(){
    var c = document.getElementById('sigpad'); if(!c) return;
    function fit(){ var r=c.getBoundingClientRect(); c.width=r.width*2; c.height=r.height*2; var x=c.getContext('2d'); x.scale(2,2); x.lineWidth=2.2; x.lineCap='round'; x.strokeStyle='#111'; }
    fit(); window.addEventListener('resize', fit);
    var x=c.getContext('2d'), drawing=false, dirty=false, last=null;
    function pos(e){ var r=c.getBoundingClientRect(); var t=e.touches?e.touches[0]:e; return {x:t.clientX-r.left, y:t.clientY-r.top}; }
    function down(e){ drawing=true; last=pos(e); e.preventDefault(); }
    function move(e){ if(!drawing) return; var p=pos(e); x.beginPath(); x.moveTo(last.x,last.y); x.lineTo(p.x,p.y); x.stroke(); last=p; dirty=true; e.preventDefault(); }
    function up(){ drawing=false; }
    c.addEventListener('mousedown',down); c.addEventListener('mousemove',move); window.addEventListener('mouseup',up);
    c.addEventListener('touchstart',down,{passive:false}); c.addEventListener('touchmove',move,{passive:false}); c.addEventListener('touchend',up);
    window.sigClear=function(){ x.clearRect(0,0,c.width,c.height); dirty=false; };
    window.doSign=async function(){
      var msg=document.getElementById('sigMsg');
      var name=(document.getElementById('sigName').value||'').trim();
      var consent=document.getElementById('sigConsent').checked;
      if(!dirty){ msg.style.color='#e0794f'; msg.textContent='Please sign in the box above.'; return; }
      if(!name){ msg.style.color='#e0794f'; msg.textContent='Please type your full legal name.'; return; }
      if(!consent){ msg.style.color='#e0794f'; msg.textContent='Please check the box to confirm.'; return; }
      msg.style.color='#c9bfa9'; msg.textContent='Recording…';
      try{
        var res=await fetch('${i.supabase_url||""}/functions/v1/listing-present?sign=1&t=${W}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name,drawn:c.toDataURL('image/png'),consent:consent,ua:navigator.userAgent})});
        var j=await res.json();
        if(j.ok){ msg.style.color='#7fae8f'; msg.textContent='✓ '+j.message; document.querySelector('.sign-btn').style.display='none'; }
        else { msg.style.color='#e0794f'; msg.textContent=j.message||'Could not record the signature.'; }
      }catch(e){ msg.style.color='#e0794f'; msg.textContent='Network issue — please try again.'; }
    };
  })();`:""}
<\/script>
</body></html>`}const A="#CBA35C",te="#EBCB82",ye="#100D09",_e=i=>i||i===0?"$"+Number(i).toLocaleString("en-US"):"",ke=()=>(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)).replace(/-/g,"").slice(0,22),xe=i=>{if(!i)return"";const o=Math.floor((Date.now()-new Date(i).getTime())/1e3);return o<60?"just now":o<3600?Math.floor(o/60)+"m ago":o<86400?Math.floor(o/3600)+"h ago":Math.floor(o/86400)+"d ago"};function Ne({userId:i,agentName:o}){const[T,H]=F.useState(null),[P,p]=F.useState("list"),[M,s]=F.useState(null),[y,_]=F.useState(null),g=F.useCallback(async()=>{const{data:l}=await Q.from("listing_presentations").select("*").eq("user_id",i).order("updated_at",{ascending:!1});H(l||[])},[i]);F.useEffect(()=>{g()},[g]);const R=()=>({title:"",address:"",contact_id:null,deal_id:null,seller_tone:"auto",seller_name:"",hero_image_url:"",agent_video_url:"",subject:{gla:"",beds:"",baths:"",lot_size:"",year_built:"",condition_score:7,upgrades:"",hidden_changes:"",motivation:""},market:{speed:55,moi:"",list_to_sale:"",active:"",pending:"",closed:""},comps:[{address:"",sale_price:"",gla:"",adjustments:[]}],tiers:{opportunistic:"",target:"",fast:""},netsheet:{commission_pct:6,mortgage_payoff:"",title_fees:"",tax_proration:"",other:""}}),z=(l,L=!0)=>{_({t:l,ok:L}),setTimeout(()=>_(null),4e3)};return P==="edit"?e.jsx(Se,{initial:M,userId:i,agentName:o,onDone:()=>{p("list"),g()},onCancel:()=>p("list"),flash:z,notify:y}):e.jsxs("div",{style:{maxWidth:900,margin:"0 auto",padding:"0 4px 40px"},children:[e.jsx(we,{screen:"listing_presentation"}),y&&e.jsx("div",{style:{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:5e3,background:y.ok?"#1a3a2a":"#3a1a1a",border:`1px solid ${y.ok?"#7fae8f":"#e0794f"}`,color:"#fff",padding:"12px 18px",borderRadius:10,fontSize:14,maxWidth:"90vw"},children:y.t}),e.jsx("div",{style:{marginBottom:6},children:e.jsx("span",{style:{fontFamily:"Barlow Condensed,sans-serif",fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",color:A,fontSize:13},children:"Win the listing"})}),e.jsx("h1",{style:{fontFamily:"Fraunces,serif",fontWeight:400,fontSize:34,color:"var(--text-1)",margin:"0 0 6px"},children:"Listing Presentations"}),e.jsx("p",{style:{color:"var(--text-2)",fontSize:15,margin:"0 0 20px",maxWidth:"62ch"},children:"Turn an address into an executive, DISC-aware valuation dossier — pricing, comps, a launch plan, and a live net-sheet — as a branded web presentation you can present, email, or share with the seller."}),e.jsx("button",{onClick:()=>{s(R()),p("edit")},style:{background:te,color:ye,border:"none",borderRadius:10,padding:"13px 22px",fontWeight:800,fontSize:15,cursor:"pointer"},children:"+ New Listing Presentation"}),e.jsx("div",{style:{marginTop:28},children:T===null?e.jsx("div",{style:{color:"var(--text-3)"},children:"Loading…"}):T.length===0?e.jsx("div",{style:{color:"var(--text-3)",fontSize:14,border:"1px dashed var(--border)",borderRadius:12,padding:"26px",textAlign:"center"},children:"No presentations yet. Build your first one — it takes about five minutes."}):T.map(l=>{var L,W,D,c;return e.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",marginBottom:10},children:[e.jsxs("div",{style:{minWidth:0},children:[e.jsx("div",{style:{fontWeight:700,color:"var(--text-1)",fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:l.title||l.address||"Untitled presentation"}),e.jsxs("div",{style:{fontSize:12,color:"var(--text-3)",marginTop:2},children:[ee((L=l.subject)==null?void 0:L.condition_score).n,"/10 · ",ee((W=l.subject)==null?void 0:W.condition_score).label,(D=l.tiers)!=null&&D.target?` · target ${_e(l.tiers.target)}`:"",l.share_enabled?" · 🔗 shared":"",l.view_count?` · ${l.view_count} views`:""]}),l.last_viewed_at&&e.jsxs("div",{style:{fontSize:12,color:"#7fae8f",marginTop:3,fontWeight:600},children:["👁 Seller viewed ",xe(l.last_viewed_at)]}),l.signed_at&&e.jsxs("div",{style:{fontSize:12,color:te,marginTop:3,fontWeight:700},children:["✍️ Signed ",xe(l.signed_at),(c=l.signature)!=null&&c.name?` by ${l.signature.name}`:""]})]}),e.jsx("div",{style:{display:"flex",gap:6,flexShrink:0},children:e.jsx("button",{onClick:()=>{s(l),p("edit")},style:Z,children:"Open"})})]},l.id)})})]})}const Z={background:"var(--bg-base)",border:"1px solid var(--border)",color:"var(--text-2)",borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer"},u={width:"100%",boxSizing:"border-box",background:"var(--bg-base)",border:"1px solid var(--border)",borderRadius:9,color:"var(--text-1)",padding:"10px 12px",fontSize:14},x={display:"block",fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)",margin:"0 0 6px"},K={fontFamily:"Barlow Condensed,sans-serif",fontWeight:700,letterSpacing:".16em",textTransform:"uppercase",color:A,fontSize:12,margin:"22px 0 10px"};function Se({initial:i,userId:o,agentName:T,onDone:H,onCancel:P,flash:p,notify:M}){var U,J;const[s,y]=F.useState(i),[_,g]=F.useState(!1),R=async()=>{var r,m,d;const t=(s.address||"").trim();if(!t){p("Enter the property address first.",!1);return}g(!0);try{const j=[((r=s.subject)==null?void 0:r.beds)&&`${s.subject.beds} bed`,((m=s.subject)==null?void 0:m.baths)&&`${s.subject.baths} bath`,((d=s.subject)==null?void 0:d.gla)&&`${s.subject.gla} sqft`].filter(Boolean).join(", "),{data:C,error:G}=await Q.functions.invoke("property-research",{body:{user_id:o,address:t,subject_hint:j}});if(G||!(C!=null&&C.ok)){p("Research came up empty — try again, or enter the numbers by hand below.",!1),g(!1);return}const k=C.data;y($=>{var ae,ie,ne,oe,le,de,ce,pe,ue,ge,me;const h={...$};h.subject={...$.subject};for(const f of["gla","beds","baths","lot_size","year_built"])(((ae=$.subject)==null?void 0:ae[f])===""||((ie=$.subject)==null?void 0:ie[f])==null)&&((ne=k.subject)==null?void 0:ne[f])!=null&&(h.subject[f]=k.subject[f]);h.market={...$.market},((oe=k.market)==null?void 0:oe.speed)!=null&&(h.market.speed=k.market.speed);for(const[f,Y]of[["moi","moi"],["list_to_sale","list_to_sale"],["active","active"],["pending","pending"],["closed","closed"]])(((le=$.market)==null?void 0:le[f])===""||((de=$.market)==null?void 0:de[f])==null)&&((ce=k.market)==null?void 0:ce[Y])!=null&&(h.market[f]=k.market[Y]);const X=(k.comps||[]).map(f=>({address:f.address||"",sale_price:f.sale_price||"",gla:f.gla||"",beds:f.beds??"",baths:f.baths??"",year_built:f.year_built??"",adjustments:Array.isArray(f.adjustments)?f.adjustments.map(Y=>({label:Y.label,amount:Y.amount})):[]}));if(X.length){const f=($.comps||[]).some(Y=>(Y.address||"").trim()||Number(Y.sale_price)>0);h.comps=f?[...$.comps,...X]:X}const re=((pe=k.valuation)==null?void 0:pe.tiers)||{};h.tiers={...$.tiers};for(const f of["opportunistic","target","fast"])(((ue=$.tiers)==null?void 0:ue[f])===""||((ge=$.tiers)==null?void 0:ge[f])==null||Number((me=$.tiers)==null?void 0:me[f])===0)&&re[f]!=null&&(h.tiers[f]=re[f]);return h._research={sources:k.sources||[],notes:k.notes||"",confidence:k.confidence||"low",valuation:k.valuation||null},h});const se=k.confidence==="high"?"strong":k.confidence==="medium"?"decent":"limited";p(`Pulled ${(k.comps||[]).length} comp(s) + market data from public sources (${se} match). Review and adjust the numbers below before presenting.`,!0)}catch{p("Research failed — please try again.",!1)}g(!1)},[z,l]=F.useState(!1),[L,W]=F.useState(i.id||null),[D,c]=F.useState(null),n=(t,r)=>y(m=>{const d={...m},j=t.split(".");return j.length===1?d[j[0]]=r:d[j[0]]={...d[j[0]],[j[1]]:r},d}),b=(t,r,m)=>y(d=>{const j=[...d.comps];return j[t]={...j[t],[r]:m},{...d,comps:j}}),N=()=>y(t=>({...t,comps:[...t.comps,{address:"",sale_price:"",gla:"",adjustments:[]}]})),S=t=>y(r=>({...r,comps:r.comps.filter((m,d)=>d!==t)})),q=ee(s.subject.condition_score),I=t=>{const r={};for(const m in t){const d=t[m];r[m]=d===""||d==null?null:isNaN(Number(d))?d:Number(d)}return r},E=()=>{var t,r,m,d,j,C;return{user_id:o,contact_id:s.contact_id||null,deal_id:s.deal_id||null,title:((t=s.title)==null?void 0:t.trim())||((r=s.address)!=null&&r.trim()?s.address.trim()+" — Listing Presentation":"Untitled presentation"),address:((m=s.address)==null?void 0:m.trim())||null,seller_tone:s.seller_tone,seller_name:((d=s.seller_name)==null?void 0:d.trim())||null,hero_image_url:((j=s.hero_image_url)==null?void 0:j.trim())||null,agent_video_url:((C=s.agent_video_url)==null?void 0:C.trim())||null,subject:I(s.subject),market:I(s.market),comps:(s.comps||[]).map(G=>({...G,sale_price:Number(G.sale_price)||0,gla:G.gla||null,adjustments:G.adjustments||[]})),tiers:I(s.tiers),netsheet:I(s.netsheet)}},a=(t={})=>{var r;return je({...E(),agent_name:T,supabase_url:he,research_confidence:((r=s._research)==null?void 0:r.confidence)||null,...t})},w=async()=>{l(!0);const t={...E(),html:a(),updated_at:new Date().toISOString()};let r;return L?r=await Q.from("listing_presentations").update(t).eq("id",L).select().single():r=await Q.from("listing_presentations").insert(t).select().single(),r.error?(p("Could not save: "+r.error.message,!1),l(!1),null):(W(r.data.id),l(!1),p("Saved."),r.data)},B=async()=>{const t=await w();if(!t)return;const r=window.open("","_blank");r?(r.document.write(t.html||a()),r.document.close()):p("Allow pop-ups to preview, or use Share/Email.",!1)},O=async()=>{const t=await w();if(!t)return;const r=t.share_token||ke(),m=a({sign_mode:!0,share_token:r}),{data:d,error:j}=await Q.from("listing_presentations").update({share_token:r,share_enabled:!0,html:m}).eq("id",t.id).select().single();if(j){p("Could not enable sharing: "+j.message,!1);return}const C=`${he}/functions/v1/listing-present?t=${d.share_token}`;c(C);try{await navigator.clipboard.writeText(C),p("Share link copied — send it to your seller.")}catch{p("Share link ready (copy it below).")}};return e.jsxs("div",{style:{maxWidth:780,margin:"0 auto",padding:"0 4px 60px"},children:[M&&e.jsx("div",{style:{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:5e3,background:M.ok?"#1a3a2a":"#3a1a1a",border:`1px solid ${M.ok?"#7fae8f":"#e0794f"}`,color:"#fff",padding:"12px 18px",borderRadius:10,fontSize:14,maxWidth:"90vw"},children:M.t}),e.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:16},children:[e.jsxs("div",{children:[e.jsxs("div",{style:{fontFamily:"Barlow Condensed,sans-serif",fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",color:A,fontSize:12},children:[L?"Editing":"New"," presentation"]}),e.jsx("h1",{style:{fontFamily:"Fraunces,serif",fontWeight:400,fontSize:26,color:"var(--text-1)",margin:"2px 0 0"},children:s.address||"Listing Presentation"})]}),e.jsx("button",{onClick:P,style:Z,children:"← Back"})]}),e.jsx("div",{style:K,children:"The property"}),e.jsxs("div",{style:{marginBottom:12},children:[e.jsx("label",{style:x,children:"Property address"}),e.jsxs("div",{style:{display:"flex",gap:8},children:[e.jsx("input",{style:{...u,flex:1},value:s.address,onChange:t=>n("address",t.target.value),placeholder:"4214 W Virginia Ave, Tampa, FL 33607"}),e.jsx("button",{onClick:R,disabled:_,title:"Research comps, market data & property facts from public sources (Zillow, Realtor, Redfin, county records)",style:{...Z,whiteSpace:"nowrap",opacity:_?.6:1,cursor:_?"wait":"pointer"},children:_?"⏳ Researching…":"✨ Auto-research"})]}),e.jsx("div",{style:{fontSize:11,color:"var(--text-3)",marginTop:5},children:"Pulls comparable sales, market speed and property facts from public sources (Zillow, Realtor.com, Redfin, county records) — a stand-in until your IDX feed is connected. Always review the numbers before presenting."}),s._research&&((U=s._research.sources)!=null&&U.length||s._research.notes)?e.jsxs("div",{style:{fontSize:11,color:"var(--text-3)",marginTop:6,padding:"8px 10px",background:"rgba(203,163,92,.06)",border:"1px solid rgba(203,163,92,.18)",borderRadius:8},children:[e.jsxs("b",{style:{color:"var(--text-2)"},children:["Research match: ",s._research.confidence,"."]})," ",s._research.notes?s._research.notes.slice(0,220):"",(J=s._research.sources)!=null&&J.length?e.jsxs("div",{style:{marginTop:4},children:["Sources: ",s._research.sources.slice(0,4).map((t,r)=>e.jsxs("a",{href:t,target:"_blank",rel:"noreferrer",style:{color:"var(--accent)",marginRight:8},children:["[",r+1,"]"]},r))]}):null]}):null]}),e.jsxs("div",{style:{marginBottom:12},children:[e.jsx("label",{style:x,children:"Seller name (personalizes the cover)"}),e.jsx("input",{style:u,value:s.seller_name,onChange:t=>n("seller_name",t.target.value),placeholder:"The Henderson Family"})]}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12},children:[e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Hero photo URL"}),e.jsx("input",{style:u,value:s.hero_image_url,onChange:t=>n("hero_image_url",t.target.value),placeholder:"https://…/front.jpg"})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Agent welcome video"}),e.jsx("input",{style:u,value:s.agent_video_url,onChange:t=>n("agent_video_url",t.target.value),placeholder:"YouTube / Vimeo / .mp4 link"})]})]}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,marginBottom:12},children:[e.jsxs("div",{children:[e.jsx("label",{style:x,children:"GLA (sq ft)"}),e.jsx("input",{style:u,value:s.subject.gla,onChange:t=>n("subject.gla",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Beds"}),e.jsx("input",{style:u,value:s.subject.beds,onChange:t=>n("subject.beds",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Baths"}),e.jsx("input",{style:u,value:s.subject.baths,onChange:t=>n("subject.baths",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Lot"}),e.jsx("input",{style:u,value:s.subject.lot_size,onChange:t=>n("subject.lot_size",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Year built"}),e.jsx("input",{style:u,value:s.subject.year_built,onChange:t=>n("subject.year_built",t.target.value)})]})]}),e.jsx("div",{style:K,children:"Property condition — 1 to 10"}),e.jsxs("div",{style:{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"18px"},children:[e.jsxs("div",{style:{display:"flex",alignItems:"baseline",gap:12,marginBottom:12},children:[e.jsxs("div",{style:{fontFamily:"Fraunces,serif",fontSize:42,color:A,lineHeight:1},children:[q.n,e.jsx("span",{style:{fontSize:20,color:"var(--text-3)"},children:"/10"})]}),e.jsx("div",{style:{fontFamily:"Fraunces,serif",fontSize:22,color:te},children:q.label})]}),e.jsx("input",{type:"range",min:"1",max:"10",step:"1",value:s.subject.condition_score,onChange:t=>n("subject.condition_score",Number(t.target.value)),style:{width:"100%",accentColor:A}}),e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text-3)",marginTop:2},children:[e.jsx("span",{children:"1 · Full rehab"}),e.jsx("span",{children:"10 · Flawless"})]}),e.jsx("div",{style:{marginTop:12,fontSize:14,color:"var(--text-2)",fontStyle:"italic",lineHeight:1.5,borderLeft:`2px solid ${A}`,paddingLeft:12},children:q.say})]}),e.jsxs("div",{style:{marginTop:12},children:[e.jsx("label",{style:x,children:"Upgrades & improvements"}),e.jsx("textarea",{style:{...u,minHeight:70,resize:"vertical"},value:s.subject.upgrades,onChange:t=>n("subject.upgrades",t.target.value),placeholder:"New roof (2024), quartz kitchen, impact windows, renovated primary bath…"})]}),e.jsxs("div",{style:{marginTop:12},children:[e.jsx("label",{style:x,children:"Changes not in public record"}),e.jsx("textarea",{style:{...u,minHeight:70,resize:"vertical"},value:s.subject.hidden_changes,onChange:t=>n("subject.hidden_changes",t.target.value),placeholder:"Lanai permitted & converted to a 4th bedroom; garage insulated as flex office; well added for irrigation…"})]}),e.jsxs("div",{style:{marginTop:12},children:[e.jsx("label",{style:x,children:"Owner motivation / objective"}),e.jsx("input",{style:u,value:s.subject.motivation,onChange:t=>n("subject.motivation",t.target.value),placeholder:"Relocating for work — needs to close by spring"})]}),e.jsx("div",{style:K,children:"Seller’s style (DISC framing)"}),e.jsx("div",{style:{display:"flex",gap:8,flexWrap:"wrap"},children:[["auto","Auto"],["analytical","Analytical (C)"],["direct","Direct (D)"],["relational","Relational (I/S)"]].map(([t,r])=>e.jsx("button",{onClick:()=>n("seller_tone",t),style:{padding:"7px 14px",borderRadius:100,cursor:"pointer",fontSize:13,fontWeight:s.seller_tone===t?700:500,border:`1px solid ${s.seller_tone===t?A:"var(--border)"}`,background:s.seller_tone===t?"rgba(203,163,92,.15)":"transparent",color:s.seller_tone===t?A:"var(--text-2)"},children:r},t))}),e.jsx("div",{style:K,children:"Micro-market"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10},children:[e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Months of inventory"}),e.jsx("input",{style:u,value:s.market.moi,onChange:t=>n("market.moi",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"List-to-sale %"}),e.jsx("input",{style:u,value:s.market.list_to_sale,onChange:t=>n("market.list_to_sale",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Active"}),e.jsx("input",{style:u,value:s.market.active,onChange:t=>n("market.active",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Pending"}),e.jsx("input",{style:u,value:s.market.pending,onChange:t=>n("market.pending",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Closed (90d)"}),e.jsx("input",{style:u,value:s.market.closed,onChange:t=>n("market.closed",t.target.value)})]})]}),e.jsxs("div",{style:{marginTop:10},children:[e.jsxs("label",{style:x,children:["Market speed (buyer’s ← → seller’s): ",s.market.speed]}),e.jsx("input",{type:"range",min:"0",max:"100",value:s.market.speed,onChange:t=>n("market.speed",Number(t.target.value)),style:{width:"100%",accentColor:A}})]}),e.jsx("div",{style:K,children:"Comparables"}),(()=>{var r;const t=be(s.subject,s.comps,{research_confidence:(r=s._research)==null?void 0:r.confidence});return e.jsxs(e.Fragment,{children:[s.comps.map((m,d)=>{const j=(m.adjustments||[]).reduce((h,X)=>h+Number(X.amount||0),0),C=Number(m.agent_adj||0),G=j+C,k=Number(m.sale_price)||0,se=k+G,$=Math.max(2e4,Math.round(k*.15/1e3)*1e3)||5e4;return e.jsxs("div",{style:{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:8},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:8},children:[e.jsxs("span",{style:{fontSize:12,color:"var(--text-3)",fontWeight:700},children:["Comp ",d+1]}),s.comps.length>1&&e.jsx("button",{onClick:()=>S(d),style:{background:"none",border:"none",color:"#e0794f",cursor:"pointer",fontSize:12},children:"Remove"})]}),e.jsx("input",{style:{...u,marginBottom:8},value:m.address,onChange:h=>b(d,"address",h.target.value),placeholder:"Comp address"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8},children:[e.jsx("input",{style:u,value:m.sale_price,onChange:h=>b(d,"sale_price",h.target.value),placeholder:"Sale price",inputMode:"numeric"}),e.jsx("input",{style:u,value:m.gla,onChange:h=>b(d,"gla",h.target.value),placeholder:"GLA (sq ft)",inputMode:"numeric"})]}),(m.adjustments||[]).length?e.jsx("div",{style:{marginTop:8,display:"flex",flexWrap:"wrap",gap:"4px 12px"},children:(m.adjustments||[]).filter(h=>Number(h.amount)!==0).map((h,X)=>e.jsxs("span",{style:{fontSize:11,whiteSpace:"nowrap"},children:[e.jsx("span",{style:{color:"var(--text-3)"},children:h.label})," ",e.jsxs("span",{style:{color:Number(h.amount)>=0?"#7fae8f":"#e0794f",fontWeight:600},children:[Number(h.amount)>=0?"+":"−","$",Math.abs(Number(h.amount)).toLocaleString()]})]},X))}):null,k>0?e.jsxs("div",{style:{marginTop:10,paddingTop:10,borderTop:"1px solid var(--border)"},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",fontSize:11,color:"var(--text-3)",marginBottom:4},children:[e.jsxs("span",{children:["Your adjustment ",C?e.jsxs("b",{style:{color:C>=0?"#7fae8f":"#e0794f"},children:[C>=0?"+":"−","$",Math.abs(C).toLocaleString()]}):e.jsx("span",{style:{opacity:.6},children:"drag to fine-tune"})]}),e.jsxs("span",{children:["Adjusted ",e.jsxs("b",{style:{color:"var(--accent)"},children:["$",se.toLocaleString()]})]})]}),e.jsx("input",{type:"range",min:-$,max:$,step:1e3,value:C,onChange:h=>b(d,"agent_adj",Number(h.target.value)),style:{width:"100%",accentColor:A}}),C?e.jsx("button",{onClick:()=>b(d,"agent_adj",0),style:{background:"none",border:"none",color:"var(--text-3)",cursor:"pointer",fontSize:10.5,marginTop:2,padding:0},children:"reset"}):null]}):null]},d)}),e.jsx("button",{onClick:N,style:{...Z,marginBottom:4},children:"+ Add comp"}),t.reconciled?e.jsxs("div",{style:{marginTop:14,padding:"14px 16px",background:"rgba(203,163,92,.06)",border:"1px solid rgba(203,163,92,.22)",borderRadius:12},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:10},children:[e.jsxs("div",{children:[e.jsx("div",{style:{fontSize:10.5,letterSpacing:".14em",textTransform:"uppercase",color:"var(--accent)",fontWeight:700},children:"Reconciled valuation"}),e.jsxs("div",{style:{fontSize:26,fontWeight:800,color:"var(--text-1)",fontFamily:"Fraunces, serif",marginTop:2},children:["$",t.reconciled.toLocaleString()]}),e.jsxs("div",{style:{fontSize:11,color:"var(--text-3)",marginTop:2},children:[t.tiers.fast?`$${t.tiers.fast.toLocaleString()} – $${t.tiers.opportunistic.toLocaleString()}`:""," · ",t.comps_used," of ",t.comps_total," comps used"]})]}),e.jsxs("div",{style:{textAlign:"right"},children:[e.jsx("div",{style:{fontSize:10.5,letterSpacing:".14em",textTransform:"uppercase",color:"var(--accent)",fontWeight:700},children:"Confidence"}),e.jsx("div",{style:{fontSize:20,letterSpacing:2,marginTop:2},children:Array.from({length:5},(m,d)=>e.jsx("span",{style:{color:d<t.stars?A:"rgba(203,163,92,.25)"},children:"★"},d))})]})]}),e.jsxs("div",{style:{fontSize:12,color:"var(--text-2)",marginTop:8,lineHeight:1.5},children:[t.confidence_label,". Tune any comp above and this updates live. Set explicit tier prices below to override."]})]}):null]})})(),e.jsx("div",{style:K,children:"Three-tier pricing"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8},children:[e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Opportunistic"}),e.jsx("input",{style:u,value:s.tiers.opportunistic,onChange:t=>n("tiers.opportunistic",t.target.value),inputMode:"numeric",placeholder:"729000"})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Target ★"}),e.jsx("input",{style:u,value:s.tiers.target,onChange:t=>n("tiers.target",t.target.value),inputMode:"numeric",placeholder:"699000"})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Fast sale"}),e.jsx("input",{style:u,value:s.tiers.fast,onChange:t=>n("tiers.fast",t.target.value),inputMode:"numeric",placeholder:"669000"})]})]}),e.jsx("div",{style:K,children:"Seller net sheet"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10},children:[e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Commission %"}),e.jsx("input",{style:u,value:s.netsheet.commission_pct,onChange:t=>n("netsheet.commission_pct",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Mortgage payoff"}),e.jsx("input",{style:u,value:s.netsheet.mortgage_payoff,onChange:t=>n("netsheet.mortgage_payoff",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Title & closing"}),e.jsx("input",{style:u,value:s.netsheet.title_fees,onChange:t=>n("netsheet.title_fees",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Tax proration"}),e.jsx("input",{style:u,value:s.netsheet.tax_proration,onChange:t=>n("netsheet.tax_proration",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:x,children:"Other"}),e.jsx("input",{style:u,value:s.netsheet.other,onChange:t=>n("netsheet.other",t.target.value),inputMode:"numeric"})]})]}),e.jsxs("div",{style:{position:"sticky",bottom:0,background:"linear-gradient(180deg,transparent,var(--bg-base) 30%)",paddingTop:20,marginTop:24},children:[e.jsxs("div",{style:{display:"flex",gap:8,flexWrap:"wrap"},children:[e.jsx("button",{onClick:w,disabled:z,style:{...Z,flex:"1 1 100px"},children:z?"Saving…":"Save"}),e.jsx("button",{onClick:B,disabled:z,style:{background:te,color:ye,border:"none",borderRadius:9,padding:"11px 20px",fontWeight:800,fontSize:14,cursor:"pointer",flex:"2 1 160px"},children:"▶ Preview presentation"}),e.jsx("button",{onClick:O,disabled:z,style:{...Z,flex:"1 1 120px"},children:"🔗 Share with seller"})]}),D&&e.jsx("div",{style:{marginTop:10,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",fontSize:12,color:"var(--text-2)",wordBreak:"break-all"},children:D})]})]})}export{Ne as default};
