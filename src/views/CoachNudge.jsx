// CoachNudge — the paced, behaviour-driven nudge card on the Dashboard.
// Extracted from App.js (strangle the monolith, step 24).
import React, { useState } from 'react';
import { supabase } from '../dataService';
import { tipsAreEnabled } from '../tipsUi';
import { BEHAVIORS, TRIGGER_TEMPLATES, COACH_GLOBAL_GAP, COACH_COOLDOWN, coachSeen, coachLast } from '../coachDomain';

export default function CoachNudge({ contacts = [], tasks = [], events = [], deals = [], reviewCount = 0, oweReplyMap = {}, setView }){
  const [pick, setPick] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const evaluated = React.useRef(false);
  React.useEffect(() => {
    if (evaluated.current) return;
    if (!(contacts.length || reviewCount || tasks.length || Object.keys(oweReplyMap).length)) return; // wait for data
    evaluated.current = true;
    (async () => {
    try {
      if (!tipsAreEnabled()) return;
      if (Date.now() - coachLast() < COACH_GLOBAL_GAP) return;
      const ctx = { contacts, tasks, events, deals, reviewCount, oweReplyMap };
      let dbB = [];
      try {
        const { data } = await supabase.from('teaching_triggers').select('*').eq('active', true);
        dbB = (data || []).map(r => { const tpl = TRIGGER_TEMPLATES[r.template]; if (!tpl) return null; return { id:'db_'+r.id, priority: r.priority || 5, view: r.cta_view || tpl.defaultView, min: (r.template === 'no_cadence' ? 1 : (r.threshold || 1)), test:(x)=>tpl.test(x, r), title:()=>r.title, why: r.why, cta: r.cta_label }; }).filter(Boolean);
      } catch (_) {}
      const seen = coachSeen();
      const cands = [...BEHAVIORS, ...dbB]
        .map(b => ({ b, n: (b.test(ctx) || 0) }))
        .filter(o => o.n >= (o.b.min || 1))
        .filter(o => (Date.now() - (seen[o.b.id] || 0)) >= COACH_COOLDOWN)
        .sort((a, b) => b.b.priority - a.b.priority);
      const chosen = cands[0] ? cands[0].b : null;
      if (chosen) {
        const s = coachSeen(); s[chosen.id] = Date.now();
        localStorage.setItem('prism_coach_seen', JSON.stringify(s));
        localStorage.setItem('prism_coach_last', String(Date.now()));
        setPick(chosen);
      }
    } catch (_) {}
    })();
  }, [contacts, reviewCount, tasks, deals, oweReplyMap]);
  if (!pick || dismissed) return null;
  const ctx = { contacts, tasks, events, deals, reviewCount, oweReplyMap };
  return (
    <div style={{ border:'1px solid rgba(203,163,92,.4)', borderRadius:16, padding:'16px 18px', marginBottom:16, background:'linear-gradient(180deg,#1B1610,#100D09)' }}>
      <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.22em', textTransform:'uppercase', color:'#CBA35C', marginBottom:8 }}>✦ Prism noticed</div>
      <div style={{ fontFamily:'Fraunces, serif', fontSize:18, letterSpacing:'-.01em', color:'#F6F1E7', marginBottom:6 }}>{pick.title(ctx)}</div>
      <div style={{ fontSize:13, lineHeight:1.6, color:'#C8BFAE', marginBottom:14 }}>{pick.why}</div>
      <div style={{ display:'flex', gap:8 }}>
        <button onClick={() => { setDismissed(true); setView(pick.view); }} className="btn btn-primary btn-sm">{pick.cta}</button>
        <button onClick={() => setDismissed(true)} className="btn btn-ghost btn-sm">Not now</button>
      </div>
    </div>
  );
}

// ── John, the accountability coach — Blueprint engine (pluggable by goal_type) ──
