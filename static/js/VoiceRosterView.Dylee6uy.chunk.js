import{r as l,j as e}from"./vendor-react.DecIrkRQ.chunk.js";import{s as g}from"./main.DRvvqc5Q.js";import"./vendor-react-dom.CLTjDK3B.chunk.js";import"./vendor-supabase.Ddwpz9jS.chunk.js";import"./vendor.DgG_KDoz.chunk.js";function y(){const[t,d]=l.useState(null),[n,c]=l.useState(""),[m,h]=l.useState(null);return l.useEffect(()=>{let r=!0;return(async()=>{try{const{data:a,error:s}=await g.rpc("voice_cards_roster");if(!r)return;if(s){c(s.message||"Could not load"),d([]);return}d(a||[])}catch(a){r&&(c(String(a.message||a)),d([]))}})(),()=>{r=!1}},[]),e.jsxs("div",{className:"vr",children:[e.jsx(f,{}),e.jsxs("div",{className:"vr-wrap",children:[e.jsxs("div",{className:"vr-head",children:[e.jsx("h1",{children:"Agent voice cards"}),e.jsx("p",{children:"Each agent's personal voice — the layer that rides on top of The Concierge in their drafts."})]}),t===null&&e.jsxs("div",{className:"vr-loading",children:[e.jsx("div",{className:"vr-spin"}),e.jsx("span",{children:"Loading…"})]}),t&&n&&t.length===0&&e.jsx("div",{className:"vr-empty",children:/not authorized/i.test(n)?"This view is for brokerage owners and admins.":`Couldn't load: ${n}`}),t&&!n&&t.length===0&&e.jsx("div",{className:"vr-empty",children:"No agents have built a personal voice yet. Once they complete MyVoice in Get started, their cards appear here."}),t&&t.length>0&&e.jsx("div",{className:"vr-list",children:t.map(r=>{var s,p,v,x;const a=m===r.user_id;return e.jsxs("div",{className:`vr-card ${a?"open":""}`,children:[e.jsxs("button",{className:"vr-row",onClick:()=>h(a?null:r.user_id),children:[e.jsxs("div",{className:"vr-row-main",children:[e.jsxs("div",{className:"vr-name",children:[r.agent_name||"Agent",r.team?e.jsx("span",{className:"vr-team",children:r.team}):null,r.is_active?e.jsx("span",{className:"vr-dot",title:"Active",children:"●"}):e.jsx("span",{className:"vr-dot off",title:"Not active",children:"○"})]}),r.persona_summary&&e.jsxs("div",{className:"vr-persona",children:["“",r.persona_summary,"”"]})]}),e.jsx("span",{className:`vr-chev ${a?"up":""}`,children:"⌄"})]}),a&&e.jsxs("div",{className:"vr-detail",children:[r.body&&e.jsxs("div",{className:"vr-block",children:[e.jsx("div",{className:"vr-block-h",children:"The voice"}),String(r.body).split(`

`).map((o,i)=>e.jsx("p",{className:"vr-prose",children:o},i))]}),(s=r.do_examples)!=null&&s.length||(p=r.dont_examples)!=null&&p.length?e.jsxs("div",{className:"vr-cols",children:[(v=r.do_examples)!=null&&v.length?e.jsxs("div",{className:"vr-block",children:[e.jsx("div",{className:"vr-block-h",style:{color:"#5EC78C"},children:"Do"}),r.do_examples.map((o,i)=>e.jsx("div",{className:"vr-li",children:o},i))]}):null,(x=r.dont_examples)!=null&&x.length?e.jsxs("div",{className:"vr-block",children:[e.jsx("div",{className:"vr-block-h",style:{color:"#C75E5E"},children:"Don't"}),r.dont_examples.map((o,i)=>e.jsx("div",{className:"vr-li",children:o},i))]}):null]}):null,r.updated_at&&e.jsxs("div",{className:"vr-updated",children:["Updated ",new Date(r.updated_at).toLocaleDateString()]})]})]},r.user_id)})})]})]})}function f(){return e.jsx("style",{children:`
  .vr { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; }
  .vr-wrap { max-width:760px; margin:0 auto; padding:18px 16px 96px; }
  .vr-head h1 { font-size:26px; font-weight:700; color:var(--text-1); margin-bottom:6px; }
  .vr-head p { font-size:14px; line-height:1.5; color:var(--text-2); margin-bottom:22px; }
  .vr-loading { display:flex; align-items:center; gap:12px; color:var(--text-2); padding:40px 0; justify-content:center; }
  .vr-spin { width:24px; height:24px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:vrspin .8s linear infinite; }
  @keyframes vrspin { to { transform:rotate(360deg); } }
  .vr-empty { background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:24px; color:var(--text-2); font-size:14px; line-height:1.5; text-align:center; }
  .vr-list { display:flex; flex-direction:column; gap:12px; }
  .vr-card { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; overflow:hidden; }
  .vr-card.open { border-color:var(--accent); }
  .vr-row { width:100%; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; background:transparent; border:none; cursor:pointer; padding:16px; text-align:left; }
  .vr-row-main { min-width:0; flex:1; }
  .vr-name { font-size:16px; font-weight:700; color:var(--text-1); display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .vr-team { font-size:11px; font-weight:600; color:var(--text-3); background:var(--bg-base); border:1px solid var(--border); border-radius:20px; padding:2px 9px; }
  .vr-dot { font-size:10px; color:#5EC78C; } .vr-dot.off { color:var(--text-3); }
  .vr-persona { font-size:14px; font-style:italic; color:var(--accent); line-height:1.5; margin-top:8px; }
  .vr-chev { color:var(--text-3); font-size:18px; transition:transform .2s; line-height:1; flex-shrink:0; }
  .vr-chev.up { transform:rotate(180deg); color:var(--accent); }
  .vr-detail { padding:0 16px 16px; border-top:1px solid var(--border); }
  .vr-block { margin-top:16px; }
  .vr-block-h { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--text-3); font-weight:700; margin-bottom:10px; }
  .vr-prose { font-size:14px; line-height:1.6; color:var(--text-2); margin-bottom:10px; } .vr-prose:last-child { margin-bottom:0; }
  .vr-cols { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px; } @media (max-width:560px){ .vr-cols { grid-template-columns:1fr; } }
  .vr-li { font-size:13px; line-height:1.5; color:var(--text-2); padding:6px 0; border-bottom:1px solid var(--border); } .vr-li:last-child { border-bottom:none; }
  .vr-updated { font-size:12px; color:var(--text-3); margin-top:16px; }
  `})}export{y as default};
