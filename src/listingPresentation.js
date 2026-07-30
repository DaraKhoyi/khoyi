// listingPresentation.js — the condition scale, DISC framing, and the generator
// that turns a presentation's data into a self-contained, branded, interactive
// HTML document (the "deck" the agent presents and can share with a seller).
//
// Prism Editorial: near-black #100D09, cream #F6F1E7, gold #CBA35C, champagne
// #EBCB82, deep gold #9A8038. Fraunces headlines, Manrope body, Barlow eyebrows.

// ── Property Condition 1–10 ──────────────────────────────────────────────────
// Each rank has a short catchy label + a one-line the agent can say to the seller
// to place the home honestly. 1 = total rehab, 10 = buyer changes nothing.
export const CONDITION_SCALE = [
  { n: 1,  label: 'Full Rehab',            say: '“Down to the studs.” Everything needs replacing — this sells as a project to investors or renovators.' },
  { n: 2,  label: 'Major Overhaul',        say: '“Good bones, big to-do list.” Structurally sound, but systems and finishes are all at the end of their life.' },
  { n: 3,  label: 'Heavy Updating',        say: '“A fixer with real upside.” Livable for now, but kitchen, baths, and mechanicals all need work.' },
  { n: 4,  label: 'Dated but Solid',       say: '“Tired, not broken.” Everything functions — the look is a generation behind.' },
  { n: 5,  label: 'Cosmetic Refresh',      say: '“Paint, floors, and polish.” A solid home that shows and photographs better with light updates.' },
  { n: 6,  label: 'Well-Kept & Classic',   say: '“Loved and maintained — just not on-trend.” Move-in ready with a timeless rather than current style.' },
  { n: 7,  label: 'Move-In Ready',         say: '“Bring your toothbrush.” Nothing needs doing; a buyer might modernize a few touches over time.' },
  { n: 8,  label: 'Turnkey Modern',        say: '“Updated and easy to love.” Current finishes — nothing on the buyer’s list for years.' },
  { n: 9,  label: 'Designer-Done',         say: '“Magazine-ready.” Recently and tastefully renovated; it shows like a model home.' },
  { n: 10, label: 'Flawless',              say: '“Not one thing to change.” A buyer moves in and wouldn’t touch a single detail.' },
];
export const conditionFor = (n) => CONDITION_SCALE.find(c => c.n === Number(n)) || CONDITION_SCALE[6];

