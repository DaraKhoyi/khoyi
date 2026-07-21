import{r as p,j as s}from"./vendor-react.DecIrkRQ.chunk.js";import{s as k}from"./main.whwGBfbf.js";import"./vendor-react-dom.CLTjDK3B.chunk.js";import"./vendor-supabase.Bv9NtBh5.chunk.js";import"./vendor.Ks84_326.chunk.js";const E={D:"Dominance",I:"Influence",S:"Steadiness",C:"Conscientiousness"},D={E:"Endurance",R:"Recovery",D:"Discipline",F:"Focus"};function C(i,d){return!i||!d?0:Math.max(...["D","I","S","C"].map(c=>Math.abs((i[c]??0)-(d[c]??0))))}function A(){const[i,d]=p.useState(null),[c,h]=p.useState(""),[N,y]=p.useState(null);return p.useEffect(()=>{let r=!0;return(async()=>{try{const{data:t,error:n}=await k.rpc("disc_assessments_roster");if(!r)return;if(n){h(n.message||"Could not load"),d([]);return}d(t||[])}catch(t){r&&(h(String(t.message||t)),d([]))}})(),()=>{r=!1}},[]),s.jsxs("div",{className:"discr",children:[s.jsx(S,{}),s.jsxs("div",{className:"discr-wrap",children:[s.jsxs("div",{className:"discr-head",children:[s.jsx("h1",{children:"Agent DISC & Grit"}),s.jsx("p",{children:"Every agent's latest Full Spectrum readout — Style, Drive, and the coaching priorities Prism flagged."})]}),i===null&&s.jsxs("div",{className:"discr-loading",children:[s.jsx("div",{className:"discr-spin"}),s.jsx("span",{children:"Loading roster…"})]}),i&&c&&i.length===0&&s.jsx("div",{className:"discr-empty",children:/not authorized/i.test(c)?"This view is for brokerage owners and admins.":`Couldn't load the roster: ${c}`}),i&&!c&&i.length===0&&s.jsx("div",{className:"discr-empty",children:"No agents have completed the DISC / Grit assessment yet. Once they take it in Get started, their readouts appear here."}),i&&i.length>0&&s.jsx("div",{className:"discr-list",children:i.map(r=>{var v,f,u,j;const t=r.adaptive||{},n=r.natural_scores||{},g=C(t,n),a=((v=r.validity)==null?void 0:v.flag)||null,l=N===r.user_id,x=(f=r.drive)==null?void 0:f.overall,m=((u=r.drive)==null?void 0:u.sub)||{},b=Object.entries(m).sort((e,o)=>e[1]-o[1])[0];return s.jsxs("div",{className:`discr-card ${l?"open":""}`,children:[s.jsxs("button",{className:"discr-row",onClick:()=>y(l?null:r.user_id),children:[s.jsxs("div",{className:"discr-row-main",children:[s.jsxs("div",{className:"discr-name",children:[r.agent_name||"Agent",r.team?s.jsx("span",{className:"discr-team",children:r.team}):null]}),s.jsxs("div",{className:"discr-tags",children:[s.jsx("span",{className:"discr-tag gold",children:r.style_label||"—"}),typeof x=="number"&&s.jsxs("span",{className:"discr-tag",children:["Drive ",x]}),a&&a.type!=="aligned"&&s.jsxs("span",{className:`discr-tag ${a.type==="stress"?"red":"amber"}`,children:["⚠ ",a.type]}),g>=15&&(!a||a.type==="aligned")&&s.jsxs("span",{className:"discr-tag amber",children:[g,"-pt gap"]})]})]}),s.jsxs("div",{className:"discr-row-right",children:[s.jsx("span",{className:"discr-date",children:r.taken_at?new Date(r.taken_at).toLocaleDateString():""}),s.jsx("span",{className:`discr-chev ${l?"up":""}`,children:"⌄"})]})]}),l&&s.jsxs("div",{className:"discr-detail",children:[s.jsxs("div",{className:"discr-cols",children:[s.jsxs("div",{className:"discr-block",children:[s.jsxs("div",{className:"discr-block-h",children:["Style — DISC ",s.jsx("span",{children:"natural · adaptive"})]}),["D","I","S","C"].map(e=>s.jsxs("div",{className:"discr-bar",children:[s.jsxs("div",{className:"discr-bar-top",children:[s.jsxs("span",{children:[e," · ",E[e]]}),s.jsxs("span",{className:"discr-num",children:[t[e]??"—",s.jsxs("i",{children:[" / ",n[e]??"—"]})]})]}),s.jsx("div",{className:"discr-track",children:s.jsx("div",{className:"discr-fill nat",style:{width:`${n[e]??0}%`}})}),s.jsx("div",{className:"discr-track",children:s.jsx("div",{className:"discr-fill adapt",style:{width:`${t[e]??0}%`}})})]},e))]}),s.jsxs("div",{className:"discr-block",children:[s.jsxs("div",{className:"discr-block-h",children:["Drive — Grit ",s.jsxs("span",{children:[x,"/100"]})]}),["E","R","D","F"].map(e=>s.jsxs("div",{className:"discr-bar",children:[s.jsxs("div",{className:"discr-bar-top",children:[s.jsxs("span",{children:[D[e],b&&b[0]===e?s.jsx("i",{className:"discr-low",children:" · weak spot"}):null]}),s.jsx("span",{className:"discr-num",children:m[e]??"—"})]}),s.jsx("div",{className:"discr-track",children:s.jsx("div",{className:"discr-fill drive",style:{width:`${m[e]??0}%`}})})]},e)),((j=r.drive)==null?void 0:j.distortionHits)>=3&&s.jsxs("div",{className:"discr-distort",children:["Self-awareness answers came back unusually flawless (",r.drive.distortionHits,"/4) — read Drive as a floor."]})]})]}),a&&s.jsxs("div",{className:`discr-flag ${a.type}`,children:[s.jsxs("strong",{children:[a.type==="aligned"?"✓ ":"⚠ ",a.headline]}),s.jsx("p",{children:a.detail})]}),r.readout&&s.jsxs("div",{className:"discr-prose-block",children:[s.jsx("div",{className:"discr-block-h",children:"The read"}),String(r.readout).split(`

`).map((e,o)=>s.jsx("p",{className:"discr-prose",children:e},o))]}),r.coaching&&s.jsxs("div",{className:"discr-prose-block",children:[s.jsx("div",{className:"discr-block-h",children:"Coaching priorities"}),String(r.coaching).split(`

`).map((e,o)=>{const w=e.split(`
`);return s.jsxs("div",{className:"discr-coach",children:[s.jsx("div",{className:"discr-coach-h",children:w[0]}),s.jsx("p",{className:"discr-prose",children:w.slice(1).join(" ")})]},o)})]})]})]},r.user_id)})})]})]})}function S(){return s.jsx("style",{children:`
  .discr { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; }
  .discr-wrap { max-width:760px; margin:0 auto; padding:18px 16px 96px; }
  .discr-head h1 { font-size:26px; font-weight:700; color:var(--text-1); margin-bottom:6px; }
  .discr-head p { font-size:14px; line-height:1.5; color:var(--text-2); margin-bottom:22px; }
  .discr-loading { display:flex; align-items:center; gap:12px; color:var(--text-2); padding:40px 0; justify-content:center; }
  .discr-spin { width:24px; height:24px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:discrspin .8s linear infinite; }
  @keyframes discrspin { to { transform:rotate(360deg); } }
  .discr-empty { background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:24px; color:var(--text-2); font-size:14px; line-height:1.5; text-align:center; }
  .discr-list { display:flex; flex-direction:column; gap:12px; }
  .discr-card { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; overflow:hidden; }
  .discr-card.open { border-color:var(--accent); }
  .discr-row { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; background:transparent; border:none; cursor:pointer; padding:16px; text-align:left; }
  .discr-row-main { min-width:0; flex:1; }
  .discr-name { font-size:16px; font-weight:700; color:var(--text-1); display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .discr-team { font-size:11px; font-weight:600; color:var(--text-3); background:var(--bg-base); border:1px solid var(--border); border-radius:20px; padding:2px 9px; }
  .discr-tags { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .discr-tag { font-size:11px; font-weight:600; color:var(--text-2); background:var(--bg-base); border:1px solid var(--border); border-radius:20px; padding:3px 10px; white-space:nowrap; }
  .discr-tag.gold { color:var(--accent); border-color:var(--accent); }
  .discr-tag.red { color:#C75E5E; border-color:#C75E5E; }
  .discr-tag.amber { color:var(--accent); border-color:var(--accent); }
  .discr-row-right { display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex-shrink:0; }
  .discr-date { font-size:11px; color:var(--text-3); white-space:nowrap; }
  .discr-chev { color:var(--text-3); font-size:18px; transition:transform .2s; line-height:1; }
  .discr-chev.up { transform:rotate(180deg); color:var(--accent); }
  .discr-detail { padding:0 16px 16px; border-top:1px solid var(--border); }
  .discr-cols { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:16px; }
  @media (max-width:560px){ .discr-cols { grid-template-columns:1fr; } }
  .discr-block-h { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--text-3); font-weight:700; margin-bottom:12px; display:flex; justify-content:space-between; align-items:baseline; }
  .discr-block-h span { color:var(--text-3); font-weight:500; text-transform:none; letter-spacing:0.02em; }
  .discr-bar { margin-bottom:12px; } .discr-bar:last-child { margin-bottom:0; }
  .discr-bar-top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px; font-size:12px; color:var(--text-2); font-weight:600; }
  .discr-low { color:#C75E5E; font-style:normal; font-weight:600; }
  .discr-num { color:var(--accent); font-weight:700; font-variant-numeric:tabular-nums; }
  .discr-num i { color:var(--text-3); font-weight:500; font-style:normal; }
  .discr-track { height:5px; background:var(--bg-base); border-radius:3px; overflow:hidden; margin-bottom:3px; }
  .discr-fill { height:100%; border-radius:3px; }
  .discr-fill.adapt, .discr-fill.drive { background:linear-gradient(90deg,#9A8344,#D4BC75); }
  .discr-fill.nat { background:var(--text-3); opacity:0.55; }
  .discr-distort { margin-top:8px; font-size:11px; line-height:1.5; color:#C75E5E; }
  .discr-flag { border-radius:12px; padding:14px; margin-top:16px; border:1px solid; }
  .discr-flag.stress { background:rgba(199,94,94,0.10); border-color:#C75E5E; }
  .discr-flag.coaching { background:rgba(197,169,94,0.10); border-color:var(--accent); }
  .discr-flag.aligned { background:rgba(94,199,140,0.10); border-color:#5EC78C; }
  .discr-flag strong { display:block; font-size:13px; color:var(--text-1); margin-bottom:5px; }
  .discr-flag p { font-size:13px; line-height:1.5; color:var(--text-2); }
  .discr-prose-block { margin-top:18px; }
  .discr-prose { font-size:14px; line-height:1.6; color:var(--text-2); margin-bottom:10px; } .discr-prose:last-child { margin-bottom:0; }
  .discr-coach { margin-bottom:12px; } .discr-coach:last-child { margin-bottom:0; }
  .discr-coach-h { font-size:13px; font-weight:700; color:var(--accent); margin-bottom:4px; }
  `})}export{A as default};
