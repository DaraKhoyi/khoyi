// ── Next Best Action engine ─────────────────────────────────────────────────
// SINGLE SOURCE OF TRUTH. Imported by BOTH the client (src/App.js -> the
// Dashboard 'Do this next' hero) AND the server (robot-chat's next_actions
// tool -> Ari's spoken answer). It lived inside App.js and was client-only,
// which meant Ari literally could not read the app's own ranking.
//
// Do NOT fork this. Two copies of the ranking WILL drift, and then the app and
// Ari disagree about what matters most — worse than Ari not answering at all.
//
// Pure functions only: no React, no supabase client, no browser/Deno globals.
// Callers fetch the signals and pass them in.

function nbaLastTouch(c){ const a=[c.last_contact_at,c.last_inbound_at,c.last_outbound_at].filter(Boolean).map(t=>new Date(t).getTime()); return a.length?Math.max(...a):null; }
function nbaAge(d){ d=Math.max(0,Math.floor(d)); if(d<=0) return 'today'; if(d===1) return '1 day'; if(d<7) return d+' days'; if(d<14) return '1 week'; if(d<60) return Math.floor(d/7)+' weeks'; return Math.floor(d/30)+' months'; }
function buildNextActions({ contacts=[], tasks=[], events=[], deals=[], now=Date.now(), oweReplyMap={}, openSignals={} }){
  const out=[]; const today=new Date(now); const todayISO=today.toISOString().slice(0,10);
  const startToday=new Date(new Date(now).setHours(0,0,0,0)).getTime();
  contacts.forEach(c=>{
    if(c.reachout_snooze_until && new Date(c.reachout_snooze_until)>new Date(now)) return;
    const owedAt = oweReplyMap && oweReplyMap[c.id];
    if(!owedAt) return; // per-recipient: surface only if THIS user actually owes a reply
    const lin=new Date(owedAt).getTime(); const days=Math.floor((now-lin)/86400000);
    out.push({ key:'reply:'+c.id, score:100+Math.min(days*4,48), tag:'reply', icon:'reply', contactId:c.id, title:'Reply to '+(c.name||'a contact'), why:'They messaged you '+nbaAge(days)+(days<=0?'':' ago')+' and are waiting to hear back', cta:{ label:'Open', kind:'open_reply', channel:(c.last_communication_channel||'').toLowerCase(), phone:c.phone||null, email:c.email||null, name:c.name||null } });
  });
  // Opened-your-email-no-reply: a warm follow-up window. Only when they opened
  // (confidently) more recently than their last reply, and we don't already owe
  // them a reply (that card wins).
  contacts.forEach(c=>{
    const sig = openSignals && openSignals[c.id];
    if(!sig || !sig.confident_open_at) return;
    if(oweReplyMap && oweReplyMap[c.id]) return;
    if(c.reachout_snooze_until && new Date(c.reachout_snooze_until)>new Date(now)) return;
    const openedMs = new Date(sig.confident_open_at).getTime();
    const linMs = c.last_inbound_at ? new Date(c.last_inbound_at).getTime() : 0;
    if(linMs >= openedMs) return; // they've replied since opening
    const days=Math.floor((now-openedMs)/86400000); const oc=sig.open_count||1;
    out.push({ key:'opened:'+c.id, score:92+Math.min(oc*2,10), tag:'opened', icon:'mail', contactId:c.id, title:'Follow up with '+(c.name||'a contact'), why:'Opened your email'+(oc>1?(' '+oc+'×'):'')+' '+nbaAge(days)+(days<=0?'':' ago')+" and hasn't replied — strike while it's warm", cta:{ label:'Open', kind:'open_reply', channel:'email', email:c.email||null, phone:c.phone||null, name:c.name||null } });
  });
  events.forEach(e=>{ if(!e.start_at||e.all_day) return; const st=new Date(e.start_at).getTime(); const dh=(st-now)/3600000;
    if(dh>=-1 && dh<=24){ out.push({ key:'appt:'+(e.id||e.start_at), score:96+(dh<2?6:0), tag:'appt', icon:'calendar', title:'Prep for: '+(e.title||'appointment'), why:'Starts '+(dh<1?'soon':'in about '+Math.round(dh)+'h')+' — confirm details and prepare', cta:{ label:'Calendar', kind:'view', payload:'calendar' } }); } });
  deals.forEach(d=>{ const stt=(d.status||'').toLowerCase(); if(['under_contract','closing'].includes(stt) && d.close_date){ const cd=new Date(d.close_date).getTime(); const days=Math.round((cd-now)/86400000); if(days>=-3 && days<=14){ out.push({ key:'deal:'+d.id, score:93+(days<=5?5:0), tag:'deal', icon:'dollar', title:'Move deal forward: '+(d.client_name||d.name||'active deal'), why:'Closing '+(days<=0?'now':'in '+days+'d')+' — keep it on track', cta:{ label:'Open deal', kind:'view', payload:'deals' } }); } } });
  tasks.forEach(tk=>{ if(tk.completed||!tk.due_date) return; const pb=tk.priority==='high'?20:tk.priority==='medium'?8:0;
    if(tk.due_date<todayISO){ const od=Math.max(1,Math.floor((startToday-new Date(tk.due_date+'T00:00:00').getTime())/86400000)); out.push({ key:'task:'+tk.id, score:88+pb+Math.min(od*2,28), tag:'overdue', icon:'target', title:tk.title, why:'Overdue '+od+'d'+(tk.priority==='high'?' · high priority':''), cta:{ label:'Mark done', kind:'task_done', payload:tk.id } }); }
    else if(tk.due_date===todayISO){ out.push({ key:'task:'+tk.id, score:70+pb, tag:'today', icon:'target', title:tk.title, why:'Due today'+(tk.priority==='high'?' · high priority':''), cta:{ label:'Mark done', kind:'task_done', payload:tk.id } }); } });
  contacts.forEach(c=>{ const cad=c.cadence_days; if(!cad) return; if(c.reachout_snooze_until && new Date(c.reachout_snooze_until)>new Date(now)) return;
    const ts=nbaLastTouch(c); const ds=ts===null?null:Math.floor((now-ts)/86400000); const due=ds===null||ds>=cad; if(!due) return; const over=ds===null?cad:(ds-cad);
    out.push({ key:'reach:'+c.id, score:58+Math.min(over*1.2,34), tag:'reach', icon:'contacts', title:'Reach out to '+(c.name||'a contact'), why: ds===null?('On a '+cad+'-day cadence — no touch logged yet'):('Last touch '+ds+'d ago · '+cad+'-day cadence'), cta:{ label:'Open', kind:'view', payload:'contacts' } }); });
  return out.sort((a,b)=>b.score-a.score);
}
function buildGrowthMoves({ contacts=[], deals=[], gciGoal=0, now=Date.now() }){
  const moves=[];
  const cold=contacts.filter(c=>{ const ts=nbaLastTouch(c); if(ts===null) return false; return Math.floor((now-ts)/86400000)>=90; });
  if(cold.length>0) moves.push({ key:'cold', icon:'contacts', title:'Reconnect with your sphere', why: cold.length+' '+(cold.length===1?'person has':'people have')+' not heard from you in 90+ days — message 3 of them today', cta:{ label:'Open contacts', kind:'view', payload:'contacts' } });
  const untagged=contacts.filter(c=> (c.type==='lead'||c.pipeline_stage) && !c.lead_gen_system_id);
  if(untagged.length>0) moves.push({ key:'untagged', icon:'signal', title:'Tag where your leads came from', why: untagged.length+' lead'+(untagged.length===1?'':'s')+' have no source yet — tag them so you learn what actually produces', cta:{ label:'Tag sources', kind:'view', payload:'contacts' } });
  const stalled=contacts.filter(c=>{ if(!c.pipeline_stage||['closed','lost'].includes(c.pipeline_stage)) return false; const ch=c.pipeline_stage_changed_at?new Date(c.pipeline_stage_changed_at).getTime():null; return ch!==null && (now-ch)>=14*86400000; });
  if(stalled.length>0) moves.push({ key:'stalled', icon:'target', title:'Unstick stalled leads', why: stalled.length+' lead'+(stalled.length===1?'':'s')+' have sat in one stage 2+ weeks — give them a nudge', cta:{ label:'My pipeline', kind:'view', payload:'pipeline' } });
  const closedDeals=deals.filter(d=>(d.status||'').toLowerCase()==='closed');
  if(closedDeals.length>0) moves.push({ key:'referral', icon:'reply', title:'Ask a past client for a referral', why:'You have '+closedDeals.length+' past closing'+(closedDeals.length===1?'':'s')+' — a happy client is your best lead source', cta:{ label:'Open contacts', kind:'view', payload:'contacts' } });
  if(!(gciGoal>0)) moves.push({ key:'goal', icon:'dollar', title:'Set your GCI goal', why:'A target turns activity into a plan — set it and your pace tracks itself', cta:{ label:'Set goal', kind:'view', payload:'finance' } });
  moves.push({ key:'calls', icon:'contacts', title:'Make 5 connection calls', why:'The fastest path to a deal is conversations — call 5 people in your sphere today', cta:{ label:'Open contacts', kind:'view', payload:'contacts' } });
  moves.push({ key:'oh', icon:'target', title:'Line up an open house', why:'One listing becomes many buyer leads — plan an open house this week', cta:{ label:'My pipeline', kind:'view', payload:'pipeline' } });
  return moves;
}