// ── DISC framing for the copy tone ───────────────────────────────────────────
export const TONE_FRAMING = {
  analytical: { eyebrow: 'The evidence, in order', intro: 'Every number here is defensible and sourced. Read it top to bottom — the pricing follows from the data, not the other way around.' },
  direct:     { eyebrow: 'The bottom line first', intro: 'Here is where your home stands, what it’s worth, and what you’ll net. The detail is below if you want it — but the headline is the number.' },
  relational: { eyebrow: 'Your home’s next chapter', intro: 'You’ve made this house a home. Here’s how we honor that story while positioning it to sell for everything it’s worth — together.' },
  auto:       { eyebrow: 'Your listing strategy', intro: 'A complete, defensible plan for pricing, positioning, and netting the most from the sale of your home.' },
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
const money = (n) => (n || n === 0) ? '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '—';

// The full self-contained HTML document.
export function buildPresentationHTML(p) {
  const s = p.subject || {}, m = p.market || {}, comps = p.comps || [], tiers = p.tiers || {}, ns = p.netsheet || {};
  const cond = conditionFor(s.condition_score);
  const tone = TONE_FRAMING[p.seller_tone] || TONE_FRAMING.auto;
  const addr = esc(p.address || 'Your Property');
  const agent = esc(p.agent_name || '');
  const brokerage = 'Realty ONE Group Advantage';

  // net-sheet math for the three tiers
  const commissionPct = Number(ns.commission_pct ?? 6) / 100;
  const netFor = (price) => {
    if (!price) return null;
    const commission = price * commissionPct;
    const title = Number(ns.title_fees || 0);
    const tax = Number(ns.tax_proration || 0);
    const payoff = Number(ns.mortgage_payoff || 0);
    const other = Number(ns.other || 0);
    return price - commission - title - tax - payoff - other;
  };
  const tierRows = [
    { key:'opportunistic', label:'Opportunistic', sub:'Test the ceiling', price: Number(tiers.opportunistic||0), dom:'Longer', prob:'Lower' },
    { key:'target',        label:'Target Market', sub:'Priced to sell right', price: Number(tiers.target||0), dom:'Market pace', prob:'Strong' },
    { key:'fast',          label:'Fast Sale',     sub:'Move it quickly', price: Number(tiers.fast||0), dom:'Fastest', prob:'Highest' },
  ];

  const compRows = comps.map((c, i) => {
    const adj = (c.adjustments || []).reduce((sum, a) => sum + Number(a.amount || 0), 0);
    const adjusted = Number(c.sale_price || 0) + adj;
    return `<tr>
      <td class="comp-addr">${esc(c.address || ('Comp ' + (i+1)))}</td>
      <td>${money(c.sale_price)}</td>
      <td>${c.gla ? esc(c.gla)+' sf' : '—'}</td>
      <td class="${adj>=0?'pos':'neg'}">${adj>=0?'+':''}${money(adj)}</td>
      <td class="adjusted">${money(adjusted)}</td>
    </tr>`;
  }).join('');

  const badges = [];
  if (s.gla) badges.push(['GLA', esc(s.gla) + ' sf']);
  if (s.beds) badges.push(['Beds', esc(s.beds)]);
  if (s.baths) badges.push(['Baths', esc(s.baths)]);
  if (s.lot_size) badges.push(['Lot', esc(s.lot_size)]);
  if (s.year_built) badges.push(['Built', esc(s.year_built)]);
  badges.push(['Condition', cond.n + '/10 · ' + esc(cond.label)]);

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${addr} — Listing Presentation</title>
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
    <div class="eyebrow">${esc(tone.eyebrow)}</div>
    <h1>${addr}</h1>
    <div class="sub">Executive Listing Presentation</div>
    <div class="badges">${badges.map(([k,v])=>`<span class="badge"><b>${k}</b>${v}</span>`).join('')}</div>
    <div class="brandline">
      <svg class="fork" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 3v8a4 4 0 0 0 8 0V3M12 15v6"/></svg>
      <span>${brokerage} · powered by <i style="font-family:Fraunces,serif;color:var(--champ)">Prism</i>${agent?' · '+agent:''}</span>
    </div>
  </div></header>

  <!-- MODULE 1 -->
  <section><div class="wrap">
    <div class="mod-num">01</div><div class="eyebrow">Property Profile</div>
    <h2 class="title">${addr}</h2>
    <p class="lead">${esc(tone.intro)}</p>
    <div class="grid3" style="margin-top:24px">
      ${s.upgrades ? `<div class="stat"><div class="k">Recent Upgrades</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${esc(s.upgrades)}</div></div>`:''}
      ${s.hidden_changes ? `<div class="stat"><div class="k">Not in Public Record</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${esc(s.hidden_changes)}</div></div>`:''}
      ${s.motivation ? `<div class="stat"><div class="k">Owner Objective</div><div class="v" style="font-size:17px;color:var(--cream);font-family:Manrope;font-weight:600;line-height:1.4;margin-top:8px">${esc(s.motivation)}</div></div>`:''}
    </div>
    <div class="card" style="margin-top:20px">
      <div class="eyebrow">Condition Assessment</div>
      <div class="cond" style="margin-top:12px">
        <div class="dial">${cond.n}<span class="of">/10</span></div>
        <div><div style="font-family:Fraunces,serif;font-size:26px;color:var(--champ)">${esc(cond.label)}</div>
        <div style="color:#c9bfa9;margin-top:4px;max-width:52ch">${esc(cond.say)}</div></div>
      </div>
    </div>
  </div></section>

  <!-- MODULE 2 -->
  <section><div class="wrap">
    <div class="mod-num">02</div><div class="eyebrow">Micro-Market Dynamics</div>
    <h2 class="title">How fast this market is moving</h2>
    <div class="meter"><div class="pin" style="left:${Math.min(95,Math.max(3,Number(m.speed||50)))}%"></div></div>
    <div style="display:flex;justify-content:space-between;color:var(--mut);font-size:13px"><span>Buyer’s market</span><span>Balanced</span><span>Seller’s market</span></div>
    <div class="grid3" style="margin-top:26px">
      <div class="stat"><div class="k">Months of Inventory</div><div class="v">${m.moi ?? '—'}</div></div>
      <div class="stat"><div class="k">List-to-Sale</div><div class="v">${m.list_to_sale ? esc(m.list_to_sale)+'%' : '—'}</div></div>
      <div class="stat"><div class="k">Active / Pending / Closed</div><div class="v" style="font-size:22px">${esc(m.active||'—')} / ${esc(m.pending||'—')} / ${esc(m.closed||'—')}</div></div>
    </div>
  </div></section>

  <!-- MODULE 3 -->
  <section><div class="wrap">
    <div class="mod-num">03</div><div class="eyebrow">Comparables & Adjustments</div>
    <h2 class="title">The math behind the price</h2>
    <p class="lead">These are the homes a buyer and their appraiser will measure yours against. We adjust line-by-line for the real differences — so the number is defensible, not a guess.</p>
    ${comps.length ? `<table><thead><tr><th>Comparable</th><th>Sold</th><th>Size</th><th>Adjustment</th><th>Adjusted</th></tr></thead><tbody>${compRows}</tbody></table>` : '<p style="color:var(--mut);margin-top:20px">Comparable properties will be added here.</p>'}
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
      ${tierRows.map(t=>`<div class="tier ${t.key==='target'?'target':''}">${t.key==='target'?'<div class="flag">Recommended</div>':''}
        <div class="tlab">${t.label}</div><div class="price">${money(t.price)}</div><div class="sub">${t.sub}</div>
        <div class="meta"><span>Days on market: ${t.dom}</span><span>Sale odds: ${t.prob}</span></div></div>`).join('')}
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
        <input id="salePrice" type="text" inputmode="numeric" value="${tiers.target||''}" placeholder="Enter a price">
      </div>
    </div>
  </div></section>

  <div class="cta"><div class="wrap">
    <div class="eyebrow">Ready when you are</div>
    <h2>Let’s bring this home to market.</h2>
    ${agent?`<p style="color:#c9bfa9;margin-top:10px">Prepared for you by ${agent}, ${brokerage}.</p>`:''}
  </div></div>
  <footer><div class="wrap">${brokerage} · powered by <i style="font-family:Fraunces,serif;color:var(--champ)">Prism</i> · This presentation is confidential and prepared for the property owner.</div></footer>

<script>
  var NS = ${JSON.stringify({ commissionPct: commissionPct, title: Number(ns.title_fees||0), tax: Number(ns.tax_proration||0), payoff: Number(ns.mortgage_payoff||0), other: Number(ns.other||0) })};
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
</script>
</body></html>`;
}
