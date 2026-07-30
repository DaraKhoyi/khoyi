import{r as w,j as e}from"./vendor-react.DecIrkRQ.chunk.js";import{s as F,i as q}from"./main.D2jSzm7c.js";import"./vendor-react-dom.CLTjDK3B.chunk.js";import"./vendor-supabase.Bv9NtBh5.chunk.js";import"./vendor.Ks84_326.chunk.js";const O=[{n:1,label:"Full Rehab",say:"“Down to the studs.” Everything needs replacing — this sells as a project to investors or renovators."},{n:2,label:"Major Overhaul",say:"“Good bones, big to-do list.” Structurally sound, but systems and finishes are all at the end of their life."},{n:3,label:"Heavy Updating",say:"“A fixer with real upside.” Livable for now, but kitchen, baths, and mechanicals all need work."},{n:4,label:"Dated but Solid",say:"“Tired, not broken.” Everything functions — the look is a generation behind."},{n:5,label:"Cosmetic Refresh",say:"“Paint, floors, and polish.” A solid home that shows and photographs better with light updates."},{n:6,label:"Well-Kept & Classic",say:"“Loved and maintained — just not on-trend.” Move-in ready with a timeless rather than current style."},{n:7,label:"Move-In Ready",say:"“Bring your toothbrush.” Nothing needs doing; a buyer might modernize a few touches over time."},{n:8,label:"Turnkey Modern",say:"“Updated and easy to love.” Current finishes — nothing on the buyer’s list for years."},{n:9,label:"Designer-Done",say:"“Magazine-ready.” Recently and tastefully renovated; it shows like a model home."},{n:10,label:"Flawless",say:"“Not one thing to change.” A buyer moves in and wouldn’t touch a single detail."}],P=r=>O.find(n=>n.n===Number(r))||O[6],U={analytical:{eyebrow:"The evidence, in order",intro:"Every number here is defensible and sourced. Read it top to bottom — the pricing follows from the data, not the other way around."},direct:{eyebrow:"The bottom line first",intro:"Here is where your home stands, what it’s worth, and what you’ll net. The detail is below if you want it — but the headline is the number."},relational:{eyebrow:"Your home’s next chapter",intro:"You’ve made this house a home. Here’s how we honor that story while positioning it to sell for everything it’s worth — together."},auto:{eyebrow:"Your listing strategy",intro:"A complete, defensible plan for pricing, positioning, and netting the most from the sale of your home."}},c=r=>String(r??"").replace(/[&<>"']/g,n=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[n]),B=r=>r||r===0?"$"+Number(r).toLocaleString("en-US",{maximumFractionDigits:0}):"—";function Y(r){const n=r.subject||{},v=r.market||{},M=r.comps||[],S=r.tiers||{},g=r.netsheet||{},x=P(n.condition_score),a=U[r.seller_tone]||U.auto,u=c(r.address||"Your Property"),f=c(r.agent_name||""),y="Realty ONE Group Advantage",C=Number(g.commission_pct??6)/100,T=[{key:"opportunistic",label:"Opportunistic",sub:"Test the ceiling",price:Number(S.opportunistic||0),dom:"Longer",prob:"Lower"},{key:"target",label:"Target Market",sub:"Priced to sell right",price:Number(S.target||0),dom:"Market pace",prob:"Strong"},{key:"fast",label:"Fast Sale",sub:"Move it quickly",price:Number(S.fast||0),dom:"Fastest",prob:"Highest"}],p=M.map((s,j)=>{const z=(s.adjustments||[]).reduce((N,$)=>N+Number($.amount||0),0),E=Number(s.sale_price||0)+z;return`<tr>
      <td class="comp-addr">${c(s.address||"Comp "+(j+1))}</td>
      <td>${B(s.sale_price)}</td>
      <td>${s.gla?c(s.gla)+" sf":"—"}</td>
      <td class="${z>=0?"pos":"neg"}">${z>=0?"+":""}${B(z)}</td>
      <td class="adjusted">${B(E)}</td>
    </tr>`}).join(""),m=[];return n.gla&&m.push(["GLA",c(n.gla)+" sf"]),n.beds&&m.push(["Beds",c(n.beds)]),n.baths&&m.push(["Baths",c(n.baths)]),n.lot_size&&m.push(["Lot",c(n.lot_size)]),n.year_built&&m.push(["Built",c(n.year_built)]),m.push(["Condition",x.n+"/10 · "+c(x.label)]),`<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${u} — Listing Presentation</title>
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
  .hero{min-height:78vh;display:flex;flex-direction:column;justify-content:center;background:radial-gradient(120% 90% at 80% -10%,rgba(203,163,92,.14),transparent 60%),linear-gradient(180deg,#0c0a07,var(--ink));border-bottom:1px solid var(--line)}
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
  <header class="hero"><div class="wrap">
    <div class="eyebrow">${c(a.eyebrow)}</div>
    <h1>${u}</h1>
    <div class="sub">Executive Listing Presentation</div>
    <div class="badges">${m.map(([s,j])=>`<span class="badge"><b>${s}</b>${j}</span>`).join("")}</div>
    <div class="brandline">
      <svg class="fork" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v8a4 4 0 0 0 8 0V3M12 15v6"/></svg>
      <span>${y} · powered by <i style="font-family:Fraunces,serif;color:var(--champ)">Prism</i>${f?" · "+f:""}</span>
    </div>
  </div></header>

  <!-- MODULE 1 -->
  <section><div class="wrap">
    <div class="mod-num">01</div><div class="eyebrow">Property Profile</div>
    <h2 class="title">${u}</h2>
    <p class="lead">${c(a.intro)}</p>
    <div class="grid3" style="margin-top:24px">
      ${n.upgrades?`<div class="stat"><div class="k">Recent Upgrades</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${c(n.upgrades)}</div></div>`:""}
      ${n.hidden_changes?`<div class="stat"><div class="k">Not in Public Record</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${c(n.hidden_changes)}</div></div>`:""}
      ${n.motivation?`<div class="stat"><div class="k">Owner Objective</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${c(n.motivation)}</div></div>`:""}
    </div>
    <div class="card" style="margin-top:20px">
      <div class="eyebrow">Condition Assessment</div>
      <div class="cond" style="margin-top:12px">
        <div class="dial">${x.n}<span class="of">/10</span></div>
        <div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--champ)">${c(x.label)}</div>
        <div style="color:#c9bfa9;margin-top:4px;max-width:52ch">${c(x.say)}</div></div>
      </div>
    </div>
  </div></section>

  <!-- MODULE 2 -->
  <section><div class="wrap">
    <div class="mod-num">02</div><div class="eyebrow">Micro-Market Dynamics</div>
    <h2 class="title">How fast this market is moving</h2>
    <div class="meter"><div class="pin" style="left:${Math.min(95,Math.max(3,Number(v.speed||50)))}%"></div></div>
    <div style="display:flex;justify-content:space-between;color:var(--mut);font-size:13px"><span>Buyer’s market</span><span>Balanced</span><span>Seller’s market</span></div>
    <div class="grid3" style="margin-top:26px">
      <div class="stat"><div class="k">Months of Inventory</div><div class="v">${v.moi??"—"}</div></div>
      <div class="stat"><div class="k">List-to-Sale</div><div class="v">${v.list_to_sale?c(v.list_to_sale)+"%":"—"}</div></div>
      <div class="stat"><div class="k">Active / Pending / Closed</div><div class="v" style="font-size:22px">${c(v.active||"—")} / ${c(v.pending||"—")} / ${c(v.closed||"—")}</div></div>
    </div>
  </div></section>

  <!-- MODULE 3 -->
  <section><div class="wrap">
    <div class="mod-num">03</div><div class="eyebrow">Comparables & Adjustments</div>
    <h2 class="title">The math behind the price</h2>
    <p class="lead">These are the homes a buyer and their appraiser will measure yours against. We adjust line-by-line for the real differences — so the number is defensible, not a guess.</p>
    ${M.length?`<table><thead><tr><th>Comparable</th><th>Sold</th><th>Size</th><th>Adjustment</th><th>Adjusted</th></tr></thead><tbody>${p}</tbody></table>`:'<p style="color:var(--mut);margin-top:20px">Comparable properties will be added here.</p>'}
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
      ${T.map(s=>`<div class="tier ${s.key==="target"?"target":""}">${s.key==="target"?'<div class="flag">Recommended</div>':""}
        <div class="tlab">${s.label}</div><div class="price">${B(s.price)}</div><div class="sub">${s.sub}</div>
        <div class="meta"><span>Days on market: ${s.dom}</span><span>Sale odds: ${s.prob}</span></div></div>`).join("")}
    </div>
  </div></section>

  <!-- MODULE 6 -->
  <section><div class="wrap">
    <div class="mod-num">06</div><div class="eyebrow">Your Net Proceeds</div>
    <h2 class="title">What you actually walk away with</h2>
    <div class="card" style="margin-top:8px">
      <div class="ns" id="nsTable"></div>
      <div class="calc">
        <label for="salePrice">Try any sale price</label>
        <input id="salePrice" type="text" inputmode="numeric" value="${S.target||""}" placeholder="Enter a price">
      </div>
    </div>
  </div></section>

  <div class="cta"><div class="wrap">
    <div class="eyebrow">Ready when you are</div>
    <h2>Let’s bring this home to market.</h2>
    ${f?`<p style="color:#c9bfa9;margin-top:10px">Prepared for you by ${f}, ${y}.</p>`:""}
  </div></div>
  <footer><div class="wrap">${y} · powered by <i style="font-family:Fraunces,serif;color:var(--champ)">Prism</i> · This presentation is confidential and prepared for the property owner.</div></footer>

<script>
  var NS = ${JSON.stringify({commissionPct:C,title:Number(g.title_fees||0),tax:Number(g.tax_proration||0),payoff:Number(g.mortgage_payoff||0),other:Number(g.other||0)})};
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
<\/script>
</body></html>`}const k="#CBA35C",A="#EBCB82",I="#100D09",V=r=>r||r===0?"$"+Number(r).toLocaleString("en-US"):"",K=()=>(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)).replace(/-/g,"").slice(0,22);function ae({userId:r,agentName:n}){const[v,M]=w.useState(null),[S,g]=w.useState("list"),[x,a]=w.useState(null),[u,f]=w.useState(null),y=w.useCallback(async()=>{const{data:p}=await F.from("listing_presentations").select("*").eq("user_id",r).order("updated_at",{ascending:!1});M(p||[])},[r]);w.useEffect(()=>{y()},[y]);const C=()=>({title:"",address:"",contact_id:null,deal_id:null,seller_tone:"auto",subject:{gla:"",beds:"",baths:"",lot_size:"",year_built:"",condition_score:7,upgrades:"",hidden_changes:"",motivation:""},market:{speed:55,moi:"",list_to_sale:"",active:"",pending:"",closed:""},comps:[{address:"",sale_price:"",gla:"",adjustments:[]}],tiers:{opportunistic:"",target:"",fast:""},netsheet:{commission_pct:6,mortgage_payoff:"",title_fees:"",tax_proration:"",other:""}}),T=(p,m=!0)=>{f({t:p,ok:m}),setTimeout(()=>f(null),4e3)};return S==="edit"?e.jsx(X,{initial:x,userId:r,agentName:n,onDone:()=>{g("list"),y()},onCancel:()=>g("list"),flash:T,notify:u}):e.jsxs("div",{style:{maxWidth:900,margin:"0 auto",padding:"0 4px 40px"},children:[u&&e.jsx("div",{style:{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:5e3,background:u.ok?"#1a3a2a":"#3a1a1a",border:`1px solid ${u.ok?"#7fae8f":"#e0794f"}`,color:"#fff",padding:"12px 18px",borderRadius:10,fontSize:14,maxWidth:"90vw"},children:u.t}),e.jsx("div",{style:{marginBottom:6},children:e.jsx("span",{style:{fontFamily:"Barlow Condensed,sans-serif",fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",color:k,fontSize:13},children:"Win the listing"})}),e.jsx("h1",{style:{fontFamily:"Fraunces,serif",fontWeight:400,fontSize:34,color:"var(--text-1)",margin:"0 0 6px"},children:"Listing Presentations"}),e.jsx("p",{style:{color:"var(--text-2)",fontSize:15,margin:"0 0 20px",maxWidth:"62ch"},children:"Turn an address into an executive, DISC-aware valuation dossier — pricing, comps, a launch plan, and a live net-sheet — as a branded web presentation you can present, email, or share with the seller."}),e.jsx("button",{onClick:()=>{a(C()),g("edit")},style:{background:A,color:I,border:"none",borderRadius:10,padding:"13px 22px",fontWeight:800,fontSize:15,cursor:"pointer"},children:"+ New Listing Presentation"}),e.jsx("div",{style:{marginTop:28},children:v===null?e.jsx("div",{style:{color:"var(--text-3)"},children:"Loading…"}):v.length===0?e.jsx("div",{style:{color:"var(--text-3)",fontSize:14,border:"1px dashed var(--border)",borderRadius:12,padding:"26px",textAlign:"center"},children:"No presentations yet. Build your first one — it takes about five minutes."}):v.map(p=>{var m,s,j;return e.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"14px 16px",marginBottom:10},children:[e.jsxs("div",{style:{minWidth:0},children:[e.jsx("div",{style:{fontWeight:700,color:"var(--text-1)",fontSize:15,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"},children:p.title||p.address||"Untitled presentation"}),e.jsxs("div",{style:{fontSize:12,color:"var(--text-3)",marginTop:2},children:[P((m=p.subject)==null?void 0:m.condition_score).n,"/10 · ",P((s=p.subject)==null?void 0:s.condition_score).label,(j=p.tiers)!=null&&j.target?` · target ${V(p.tiers.target)}`:"",p.share_enabled?" · 🔗 shared":"",p.view_count?` · ${p.view_count} views`:""]})]}),e.jsx("div",{style:{display:"flex",gap:6,flexShrink:0},children:e.jsx("button",{onClick:()=>{a(p),g("edit")},style:L,children:"Open"})})]},p.id)})})]})}const L={background:"var(--bg-base)",border:"1px solid var(--border)",color:"var(--text-2)",borderRadius:8,padding:"8px 14px",fontSize:13,fontWeight:700,cursor:"pointer"},o={width:"100%",boxSizing:"border-box",background:"var(--bg-base)",border:"1px solid var(--border)",borderRadius:9,color:"var(--text-1)",padding:"10px 12px",fontSize:14},d={display:"block",fontSize:11,fontWeight:700,letterSpacing:".08em",textTransform:"uppercase",color:"var(--text-3)",margin:"0 0 6px"},_={fontFamily:"Barlow Condensed,sans-serif",fontWeight:700,letterSpacing:".16em",textTransform:"uppercase",color:k,fontSize:12,margin:"22px 0 10px"};function X({initial:r,userId:n,agentName:v,onDone:M,onCancel:S,flash:g,notify:x}){const[a,u]=w.useState(r),[f,y]=w.useState(!1),[C,T]=w.useState(r.id||null),[p,m]=w.useState(null),s=(t,i)=>u(h=>{const l={...h},b=t.split(".");return b.length===1?l[b[0]]=i:l[b[0]]={...l[b[0]],[b[1]]:i},l}),j=(t,i,h)=>u(l=>{const b=[...l.comps];return b[t]={...b[t],[i]:h},{...l,comps:b}}),z=()=>u(t=>({...t,comps:[...t.comps,{address:"",sale_price:"",gla:"",adjustments:[]}]})),E=t=>u(i=>({...i,comps:i.comps.filter((h,l)=>l!==t)})),N=P(a.subject.condition_score),$=t=>{const i={};for(const h in t){const l=t[h];i[h]=l===""||l==null?null:isNaN(Number(l))?l:Number(l)}return i},W=()=>{var t,i,h;return{user_id:n,contact_id:a.contact_id||null,deal_id:a.deal_id||null,title:((t=a.title)==null?void 0:t.trim())||((i=a.address)!=null&&i.trim()?a.address.trim()+" — Listing Presentation":"Untitled presentation"),address:((h=a.address)==null?void 0:h.trim())||null,seller_tone:a.seller_tone,subject:$(a.subject),market:$(a.market),comps:(a.comps||[]).map(l=>({...l,sale_price:Number(l.sale_price)||0,gla:l.gla||null,adjustments:l.adjustments||[]})),tiers:$(a.tiers),netsheet:$(a.netsheet)}},D=()=>Y({...W(),agent_name:v}),R=async()=>{y(!0);const t={...W(),html:D(),updated_at:new Date().toISOString()};let i;return C?i=await F.from("listing_presentations").update(t).eq("id",C).select().single():i=await F.from("listing_presentations").insert(t).select().single(),i.error?(g("Could not save: "+i.error.message,!1),y(!1),null):(T(i.data.id),y(!1),g("Saved."),i.data)},H=async()=>{const t=await R();if(!t)return;const i=window.open("","_blank");i?(i.document.write(t.html||D()),i.document.close()):g("Allow pop-ups to preview, or use Share/Email.",!1)},G=async()=>{const t=await R();if(!t)return;let i=t.share_token;i||(i=K());const{data:h,error:l}=await F.from("listing_presentations").update({share_token:i,share_enabled:!0}).eq("id",t.id).select().single();if(l){g("Could not enable sharing: "+l.message,!1);return}const b=`${q}/functions/v1/listing-present?t=${h.share_token}`;m(b);try{await navigator.clipboard.writeText(b),g("Share link copied — send it to your seller.")}catch{g("Share link ready (copy it below).")}};return e.jsxs("div",{style:{maxWidth:780,margin:"0 auto",padding:"0 4px 60px"},children:[x&&e.jsx("div",{style:{position:"fixed",bottom:20,left:"50%",transform:"translateX(-50%)",zIndex:5e3,background:x.ok?"#1a3a2a":"#3a1a1a",border:`1px solid ${x.ok?"#7fae8f":"#e0794f"}`,color:"#fff",padding:"12px 18px",borderRadius:10,fontSize:14,maxWidth:"90vw"},children:x.t}),e.jsxs("div",{style:{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:16},children:[e.jsxs("div",{children:[e.jsxs("div",{style:{fontFamily:"Barlow Condensed,sans-serif",fontWeight:700,letterSpacing:".2em",textTransform:"uppercase",color:k,fontSize:12},children:[C?"Editing":"New"," presentation"]}),e.jsx("h1",{style:{fontFamily:"Fraunces,serif",fontWeight:400,fontSize:26,color:"var(--text-1)",margin:"2px 0 0"},children:a.address||"Listing Presentation"})]}),e.jsx("button",{onClick:S,style:L,children:"← Back"})]}),e.jsx("div",{style:_,children:"The property"}),e.jsxs("div",{style:{marginBottom:12},children:[e.jsx("label",{style:d,children:"Property address"}),e.jsx("input",{style:o,value:a.address,onChange:t=>s("address",t.target.value),placeholder:"4214 W Virginia Ave, Tampa, FL 33607"})]}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,marginBottom:12},children:[e.jsxs("div",{children:[e.jsx("label",{style:d,children:"GLA (sq ft)"}),e.jsx("input",{style:o,value:a.subject.gla,onChange:t=>s("subject.gla",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Beds"}),e.jsx("input",{style:o,value:a.subject.beds,onChange:t=>s("subject.beds",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Baths"}),e.jsx("input",{style:o,value:a.subject.baths,onChange:t=>s("subject.baths",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Lot"}),e.jsx("input",{style:o,value:a.subject.lot_size,onChange:t=>s("subject.lot_size",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Year built"}),e.jsx("input",{style:o,value:a.subject.year_built,onChange:t=>s("subject.year_built",t.target.value)})]})]}),e.jsx("div",{style:_,children:"Property condition — 1 to 10"}),e.jsxs("div",{style:{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:12,padding:"18px"},children:[e.jsxs("div",{style:{display:"flex",alignItems:"baseline",gap:12,marginBottom:12},children:[e.jsxs("div",{style:{fontFamily:"Fraunces,serif",fontSize:42,color:k,lineHeight:1},children:[N.n,e.jsx("span",{style:{fontSize:20,color:"var(--text-3)"},children:"/10"})]}),e.jsx("div",{style:{fontFamily:"Fraunces,serif",fontSize:22,color:A},children:N.label})]}),e.jsx("input",{type:"range",min:"1",max:"10",step:"1",value:a.subject.condition_score,onChange:t=>s("subject.condition_score",Number(t.target.value)),style:{width:"100%",accentColor:k}}),e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",fontSize:10,color:"var(--text-3)",marginTop:2},children:[e.jsx("span",{children:"1 · Full rehab"}),e.jsx("span",{children:"10 · Flawless"})]}),e.jsx("div",{style:{marginTop:12,fontSize:14,color:"var(--text-2)",fontStyle:"italic",lineHeight:1.5,borderLeft:`2px solid ${k}`,paddingLeft:12},children:N.say})]}),e.jsxs("div",{style:{marginTop:12},children:[e.jsx("label",{style:d,children:"Upgrades & improvements"}),e.jsx("textarea",{style:{...o,minHeight:70,resize:"vertical"},value:a.subject.upgrades,onChange:t=>s("subject.upgrades",t.target.value),placeholder:"New roof (2024), quartz kitchen, impact windows, renovated primary bath…"})]}),e.jsxs("div",{style:{marginTop:12},children:[e.jsx("label",{style:d,children:"Changes not in public record"}),e.jsx("textarea",{style:{...o,minHeight:70,resize:"vertical"},value:a.subject.hidden_changes,onChange:t=>s("subject.hidden_changes",t.target.value),placeholder:"Lanai permitted & converted to a 4th bedroom; garage insulated as flex office; well added for irrigation…"})]}),e.jsxs("div",{style:{marginTop:12},children:[e.jsx("label",{style:d,children:"Owner motivation / objective"}),e.jsx("input",{style:o,value:a.subject.motivation,onChange:t=>s("subject.motivation",t.target.value),placeholder:"Relocating for work — needs to close by spring"})]}),e.jsx("div",{style:_,children:"Seller’s style (DISC framing)"}),e.jsx("div",{style:{display:"flex",gap:8,flexWrap:"wrap"},children:[["auto","Auto"],["analytical","Analytical (C)"],["direct","Direct (D)"],["relational","Relational (I/S)"]].map(([t,i])=>e.jsx("button",{onClick:()=>s("seller_tone",t),style:{padding:"7px 14px",borderRadius:100,cursor:"pointer",fontSize:13,fontWeight:a.seller_tone===t?700:500,border:`1px solid ${a.seller_tone===t?k:"var(--border)"}`,background:a.seller_tone===t?"rgba(203,163,92,.15)":"transparent",color:a.seller_tone===t?k:"var(--text-2)"},children:i},t))}),e.jsx("div",{style:_,children:"Micro-market"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10},children:[e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Months of inventory"}),e.jsx("input",{style:o,value:a.market.moi,onChange:t=>s("market.moi",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"List-to-sale %"}),e.jsx("input",{style:o,value:a.market.list_to_sale,onChange:t=>s("market.list_to_sale",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Active"}),e.jsx("input",{style:o,value:a.market.active,onChange:t=>s("market.active",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Pending"}),e.jsx("input",{style:o,value:a.market.pending,onChange:t=>s("market.pending",t.target.value)})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Closed (90d)"}),e.jsx("input",{style:o,value:a.market.closed,onChange:t=>s("market.closed",t.target.value)})]})]}),e.jsxs("div",{style:{marginTop:10},children:[e.jsxs("label",{style:d,children:["Market speed (buyer’s ← → seller’s): ",a.market.speed]}),e.jsx("input",{type:"range",min:"0",max:"100",value:a.market.speed,onChange:t=>s("market.speed",Number(t.target.value)),style:{width:"100%",accentColor:k}})]}),e.jsx("div",{style:_,children:"Comparables"}),a.comps.map((t,i)=>e.jsxs("div",{style:{background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:8},children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",marginBottom:8},children:[e.jsxs("span",{style:{fontSize:12,color:"var(--text-3)",fontWeight:700},children:["Comp ",i+1]}),a.comps.length>1&&e.jsx("button",{onClick:()=>E(i),style:{background:"none",border:"none",color:"#e0794f",cursor:"pointer",fontSize:12},children:"Remove"})]}),e.jsx("input",{style:{...o,marginBottom:8},value:t.address,onChange:h=>j(i,"address",h.target.value),placeholder:"Comp address"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8},children:[e.jsx("input",{style:o,value:t.sale_price,onChange:h=>j(i,"sale_price",h.target.value),placeholder:"Sale price",inputMode:"numeric"}),e.jsx("input",{style:o,value:t.gla,onChange:h=>j(i,"gla",h.target.value),placeholder:"GLA (sq ft)",inputMode:"numeric"})]})]},i)),e.jsx("button",{onClick:z,style:{...L,marginBottom:4},children:"+ Add comp"}),e.jsx("div",{style:_,children:"Three-tier pricing"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8},children:[e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Opportunistic"}),e.jsx("input",{style:o,value:a.tiers.opportunistic,onChange:t=>s("tiers.opportunistic",t.target.value),inputMode:"numeric",placeholder:"729000"})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Target ★"}),e.jsx("input",{style:o,value:a.tiers.target,onChange:t=>s("tiers.target",t.target.value),inputMode:"numeric",placeholder:"699000"})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Fast sale"}),e.jsx("input",{style:o,value:a.tiers.fast,onChange:t=>s("tiers.fast",t.target.value),inputMode:"numeric",placeholder:"669000"})]})]}),e.jsx("div",{style:_,children:"Seller net sheet"}),e.jsxs("div",{style:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10},children:[e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Commission %"}),e.jsx("input",{style:o,value:a.netsheet.commission_pct,onChange:t=>s("netsheet.commission_pct",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Mortgage payoff"}),e.jsx("input",{style:o,value:a.netsheet.mortgage_payoff,onChange:t=>s("netsheet.mortgage_payoff",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Title & closing"}),e.jsx("input",{style:o,value:a.netsheet.title_fees,onChange:t=>s("netsheet.title_fees",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Tax proration"}),e.jsx("input",{style:o,value:a.netsheet.tax_proration,onChange:t=>s("netsheet.tax_proration",t.target.value),inputMode:"numeric"})]}),e.jsxs("div",{children:[e.jsx("label",{style:d,children:"Other"}),e.jsx("input",{style:o,value:a.netsheet.other,onChange:t=>s("netsheet.other",t.target.value),inputMode:"numeric"})]})]}),e.jsxs("div",{style:{position:"sticky",bottom:0,background:"linear-gradient(180deg,transparent,var(--bg-base) 30%)",paddingTop:20,marginTop:24},children:[e.jsxs("div",{style:{display:"flex",gap:8,flexWrap:"wrap"},children:[e.jsx("button",{onClick:R,disabled:f,style:{...L,flex:"1 1 100px"},children:f?"Saving…":"Save"}),e.jsx("button",{onClick:H,disabled:f,style:{background:A,color:I,border:"none",borderRadius:9,padding:"11px 20px",fontWeight:800,fontSize:14,cursor:"pointer",flex:"2 1 160px"},children:"▶ Preview presentation"}),e.jsx("button",{onClick:G,disabled:f,style:{...L,flex:"1 1 120px"},children:"🔗 Share with seller"})]}),p&&e.jsx("div",{style:{marginTop:10,background:"var(--bg-card)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",fontSize:12,color:"var(--text-2)",wordBreak:"break-all"},children:p})]})]})}export{ae as default};
