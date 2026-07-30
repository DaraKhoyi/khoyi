import{r as S,j as e}from"./vendor-react.DecIrkRQ.chunk.js";import{s as W,i as q}from"./main.ZR4Z_VRN.js";import"./vendor-react-dom.CLTjDK3B.chunk.js";import"./vendor-supabase.Bv9NtBh5.chunk.js";import"./vendor.Ks84_326.chunk.js";const G=[{n:1,label:"Full Rehab",say:"“Down to the studs.” Everything needs replacing — this sells as a project to investors or renovators."},{n:2,label:"Major Overhaul",say:"“Good bones, big to-do list.” Structurally sound, but systems and finishes are all at the end of their life."},{n:3,label:"Heavy Updating",say:"“A fixer with real upside.” Livable for now, but kitchen, baths, and mechanicals all need work."},{n:4,label:"Dated but Solid",say:"“Tired, not broken.” Everything functions — the look is a generation behind."},{n:5,label:"Cosmetic Refresh",say:"“Paint, floors, and polish.” A solid home that shows and photographs better with light updates."},{n:6,label:"Well-Kept & Classic",say:"“Loved and maintained — just not on-trend.” Move-in ready with a timeless rather than current style."},{n:7,label:"Move-In Ready",say:"“Bring your toothbrush.” Nothing needs doing; a buyer might modernize a few touches over time."},{n:8,label:"Turnkey Modern",say:"“Updated and easy to love.” Current finishes — nothing on the buyer’s list for years."},{n:9,label:"Designer-Done",say:"“Magazine-ready.” Recently and tastefully renovated; it shows like a model home."},{n:10,label:"Flawless",say:"“Not one thing to change.” A buyer moves in and wouldn’t touch a single detail."}],O=s=>G.find(o=>o.n===Number(s))||G[6],Y={analytical:{eyebrow:"The evidence, in order",intro:"Every number here is defensible and sourced. Read it top to bottom — the pricing follows from the data, not the other way around."},direct:{eyebrow:"The bottom line first",intro:"Here is where your home stands, what it’s worth, and what you’ll net. The detail is below if you want it — but the headline is the number."},relational:{eyebrow:"Your home’s next chapter",intro:"You’ve made this house a home. Here’s how we honor that story while positioning it to sell for everything it’s worth — together."},auto:{eyebrow:"Your listing strategy",intro:"A complete, defensible plan for pricing, positioning, and netting the most from the sale of your home."}},p=s=>String(s??"").replace(/[&<>"']/g,o=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[o]),L=s=>s||s===0?"$"+Number(s).toLocaleString("en-US",{maximumFractionDigits:0}):"—";function J(s){const o=s.subject||{},b=s.market||{},R=s.comps||[],T=s.tiers||{},g=s.netsheet||{},y=O(o.condition_score),i=Y[s.seller_tone]||Y.auto,f=p(s.address||"Your Property"),x=p(s.agent_name||""),w="Realty ONE Group Advantage",j=p(s.seller_name||""),M=(s.hero_image_url||"").trim(),l=(s.agent_video_url||"").trim(),C=!!s.sign_mode,n=p(s.share_token||""),z=(()=>{if(!l)return"";const r=l.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([\w-]+)/);if(r)return`<iframe src="https://www.youtube.com/embed/${r[1]}" allow="fullscreen" style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px"></iframe>`;const h=l.match(/vimeo\.com\/(\d+)/);return h?`<iframe src="https://player.vimeo.com/video/${h[1]}" allow="fullscreen" style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px"></iframe>`:/\.(mp4|webm|mov)(\?|$)/i.test(l)?`<video src="${p(l)}" controls playsinline style="width:100%;border-radius:14px;background:#000"></video>`:""})(),N=Number(g.commission_pct??6)/100,H=r=>{if(!r)return null;const h=r*N,_=Number(g.title_fees||0),A=Number(g.tax_proration||0),t=Number(g.mortgage_payoff||0),a=Number(g.other||0);return r-h-_-A-t-a},E=[{key:"opportunistic",label:"Opportunistic",sub:"Test the ceiling",price:Number(T.opportunistic||0),dom:"Longer",prob:"Lower"},{key:"target",label:"Target Market",sub:"Priced to sell right",price:Number(T.target||0),dom:"Market pace",prob:"Strong"},{key:"fast",label:"Fast Sale",sub:"Move it quickly",price:Number(T.fast||0),dom:"Fastest",prob:"Highest"}],P=R.map((r,h)=>{const _=(r.adjustments||[]).reduce((t,a)=>t+Number(a.amount||0),0),A=Number(r.sale_price||0)+_;return`<tr>
      <td class="comp-addr">${p(r.address||"Comp "+(h+1))}</td>
      <td>${L(r.sale_price)}</td>
      <td>${r.gla?p(r.gla)+" sf":"—"}</td>
      <td class="${_>=0?"pos":"neg"}">${_>=0?"+":""}${L(_)}</td>
      <td class="adjusted">${L(A)}</td>
    </tr>`}).join(""),k=[];return o.gla&&k.push(["GLA",p(o.gla)+" sf"]),o.beds&&k.push(["Beds",p(o.beds)]),o.baths&&k.push(["Baths",p(o.baths)]),o.lot_size&&k.push(["Lot",p(o.lot_size)]),o.year_built&&k.push(["Built",p(o.year_built)]),k.push(["Condition",y.n+"/10 · "+p(y.label)]),`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${f} — Listing Presentation</title>
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
  <header class="hero${M?" has-photo":""}"${M?` style="background-image:linear-gradient(180deg,rgba(16,13,9,.55),rgba(16,13,9,.92)),url('${p(M)}')"`:""}><div class="wrap">
    <div class="eyebrow">${j?"Prepared exclusively for "+j:p(i.eyebrow)}</div>
    <h1>${f}</h1>
    <div class="sub">Executive Listing Presentation</div>
    <div class="badges">${k.map(([r,h])=>`<span class="badge"><b>${r}</b>${h}</span>`).join("")}</div>
    <div class="brandline">
      <svg class="fork" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v8a4 4 0 0 0 8 0V3M12 15v6"/></svg>
      <span>${w} · powered by <i style="font-family:Fraunces,serif;color:var(--champ)">Prism</i>${x?" · "+x:""}</span>
    </div>
  </div>
  <button class="printbtn" onclick="window.print()" title="Save as PDF or print">⤓ PDF</button>
  </header>
  ${z?`<section style="padding-top:56px"><div class="wrap"><div class="eyebrow">A word from your agent</div><h2 class="title" style="margin-bottom:18px">${x?"Hi"+(j?" "+j.split(" ")[0]:"")+" — a quick hello":"Welcome"}</h2><div class="card" style="padding:14px">${z}</div></div></section>`:""}

  <!-- MODULE 1 -->
  <section><div class="wrap">
    <div class="mod-num">01</div><div class="eyebrow">Property Profile</div>
    <h2 class="title">${f}</h2>
    <p class="lead">${p(i.intro)}</p>
    <div class="grid3" style="margin-top:24px">
      ${o.upgrades?`<div class="stat"><div class="k">Recent Upgrades</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${p(o.upgrades)}</div></div>`:""}
      ${o.hidden_changes?`<div class="stat"><div class="k">Not in Public Record</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${p(o.hidden_changes)}</div></div>`:""}
      ${o.motivation?`<div class="stat"><div class="k">Owner Objective</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${p(o.motivation)}</div></div>`:""}
    </div>
    <div class="card" style="margin-top:20px">
      <div class="eyebrow">Condition Assessment</div>
      <div class="cond" style="margin-top:12px">
        <div class="dial">${y.n}<span class="of">/10</span></div>
        <div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--champ)">${p(y.label)}</div>
        <div style="color:#c9bfa9;margin-top:4px;max-width:52ch">${p(y.say)}</div></div>
      </div>
    </div>
  </div></section>

  <!-- MODULE 2 -->
  <section><div class="wrap">
    <div class="mod-num">02</div><div class="eyebrow">Micro-Market Dynamics</div>
    <h2 class="title">How fast this market is moving</h2>
    <div class="meter"><div class="pin" style="left:${Math.min(95,Math.max(3,Number(b.speed||50)))}%"></div></div>
    <div style="display:flex;justify-content:space-between;color:var(--mut);font-size:13px"><span>Buyer’s market</span><span>Balanced</span><span>Seller’s market</span></div>
    <div class="grid3" style="margin-top:26px">
      <div class="stat"><div class="k">Months of Inventory</div><div class="v">${b.moi??"—"}</div></div>
      <div class="stat"><div class="k">List-to-Sale</div><div class="v">${b.list_to_sale?p(b.list_to_sale)+"%":"—"}</div></div>
      <div class="stat"><div class="k">Active / Pending / Closed</div><div class="v" style="font-size:22px">${p(b.active||"—")} / ${p(b.pending||"—")} / ${p(b.closed||"—")}</div></div>
    </div>
  </div></section>

  <!-- MODULE 3 -->
  <section><div class="wrap">
    <div class="mod-num">03</div><div class="eyebrow">Comparables & Adjustments</div>
    <h2 class="title">The math behind the price</h2>
    <p class="lead">These are the homes a buyer and their appraiser will measure yours against. We adjust line-by-line for the real differences — so the number is defensible, not a guess.</p>
    ${R.length?`<table><thead><tr><th>Comparable</th><th>Sold</th><th>Size</th><th>Adjustment</th><th>Adjusted</th></tr></thead><tbody>${P}</tbody></table>`:'<p style="color:var(--mut);margin-top:20px">Comparable properties will be added here.</p>'}
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
    <div class="tiers" style="margin-top:24px">
      ${E.map(r=>`<div class="tier ${r.key==="target"?"target":""}">${r.key==="target"?'<div class="flag">Recommended</div>':""}
        <div class="tlab">${r.label}</div><div class="price">${L(r.price)}</div><div class="sub">${r.sub}</div>
        <div class="meta"><span>Days on market: ${r.dom}</span><span>Sale odds: ${r.prob}</span></div></div>`).join("")}
    </div>
  </div></section>

  <!-- MODULE 6 -->
  <section><div class="wrap">
    <div class="mod-num">06</div><div class="eyebrow">Your Net Proceeds</div>
    <h2 class="title">What you actually walk away with</h2>
    <p class="lead">Your equity is the price minus what you still owe. Here's how it lands at each pricing strategy — then try any number yourself.</p>
    <div class="equity">
      <div class="eh">Strategy</div><div class="eh en">Sale price</div><div class="eh en">Less payoff & costs</div><div class="eh en">Net to you</div>
      ${E.filter(r=>r.price).map(r=>{const h=H(r.price),_=r.price-(h||0);return`<div class="er">${r.label}</div><div class="ev">${L(r.price)}</div><div class="ev">−${L(_)}</div><div class="en">${L(h)}</div>`}).join("")}
    </div>
    <div class="card" style="margin-top:20px">
      <div class="ns" id="nsTable"></div>
      <div class="calc">
        <label for="salePrice">Try any sale price</label>
        <input id="salePrice" type="text" inputmode="numeric" value="${T.target||""}" placeholder="Enter a price">
      </div>
    </div>
  </div></section>
  ${C?`
  <!-- SIGN ON THE SPOT (seller share only) -->
  <section id="signSection"><div class="wrap">
    <div class="mod-num">07</div><div class="eyebrow">Ready to move forward</div>
    <h2 class="title">Sign to get started</h2>
    <p class="lead">If you're ready to list with ${x||"us"}, sign below. This records your intent to proceed and notifies your agent right away — they'll follow up with the full agreement.</p>
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
    ${x?`<p style="color:#c9bfa9;margin-top:10px">Prepared for you by ${x}, ${w}.</p>`:""}
  </div></div>
  <footer><div class="wrap">${w} · powered by <i style="font-family:Fraunces,serif;color:var(--champ)">Prism</i> · This presentation is confidential and prepared for the property owner.</div></footer>

<script>
  var NS = ${JSON.stringify({commissionPct:N,title:Number(g.title_fees||0),tax:Number(g.tax_proration||0),payoff:Number(g.mortgage_payoff||0),other:Number(g.other||0)})};
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
  ${C?`
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
        var res=await fetch('${s.supabase_url||""}/functions/v1/listing-present?sign=1&t=${n}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name,drawn:c.toDataURL('image/png'),consent:consent,ua:navigator.userAgent})});
        var j=await res.json();
        if(j.ok){ msg.style.color='#7fae8f'; msg.textContent='✓ '+j.message; document.querySelector('.sign-btn').style.display='none'; }
        else { msg.style.color='#e0794f'; msg.textContent=j.message||'Could not record the signature.'; }
      }catch(e){ msg.style.color='#e0794f'; msg.textContent='Network issue — please try again.'; }
    };
  })();`:""}
<\/script>
</body></html>`}const $="#CBA35C",U="#EBCB82",V="#100D09",K=s=>s||s===0?"$"+Number(s).toLocaleString("en-US"):"",Q=()=>(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)).replace(/-/g,"").slice(0,22),X=s=>{if(!s)return"";const o=Math.floor((Date.now()-new Date(s).getTime())/1e3);return o<60?"just now":o<3600?Math.floor(o/60)+"m ago":o<86400?Math.floor(o/3600)+"h ago":Math.floor(o/86400)+"d ago"};function re({userId:s,agentName:o}){const[b,R]=S.useState(null),[T,g]=S.useState("list"),[y,i]=S.useState(null),[f,x]=S.useState(null),w=S.useCallback(async()=>{const{data:l}=await W.from("listing_presentations").select("*").eq("user_id",s).order("updated_at",{ascending:!1});R(l||[])},[s]);S.useEffect(()=>{w()},[w]);const j=()=>({title:"",address:"",contact_id:null,deal_id:null,seller_tone:"auto",seller_name:"",hero_image_url:"",agent_video_url:"",subject:{gla:"",beds:"",baths:"",lot_size:"",year_built:"",condition_score:7,upgrades:"",hidden_changes:"",motivation:""},market:{speed:55,moi:"",list_to_sale:"",active:"",pending:"",closed:""},comps:[{address:"",sale_price:"",gla:"",adjustments:[]}],tiers:{opportunistic:"",target:"",fast:""},netsheet:{commission_pct:6,mortgage_payoff:"",title_fees:"",tax_proration:"",other:""}}),M=(l,C=!0)=>{x({t:l,ok:C}),setTimeout(()=>x(null),4e3)};return T==="edit"?e.jsx(Z,{initial:y,userId:s,agentName:o,onDone:()=>{g("list"),w()},onCancel:()=>g("list"),flash:M,notify:f}):e.jsxs("div",{style:{maxWidth:900,margin:"0 auto",padding:"0 4px 40px"},children:[f&&e.jsx("div",{style:{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:5e3,background:f.ok?"#1a3a2a":"#3a1a1a",border:`1px solid ${f.ok?"#7fae8f":"#e0794f"}`,color:"#fff",padding:"12px 18px",borderRadius:10,fontSize:14,maxWidth:"90vw"},children:f.t}),e.jsx("div",{style:{marginBottom:6},children:e.jsx("span",{style:{fontFamily:"Barlow Condensed,sans-serif",fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",color:$,fontSize:13},children:"Win the listing"})}),e.jsx("h1",{style:{fontFamily:"Fraunces,serif",fontWeight:400,fontSize:34,color:"var(--text-1)",margin:"0 0 6px"},children:"Listing Presentations"}),e.jsx("p",{style:{color:"var(--text-2)",fontSize:15,margin:"0 0 20px",maxWidth:"62ch"},children:"Turn an address into an executive, DISC-aware valuation dossier — pricing, comps, a launch plan, and a live net-sheet — as a branded web presentation you can present, email, or share with the seller."}),e.jsx("button",{onClick:()=>{i(j()),g("edit")},style:{background:U,color:V,border:"none",borderRadius:10,padding:"13px 22px",fontWeight:800,fontSize:15,cursor:"pointer"},children:"+ New Listing Presentation"}),e.jsx("div",{style:{marginTop:28},children:b===null?e.jsx("div",{style:{color:"var(--text-3)"},children:"Loading…"}):b.length===0?e.jsx("div",{style:{color:"var(--text-3)",fontSize:14,border:"1px dashed var(--border)",borderRadius:12,padding:"26px",textAlign:"center"},children:"No presentations yet. Build your first one — it takes about five minutes."}):b.map(l=>{var C,n,z,N;return e.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",marginBottom:10},children:[e.jsxs("div",{style:{minWidth:0},children:[e.jsx("div",{style:{fontWeight:700,color:"var(--text-1)",fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:l.title||l.address||"Untitled presentation"}),e.jsxs("div",{style:{fontSize:12,color:"var(--text-3)",marginTop:2},children:[O((C=l.subject)==null?void 0:C.condition_score).n,"/10 · ",O((n=l.subject)==null?void 0:n.condition_score).label,(z=l.tiers)!=null&&z.target?` · target ${K(l.tiers.target)}`:"",l.share_enabled?" · 🔗 shared":"",l.view_count?` · ${l.view_count} views`:""]}),l.last_viewed_at&&e.jsxs("div",{style:{fontSize:12,color:"#7fae8f",marginTop:3,fontWeight:600},children:["👁 Seller viewed ",X(l.last_viewed_at)]}),l.signed_at&&e.jsxs("div",{style:{fontSize:12,color:U,marginTop:3,fontWeight:700},children:["✍️ Signed ",X(l.signed_at),(N=l.signature)!=null&&N.name?` by ${l.signature.name}`:""]})]}),e.jsx("div",{style:{display:"flex",gap:6,flexShrink:0},children:e.jsx("button",{onClick:()=>{i(l),g("edit")},style:F,children:"Open"})})]},l.id)})})]})}const F={background:"var(--bg-base)",border:"1px solid var(--border)",color:"var(--text-2)",borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer"},d={width:"100%",boxSizing:"border-box",background:"var(--bg-base)",border:"1px solid var(--border)",borderRadius:9,color:"var(--text-1)",padding:"10px 12px",fontSize:14},c={display:"block",fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)",margin:"0 0 6px"},B={fontFamily:"Barlow Condensed,sans-serif",fontWeight:700,letterSpacing:".16em",textTransform:"uppercase",color:$,fontSize:12,margin:"22px 0 10px"};function Z({initial:s,userId:o,agentName:b,onDone:R,onCancel:T,flash:g,notify:y}){const[i,f]=S.useState(s),[x,w]=S.useState(!1),[j,M]=S.useState(s.id||null),[l,C]=S.useState(null),n=(t,a)=>f(m=>{const u={...m},v=t.split(".");return v.length===1?u[v[0]]=a:u[v[0]]={...u[v[0]],[v[1]]:a},u}),z=(t,a,m)=>f(u=>{const v=[...u.comps];return v[t]={...v[t],[a]:m},{...u,comps:v}}),N=()=>f(t=>({...t,comps:[...t.comps,{address:"",sale_price:"",gla:"",adjustments:[]}]})),H=t=>f(a=>({...a,comps:a.comps.filter((m,u)=>u!==t)})),E=O(i.subject.condition_score),P=t=>{const a={};for(const m in t){const u=t[m];a[m]=u===""||u==null?null:isNaN(Number(u))?u:Number(u)}return a},k=()=>{var t,a,m,u,v,D;return{user_id:o,contact_id:i.contact_id||null,deal_id:i.deal_id||null,title:((t=i.title)==null?void 0:t.trim())||((a=i.address)!=null&&a.trim()?i.address.trim()+" — Listing Presentation":"Untitled presentation"),address:((m=i.address)==null?void 0:m.trim())||null,seller_tone:i.seller_tone,seller_name:((u=i.seller_name)==null?void 0:u.trim())||null,hero_image_url:((v=i.hero_image_url)==null?void 0:v.trim())||null,agent_video_url:((D=i.agent_video_url)==null?void 0:D.trim())||null,subject:P(i.subject),market:P(i.market),comps:(i.comps||[]).map(I=>({...I,sale_price:Number(I.sale_price)||0,gla:I.gla||null,adjustments:I.adjustments||[]})),tiers:P(i.tiers),netsheet:P(i.netsheet)}},r=(t={})=>J({...k(),agent_name:b,supabase_url:q,...t}),h=async()=>{w(!0);const t={...k(),html:r(),updated_at:new Date().toISOString()};let a;return j?a=await W.from("listing_presentations").update(t).eq("id",j).select().single():a=await W.from("listing_presentations").insert(t).select().single(),a.error?(g("Could not save: "+a.error.message,!1),w(!1),null):(M(a.data.id),w(!1),g("Saved."),a.data)},_=async()=>{const t=await h();if(!t)return;const a=window.open("","_blank");a?(a.document.write(t.html||r()),a.document.close()):g("Allow pop-ups to preview, or use Share/Email.",!1)},A=async()=>{const t=await h();if(!t)return;const a=t.share_token||Q(),m=r({sign_mode:!0,share_token:a}),{data:u,error:v}=await W.from("listing_presentations").update({share_token:a,share_enabled:!0,html:m}).eq("id",t.id).select().single();if(v){g("Could not enable sharing: "+v.message,!1);return}const D=`${q}/functions/v1/listing-present?t=${u.share_token}`;C(D);try{await navigator.clipboard.writeText(D),g("Share link copied — send it to your seller.")}catch{g("Share link ready (copy it below).")}};return e.jsxs("div",{style:{maxWidth:780,margin:"0 auto",padding:"0 4px 60px"},children:[y&&e.jsx("div",{style:{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:5e3,background:y.ok?"#1a3a2a":"#3a1a1a",border:`1px solid ${y.ok?"#7fae8f":"#e0794f"}`,color:"#fff",padding:"12px 18px",borderRadius:10,fontSize:14,maxWidth:"90vw"},children:y.t}),e.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:16},children:[e.jsxs("div",{children:[e.jsxs("div",{style:{fontFamily:"Barlow Condensed,sans-serif",fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",color:$,fontSize:12},children:[j?"Editing":"New"," presentation"]}),e.jsx("h1",{style:{fontFamily:"Fraunces,serif",fontWeight:400,fontSize:26,color:"var(--text-1)",margin:"2px 0 0"},children:i.address||"Listing Presentation"})]}),e.jsx("button",{onClick:T,style:F,children:"← Back"})]}),e.jsx("div",{style:B,children:"The property"}),e.jsxs("div",{style:{marginBottom:12},children:[e.jsx("label",{style:c,children:"Property address"}),e.jsxs("div",{style:{display:"flex",gap:8},children:[e.jsx("input",{style:{...d,flex:1},value:i.address,onChange:t=>n("address",t.target.value),placeholder:"4214 W Virginia Ave, Tampa, FL 33607"}),e.jsx("button",{onClick:()=>g("MLS auto-fill lights up as soon as your IDX feed is connected. Until then, enter comps and market numbers by hand below.",!0),title:"Auto-fill comps & market from the MLS (available when your feed is connected)",style:{...F,whiteSpace:"nowrap",opacity:.6,cursor:"help"},children:"✨ Auto-fill from MLS"})]}),e.jsx("div",{style:{fontSize:11,color:"var(--text-3)",marginTop:5},children:"Auto-fill from the MLS activates once your IDX feed is connected — it will pull comps, months-of-inventory, and market speed for you."})]}),e.jsxs("div",{style:{marginBottom:12},children:[e.jsx("label",{style:c,children:"Seller name (personalizes the cover)"}),e.jsx("input",{style:d,value:i.seller_name,onChange:t=>n("seller_name",t.target.value),placeholder:"The Henderson Family"})]}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12},children:[e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Hero photo URL"}),e.jsx("input",{style:d,value:i.hero_image_url,onChange:t=>n("hero_image_url",t.target.value),placeholder:"https://…/front.jpg"})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Agent welcome video"}),e.jsx("input",{style:d,value:i.agent_video_url,onChange:t=>n("agent_video_url",t.target.value),placeholder:"YouTube / Vimeo / .mp4 link"})]})]}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,marginBottom:12},children:[e.jsxs("div",{children:[e.jsx("label",{style:c,children:"GLA (sq ft)"}),e.jsx("input",{style:d,value:i.subject.gla,onChange:t=>n("subject.gla",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Beds"}),e.jsx("input",{style:d,value:i.subject.beds,onChange:t=>n("subject.beds",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Baths"}),e.jsx("input",{style:d,value:i.subject.baths,onChange:t=>n("subject.baths",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Lot"}),e.jsx("input",{style:d,value:i.subject.lot_size,onChange:t=>n("subject.lot_size",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Year built"}),e.jsx("input",{style:d,value:i.subject.year_built,onChange:t=>n("subject.year_built",t.target.value)})]})]}),e.jsx("div",{style:B,children:"Property condition — 1 to 10"}),e.jsxs("div",{style:{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"18px"},children:[e.jsxs("div",{style:{display:"flex",alignItems:"baseline",gap:12,marginBottom:12},children:[e.jsxs("div",{style:{fontFamily:"Fraunces,serif",fontSize:42,color:$,lineHeight:1},children:[E.n,e.jsx("span",{style:{fontSize:20,color:"var(--text-3)"},children:"/10"})]}),e.jsx("div",{style:{fontFamily:"Fraunces,serif",fontSize:22,color:U},children:E.label})]}),e.jsx("input",{type:"range",min:"1",max:"10",step:"1",value:i.subject.condition_score,onChange:t=>n("subject.condition_score",Number(t.target.value)),style:{width:"100%",accentColor:$}}),e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text-3)",marginTop:2},children:[e.jsx("span",{children:"1 · Full rehab"}),e.jsx("span",{children:"10 · Flawless"})]}),e.jsx("div",{style:{marginTop:12,fontSize:14,color:"var(--text-2)",fontStyle:"italic",lineHeight:1.5,borderLeft:`2px solid ${$}`,paddingLeft:12},children:E.say})]}),e.jsxs("div",{style:{marginTop:12},children:[e.jsx("label",{style:c,children:"Upgrades & improvements"}),e.jsx("textarea",{style:{...d,minHeight:70,resize:"vertical"},value:i.subject.upgrades,onChange:t=>n("subject.upgrades",t.target.value),placeholder:"New roof (2024), quartz kitchen, impact windows, renovated primary bath…"})]}),e.jsxs("div",{style:{marginTop:12},children:[e.jsx("label",{style:c,children:"Changes not in public record"}),e.jsx("textarea",{style:{...d,minHeight:70,resize:"vertical"},value:i.subject.hidden_changes,onChange:t=>n("subject.hidden_changes",t.target.value),placeholder:"Lanai permitted & converted to a 4th bedroom; garage insulated as flex office; well added for irrigation…"})]}),e.jsxs("div",{style:{marginTop:12},children:[e.jsx("label",{style:c,children:"Owner motivation / objective"}),e.jsx("input",{style:d,value:i.subject.motivation,onChange:t=>n("subject.motivation",t.target.value),placeholder:"Relocating for work — needs to close by spring"})]}),e.jsx("div",{style:B,children:"Seller’s style (DISC framing)"}),e.jsx("div",{style:{display:"flex",gap:8,flexWrap:"wrap"},children:[["auto","Auto"],["analytical","Analytical (C)"],["direct","Direct (D)"],["relational","Relational (I/S)"]].map(([t,a])=>e.jsx("button",{onClick:()=>n("seller_tone",t),style:{padding:"7px 14px",borderRadius:100,cursor:"pointer",fontSize:13,fontWeight:i.seller_tone===t?700:500,border:`1px solid ${i.seller_tone===t?$:"var(--border)"}`,background:i.seller_tone===t?"rgba(203,163,92,.15)":"transparent",color:i.seller_tone===t?$:"var(--text-2)"},children:a},t))}),e.jsx("div",{style:B,children:"Micro-market"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10},children:[e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Months of inventory"}),e.jsx("input",{style:d,value:i.market.moi,onChange:t=>n("market.moi",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"List-to-sale %"}),e.jsx("input",{style:d,value:i.market.list_to_sale,onChange:t=>n("market.list_to_sale",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Active"}),e.jsx("input",{style:d,value:i.market.active,onChange:t=>n("market.active",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Pending"}),e.jsx("input",{style:d,value:i.market.pending,onChange:t=>n("market.pending",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Closed (90d)"}),e.jsx("input",{style:d,value:i.market.closed,onChange:t=>n("market.closed",t.target.value)})]})]}),e.jsxs("div",{style:{marginTop:10},children:[e.jsxs("label",{style:c,children:["Market speed (buyer’s ← → seller’s): ",i.market.speed]}),e.jsx("input",{type:"range",min:"0",max:"100",value:i.market.speed,onChange:t=>n("market.speed",Number(t.target.value)),style:{width:"100%",accentColor:$}})]}),e.jsx("div",{style:B,children:"Comparables"}),i.comps.map((t,a)=>e.jsxs("div",{style:{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:8},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:8},children:[e.jsxs("span",{style:{fontSize:12,color:"var(--text-3)",fontWeight:700},children:["Comp ",a+1]}),i.comps.length>1&&e.jsx("button",{onClick:()=>H(a),style:{background:"none",border:"none",color:"#e0794f",cursor:"pointer",fontSize:12},children:"Remove"})]}),e.jsx("input",{style:{...d,marginBottom:8},value:t.address,onChange:m=>z(a,"address",m.target.value),placeholder:"Comp address"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8},children:[e.jsx("input",{style:d,value:t.sale_price,onChange:m=>z(a,"sale_price",m.target.value),placeholder:"Sale price",inputMode:"numeric"}),e.jsx("input",{style:d,value:t.gla,onChange:m=>z(a,"gla",m.target.value),placeholder:"GLA (sq ft)",inputMode:"numeric"})]})]},a)),e.jsx("button",{onClick:N,style:{...F,marginBottom:4},children:"+ Add comp"}),e.jsx("div",{style:B,children:"Three-tier pricing"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8},children:[e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Opportunistic"}),e.jsx("input",{style:d,value:i.tiers.opportunistic,onChange:t=>n("tiers.opportunistic",t.target.value),inputMode:"numeric",placeholder:"729000"})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Target ★"}),e.jsx("input",{style:d,value:i.tiers.target,onChange:t=>n("tiers.target",t.target.value),inputMode:"numeric",placeholder:"699000"})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Fast sale"}),e.jsx("input",{style:d,value:i.tiers.fast,onChange:t=>n("tiers.fast",t.target.value),inputMode:"numeric",placeholder:"669000"})]})]}),e.jsx("div",{style:B,children:"Seller net sheet"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10},children:[e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Commission %"}),e.jsx("input",{style:d,value:i.netsheet.commission_pct,onChange:t=>n("netsheet.commission_pct",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Mortgage payoff"}),e.jsx("input",{style:d,value:i.netsheet.mortgage_payoff,onChange:t=>n("netsheet.mortgage_payoff",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Title & closing"}),e.jsx("input",{style:d,value:i.netsheet.title_fees,onChange:t=>n("netsheet.title_fees",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Tax proration"}),e.jsx("input",{style:d,value:i.netsheet.tax_proration,onChange:t=>n("netsheet.tax_proration",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:c,children:"Other"}),e.jsx("input",{style:d,value:i.netsheet.other,onChange:t=>n("netsheet.other",t.target.value),inputMode:"numeric"})]})]}),e.jsxs("div",{style:{position:"sticky",bottom:0,background:"linear-gradient(180deg,transparent,var(--bg-base) 30%)",paddingTop:20,marginTop:24},children:[e.jsxs("div",{style:{display:"flex",gap:8,flexWrap:"wrap"},children:[e.jsx("button",{onClick:h,disabled:x,style:{...F,flex:"1 1 100px"},children:x?"Saving…":"Save"}),e.jsx("button",{onClick:_,disabled:x,style:{background:U,color:V,border:"none",borderRadius:9,padding:"11px 20px",fontWeight:800,fontSize:14,cursor:"pointer",flex:"2 1 160px"},children:"▶ Preview presentation"}),e.jsx("button",{onClick:A,disabled:x,style:{...F,flex:"1 1 120px"},children:"🔗 Share with seller"})]}),l&&e.jsx("div",{style:{marginTop:10,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",fontSize:12,color:"var(--text-2)",wordBreak:"break-all"},children:l})]})]})}export{re as default};