export { nbaLastTouch, nbaAge, buildNextActions, buildGrowthMoves };

// ── Signal builders for the two sources that live outside buildNextActions ───
// These were inline in the Dashboard's useEffects, which is why Ari could not see
// them either. Pure: the caller does the query and passes the rows in.

// Delivery-failure copy. A bounce is the ONLY signal that an email the app already
// told you was "Sent." never actually arrived — so it outranks everything else.
const BOUNCE_SHORT = {
  alias_misconfigured: 'the “send as” alias can’t sign in',
  address_not_found: 'that address doesn’t exist',
  mailbox_full: 'their mailbox is full',
  blocked_spam: 'their server rejected it as spam',
  too_large: 'the message was too big',
  domain_not_found: 'their email domain wasn’t found',
  unknown: 'delivery failed',
};

function bounceSignals(rows = []) {
  return (rows || []).map(b => {
    const rec = b.failed_recipients || [];
    const who = rec.length === 1 ? rec[0] : (rec.length ? rec.length + ' people' : 'its recipients');
    return { key: 'bounce:' + b.id, score: 98, tag: 'bounce', icon: 'alert', contactId: null,
      title: 'Your email never reached ' + who,
      why: ('“' + String(b.original_subject || '(no subject)').slice(0, 58) + '” — ' + (BOUNCE_SHORT[b.reason_code] || 'delivery failed') + '. It looked sent, but it wasn’t.'),
      cta: { label: 'See what happened', kind: 'bounces' } };
  });
}

function docSignals(rows = [], contacts = []) {
  return (rows || []).map(d => {
    const cid = d.document_contacts && d.document_contacts[0] ? d.document_contacts[0].contact_id : null;
    const cn = cid ? ((contacts.find(c => c.id === cid) || {}).name || '') : '';
    return { key: 'doc:' + d.id, score: 86 + (d.signed_state === 'unsigned' ? 6 : 0), tag: 'document', icon: 'target', contactId: cid,
      title: d.action_label || ('Handle ' + (d.title || 'a document')),
      why: ((cn ? cn + ' · ' : '') + (d.doc_type && d.doc_type !== 'other' ? d.doc_type + ' · ' : '') + (d.signed_state === 'unsigned' ? 'unsigned — needs signature' : (d.summary || 'needs attention'))).slice(0, 130),
      cta: { label: 'Open', kind: 'view', payload: 'documents' } };
  });
}

export { BOUNCE_SHORT, bounceSignals, docSignals };
