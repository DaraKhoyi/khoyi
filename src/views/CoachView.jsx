// CoachView — the Coach screen (Blueprint, pace, weakest-link coaching, chat)
// and its GoalSetup editor. Extracted from App.js (strangle the monolith, step 24).
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../dataService';
import { lbl, money } from '../helpers';
import { tipsAreEnabled } from '../tipsUi';
import PrismThinking from './PrismThinking';
import { buildBlueprint, computePace, weakestLinkCoaching, computeCoachTrend } from '../coachDomain';

function GoalSetup({ userId, coachName, existing, onSaved, onCancel }){
  const ep = (existing && existing.params) || {};
  const [goalType, setGoalType] = useState((existing && existing.goal_type) || 'sales');
  const [target, setTarget] = useState(existing ? String(existing.target_amount || '') : '');
  const [avgComm, setAvgComm] = useState(String(ep.avg_commission || 9000));
  const [apptsPerDeal, setApptsPerDeal] = useState(String(ep.appts_per_deal || 3));
  const [perHire, setPerHire] = useState(String(ep.avg_production_per_hire || 3000000));
  const [apptsPerHire, setApptsPerHire] = useState(String(ep.appts_per_hire || 5));
  const [convosPerAppt, setConvosPerAppt] = useState(String(ep.convos_per_appt || 5));
  const [weeks, setWeeks] = useState(String(ep.work_weeks || 50));
  const [saving, setSaving] = useState(false);
  const isRecruit = goalType === 'recruiting';
  const previewGoal = isRecruit
    ? { goal_type:'recruiting', target_amount: target, outcome_label:'Recruited production', params:{ avg_production_per_hire: perHire, appts_per_hire: apptsPerHire, convos_per_appt: convosPerAppt, work_weeks: weeks } }
    : { goal_type:'sales', target_amount: target, outcome_label:'GCI', params:{ avg_commission: avgComm, appts_per_deal: apptsPerDeal, convos_per_appt: convosPerAppt, work_weeks: weeks } };
  const preview = buildBlueprint(previewGoal);
  const save = async () => {
    if (!(Number(target) > 0)) return;
    setSaving(true);
    const params = isRecruit
      ? { avg_production_per_hire: Number(perHire) || 3000000, appts_per_hire: Number(apptsPerHire) || 5, convos_per_appt: Number(convosPerAppt) || 4, work_weeks: Number(weeks) || 50 }
      : { avg_commission: Number(avgComm) || 9000, appts_per_deal: Number(apptsPerDeal) || 3, convos_per_appt: Number(convosPerAppt) || 5, work_weeks: Number(weeks) || 50 };
    const outcome_label = isRecruit ? 'Recruited production' : 'GCI';
    try {
      if (existing) await supabase.from('coach_goals').update({ goal_type: goalType, outcome_label, target_amount: Number(target), params }).eq('id', existing.id);
      else { await supabase.from('coach_goals').update({ active:false }).eq('user_id', userId).eq('active', true); await supabase.from('coach_goals').insert({ user_id: userId, goal_type: goalType, outcome_label, target_amount: Number(target), timeframe:'12mo', params, active:true }); }
    } catch(_){}
    setSaving(false); onSaved();
  };
  const lbl = { fontSize:11, fontWeight:700, color:'#C8BFAE', margin:'12px 0 4px' };
  const seg = (val, label) => <button onClick={() => setGoalType(val)} style={{ flex:1, padding:'9px', borderRadius:8, border:'1px solid '+(goalType===val?'#CBA35C':'rgba(203,163,92,.24)'), background: goalType===val?'rgba(203,163,92,.14)':'transparent', color: goalType===val?'#EBCB82':'#C8BFAE', fontSize:12.5, fontWeight:700, cursor:'pointer' }}>{label}</button>;
  return (
    <div className="ww-prism">
      <style>{`.ww-prism{--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.10), transparent 60%),#100D09;min-height:100%;} .ww-prism .form-input{background:#0c0a07;border:1px solid rgba(203,163,92,.24);color:#F6F1E7;border-radius:8px;padding:10px 12px;font-size:14px;font-family:inherit;box-sizing:border-box;width:100%;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.3);color:#C8BFAE;background:transparent;}`}</style>
      {onCancel && <button onClick={onCancel} className="btn btn-ghost btn-sm" style={{ marginBottom:12 }}>← Back</button>}
      <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.24em', textTransform:'uppercase', color:'#CBA35C', marginBottom:4 }}>✦ {coachName} · your Blueprint</div>
      <h2 style={{ fontFamily:'Fraunces, serif', fontWeight:300, fontSize:28, margin:'0 0 4px', color:'#F6F1E7' }}>{existing ? 'Adjust your goal' : 'Let’s build your Blueprint'}</h2>
      <p style={{ fontSize:13, color:'#C8BFAE', margin:'0 0 6px' }}>Your goal isn’t a number — it’s a chain of activity that produces it. Tell {coachName} your target and how it converts, and he’ll work backward to the one number you drive every day.</p>
      <div style={{ display:'flex', gap:8, margin:'12px 0 2px' }}>{seg('sales', 'Sales (GCI)')}{seg('recruiting', 'Recruiting')}</div>
      <div style={lbl}>{isRecruit ? 'Recruited production goal for the year (hires × their trailing-12 sales)' : 'Your income goal (GCI) for the year'}</div>
      <input className="form-input" type="number" value={target} onChange={e=>setTarget(e.target.value)} placeholder={isRecruit ? 'e.g. 15000000' : 'e.g. 150000'} />
      <div style={{ display:'flex', gap:10 }}>
        <div style={{ flex:1 }}><div style={lbl}>{isRecruit ? 'Avg production / hire ($)' : 'Avg commission / closing ($)'}</div><input className="form-input" type="number" value={isRecruit ? perHire : avgComm} onChange={e => isRecruit ? setPerHire(e.target.value) : setAvgComm(e.target.value)} /></div>
        <div style={{ flex:1 }}><div style={lbl}>Working weeks / year</div><input className="form-input" type="number" value={weeks} onChange={e=>setWeeks(e.target.value)} /></div>
      </div>
      <div style={{ display:'flex', gap:10 }}>
        <div style={{ flex:1 }}><div style={lbl}>{isRecruit ? 'Appointments per hire' : 'Appointments per closing'}</div><input className="form-input" type="number" value={isRecruit ? apptsPerHire : apptsPerDeal} onChange={e => isRecruit ? setApptsPerHire(e.target.value) : setApptsPerDeal(e.target.value)} /></div>
        <div style={{ flex:1 }}><div style={lbl}>Conversations per appointment</div><input className="form-input" type="number" value={convosPerAppt} onChange={e=>setConvosPerAppt(e.target.value)} /></div>
      </div>
      <div style={{ fontSize:11, color:'#8C8475', marginTop:6 }}>Not sure on the ratios? The defaults are a solid start — {coachName} sharpens them from your real numbers over time.</div>
      {Number(target) > 0 && (
        <div style={{ marginTop:16, padding:'14px 16px', borderRadius:14, background:'rgba(203,163,92,.08)', border:'1px solid rgba(203,163,92,.3)' }}>
          <div style={{ fontSize:11, color:'#C8BFAE', marginBottom:4 }}>To hit ${Number(target).toLocaleString()}, your daily number is</div>
          <div style={{ fontFamily:'Fraunces, serif', fontSize:32, fontWeight:300, color:'#EBCB82', lineHeight:1 }}>{preview.leading.perDay} <span style={{ fontSize:14, color:'#C8BFAE' }}>{isRecruit ? 'recruiting conversations' : 'conversations'} / day</span></div>
          <div style={{ fontSize:12, color:'#8C8475', marginTop:6 }}>{preview.leading.perWeek}/week → {preview.links[1].needed} {isRecruit ? 'appointments' : 'appointments'} → {preview.links[2].needed} {isRecruit ? 'hires' : 'closings'} → ${Number(target).toLocaleString()}</div>
        </div>
      )}
      <button onClick={save} disabled={saving || !(Number(target)>0)} className="btn btn-primary" style={{ marginTop:16, width:'100%', opacity:(Number(target)>0?1:0.5) }}>{saving ? 'Saving…' : (existing ? 'Update my Blueprint' : 'Build my Blueprint')}</button>
    </div>
  );
}


export default function CoachView({ userId, setView }){
  const [settings, setSettings] = useState(null);
  const [goal, setGoal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState('');
  const [thinking, setThinking] = useState(false);
  const [pace, setPace] = useState(null);
  const [trend, setTrend] = useState(null);
  const [rhythmMsg, setRhythmMsg] = useState(null);
  const [rhythmBusy, setRhythmBusy] = useState(false);
  const [moment, setMoment] = useState(null);
  const [celebrate, setCelebrate] = useState(null);
  const [recList, setRecList] = useState([]);
  const [recBusy, setRecBusy] = useState(false);
  const [recReview, setRecReview] = useState(null);
  const [recPickerOpen, setRecPickerOpen] = useState(false);
  const load = React.useCallback(async () => {
    try {
      const [{ data: s }, { data: g }, { data: ch }] = await Promise.all([
        supabase.from('coach_settings').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('coach_goals').select('*').eq('user_id', userId).eq('active', true).order('created_at', { ascending:false }).limit(1).maybeSingle(),
        supabase.from('coach_checkins').select('role,content,created_at,kind').eq('user_id', userId).order('created_at', { ascending:false }).limit(40),
      ]);
      setSettings(s || { coach_name:'John' }); setGoal(g || null);
      computeCoachTrend(userId).then(t => setTrend(t));
      const all = ch || [];
      setMsgs(all.filter(c => (c.kind === 'adhoc' || !c.kind) && (c.role === 'coach' || c.role === 'agent')).reverse().map(c => ({ role:c.role, content:c.content })));
      const todayStr = new Date().toDateString();
      const isToday = (t) => new Date(t).toDateString() === todayStr;
      const recentRhythm = all.find(c => ['morning','evening','weekly'].includes(c.kind));
      if (recentRhythm && (isToday(recentRhythm.created_at) || (recentRhythm.kind === 'weekly' && (Date.now() - new Date(recentRhythm.created_at).getTime()) < 2 * 86400000))) setRhythmMsg({ mode: recentRhythm.kind, content: recentRhythm.content });
      const rhythmSetting = (s && s.rhythm) || 'weekly';
      if (rhythmSetting !== 'light') {
        const doneToday = (k) => all.some(c => c.kind === k && isToday(c.created_at));
        const lastWeekly = all.find(c => c.kind === 'weekly');
        const daysSinceWeekly = lastWeekly ? (Date.now() - new Date(lastWeekly.created_at).getTime()) / 86400000 : 999;
        const hr = new Date().getHours();
        if (daysSinceWeekly >= 7) setMoment('weekly');
        else if (rhythmSetting === 'daily') { if (hr < 12 && !doneToday('morning')) setMoment('morning'); else if (hr >= 17 && !doneToday('evening')) setMoment('evening'); }
      }
      if (!g) { setEditing(true); }
      else {
        try {
          const bpp = buildBlueprint(g);
          const start = g.start_date || g.created_at;
          const nowIso = new Date().toISOString();
          const [cv, ap, cl] = await Promise.all([
            supabase.from('contact_interactions').select('id', { count:'exact', head:true }).eq('user_id', userId).in('kind', ['call','meeting']).gte('occurred_at', start),
            // APPOINTMENT = tied to a PERSON, at a specific time, not a calendar
            // artifact, and not one the user has explicitly excluded.
            //
            // Counting every calendar row put 438 "appointments" against 205
            // conversations — a funnel whose downstream step is bigger than the
            // one feeding it, which cannot happen. But contact_id alone is not
            // enough either: PrismOS deliberately encourages mixing personal and
            // business on one calendar, so "Anvar" and "Dinner party at Ali's"
            // are contact-linked and are not client appointments. Birthdays name
            // a contact too. Hence: timed, non-artifact, and overridable —
            // is_appointment=false is the user's final word.
            supabase.from('events').select('id', { count:'exact', head:true }).eq('user_id', userId).not('contact_id', 'is', null).eq('all_day', false).not('title', 'ilike', '%birthday%').not('title', 'ilike', '%anniversary%').not('is_appointment', 'is', false).gte('start_at', start).lte('start_at', nowIso),
            supabase.from('deals').select('gross_commission').eq('user_id', userId).eq('status','closed').gte('close_date', start),
          ]);
          const closings = cl.data || [];
          const actuals = { convos: cv.count || 0, appts: ap.count || 0, closings: closings.length, gciActual: closings.reduce((s2,d)=> s2 + (Number(d.gross_commission)||0), 0) };
          setPace(computePace(g, bpp, actuals));
          try { const prev = parseInt(localStorage.getItem('coach_last_closings') || '-1', 10); if (prev >= 0 && actuals.closings > prev) setCelebrate(actuals.closings); localStorage.setItem('coach_last_closings', String(actuals.closings)); } catch(_){}
        } catch(_){}
      }
    } catch(_){}
    setLoading(false);
  }, [userId]);
  React.useEffect(() => { load(); }, [load]);
  const coachName = (settings && settings.coach_name) || 'John';
  const send = async (preset) => {
    const text = (typeof preset === 'string' ? preset : input).trim(); if (!text || thinking) return;
    setInput(''); setMsgs(m => [...m, { role:'agent', content:text }]); setThinking(true);
    try {
      const paceSummary = pace ? { status: pace.status, onTrack: pace.onTrack, projectedGci: pace.projectedGci, neededPerDay: pace.neededPerDay, elapsedDays: pace.elapsedDays, totalDays: pace.totalDays, weakest: { key: pace.weakest.key, label: pace.weakest.label, actual: pace.weakest.actual, needed: pace.weakest.needed }, links: pace.links.map(l => ({ label:l.label, actual:l.actual, needed:l.needed, expected:l.expected })) } : null;
      const { data } = await supabase.functions.invoke('coach-chat', { body: { message: text, pace: paceSummary, trend: trend ? { weeks: trend.weeks, slump: trend.slump, streak: trend.streak, wellbeing: trend.wellbeing } : null } });
      const reply = (data && data.reply) || 'I’m having trouble reaching my notes right now — try me again in a moment.';
      setMsgs(m => [...m, { role:'coach', content: reply }]);
    } catch (_) { setMsgs(m => [...m, { role:'coach', content:'I’m having trouble connecting right now — try again in a moment.' }]); }
    setThinking(false);
  };
  const computeWeekWindow = async () => {
    try {
      const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
      const nowIso = new Date().toISOString();
      const [cv, ap, cl] = await Promise.all([
        supabase.from('contact_interactions').select('id', { count:'exact', head:true }).eq('user_id', userId).in('kind', ['call','meeting']).gte('occurred_at', weekAgo),
        // Same definition as the pace query — these two must agree or the weekly
        // window contradicts the year-to-date chain on the same screen.
        supabase.from('events').select('id', { count:'exact', head:true }).eq('user_id', userId).not('contact_id', 'is', null).eq('all_day', false).not('title', 'ilike', '%birthday%').not('title', 'ilike', '%anniversary%').not('is_appointment', 'is', false).gte('start_at', weekAgo).lte('start_at', nowIso),
        supabase.from('deals').select('id', { count:'exact', head:true }).eq('user_id', userId).eq('status', 'closed').gte('close_date', weekAgo),
      ]);
      return { convos: cv.count || 0, appts: ap.count || 0, closings: cl.count || 0 };
    } catch(_){ return null; }
  };
  const paceSummary = () => pace ? { status:pace.status, onTrack:pace.onTrack, projectedGci:pace.projectedGci, neededPerDay:pace.neededPerDay, elapsedDays:pace.elapsedDays, totalDays:pace.totalDays, weakest:{ key:pace.weakest.key, label:pace.weakest.label, actual:pace.weakest.actual, needed:pace.weakest.needed }, links:pace.links.map(l => ({ label:l.label, actual:l.actual, needed:l.needed, expected:l.expected })) } : null;
  const triggerRhythm = async (mode) => {
    setRhythmBusy(true); setMoment(null);
    try {
      const win = mode === 'weekly' ? await computeWeekWindow() : null;
      const { data } = await supabase.functions.invoke('coach-chat', { body: { message:'', mode, window: win, pace: paceSummary(), trend: trend ? { weeks: trend.weeks, slump: trend.slump, streak: trend.streak, wellbeing: trend.wellbeing } : null } });
      setRhythmMsg({ mode, content: (data && data.reply) || '' });
    } catch(_){ setRhythmBusy(false); }
    setRhythmBusy(false);
  };
  const openRecPicker = async () => {
    setRecPickerOpen(true);
    try { const { data } = await supabase.from('recordings').select('id,title,recorded_at,created_at').eq('user_id', userId).eq('transcription_status', 'ready').not('transcript_text', 'is', null).order('recorded_at', { ascending:false }).limit(12); setRecList(data || []); } catch(_){ setRecList([]); }
  };
  const reviewRecording = async (id) => {
    setRecBusy(true); setRecPickerOpen(false);
    try {
      const { data } = await supabase.functions.invoke('coach-recording-review', { body: { recording_id: id } });
      if (data && data.reply) setRecReview({ title: data.title, meRatio: data.me_ratio, reply: data.reply });
      else setRecReview({ title:'', meRatio:null, reply:'I couldn’t review that one — the transcript may not be ready yet.' });
    } catch(_){ setRecReview({ title:'', meRatio:null, reply:'I ran into trouble reviewing that — try again in a moment.' }); }
    setRecBusy(false);
  };
  if (loading) return <div className="ww-prism" style={{ padding:20 }}><PrismThinking label="Loading your Blueprint" /></div>;
  if (editing) return <GoalSetup userId={userId} coachName={coachName} existing={goal} onSaved={() => { setEditing(false); load(); }} onCancel={goal ? () => setEditing(false) : null} />;
  const bp = buildBlueprint(goal);
  return (
    <div className="ww-prism">
      <style>{`.ww-prism{--text-1:#F6F1E7;--text-2:#C8BFAE;--text-3:#8C8475;font-family:Manrope,sans-serif;background:radial-gradient(120% 26% at 50% -4%, rgba(203,163,92,.10), transparent 60%),#100D09;min-height:100%;} .ww-prism .form-input{background:#0c0a07;border:1px solid rgba(203,163,92,.24);color:#F6F1E7;border-radius:10px;padding:11px 13px;font-size:14px;font-family:inherit;box-sizing:border-box;width:100%;} .ww-prism .btn-primary{background:#EBCB82;color:#1a1409;border:none;} .ww-prism .btn-ghost{border:1px solid rgba(203,163,92,.3);color:#C8BFAE;background:transparent;}`}</style>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:10 }}>
        <div>
          <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.24em', textTransform:'uppercase', color:'#CBA35C', marginBottom:4 }}>✦ {coachName} · your coach</div>
          <h2 style={{ fontFamily:'Fraunces, serif', fontWeight:300, fontSize:28, letterSpacing:'-.02em', margin:'0 0 2px', color:'#F6F1E7' }}>Your Blueprint</h2>
        </div>
        <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm" style={{ flexShrink:0, marginTop:6, fontSize:11 }}>Adjust goal</button>
      </div>
      {trend && trend.insight && (
        <div style={{ marginBottom:14, padding:'14px 16px', borderRadius:14, background: trend.insight.kind==='streak'?'rgba(120,180,120,.08)':'rgba(203,163,92,.06)', border:'1px solid '+(trend.insight.kind==='wellbeing'?'rgba(224,150,90,.45)':trend.insight.kind==='streak'?'rgba(120,180,120,.4)':'rgba(203,163,92,.35)') }}>
          <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color: trend.insight.kind==='streak'?'#8FCA8F':trend.insight.kind==='wellbeing'?'#e0965a':'#CBA35C', marginBottom:6 }}>{trend.insight.kind==='wellbeing'?'💛 A gentle check-in':trend.insight.kind==='streak'?'🔥 Pattern':'👀 '+coachName+' noticed a pattern'}</div>
          <div style={{ fontFamily:'Fraunces, serif', fontSize:17, color:'#F6F1E7', marginBottom:5 }}>{trend.insight.title}</div>
          <div style={{ fontSize:12.5, color:'#C8BFAE', lineHeight:1.55, marginBottom:10 }}>{trend.insight.body}</div>
          <div style={{ display:'flex', gap:4, alignItems:'flex-end', height:28, marginBottom:10 }}>{trend.weeks.map((v, i) => { const mx = Math.max(...trend.weeks, 1); return <div key={i} style={{ flex:1, height:Math.max(3, Math.round(v / mx * 28)) + 'px', background: i===7 ? '#EBCB82' : 'rgba(203,163,92,.35)', borderRadius:2 }} />; })}</div>
          <button onClick={() => send('Coach me on this — ' + trend.insight.title)} className="btn btn-primary btn-sm">Talk to {coachName}</button>
        </div>
      )}
      {celebrate != null && (
        <div style={{ marginBottom:14, padding:'14px 16px', borderRadius:14, background:'rgba(120,180,120,.1)', border:'1px solid rgba(120,180,120,.45)' }}>
          <div style={{ fontSize:20, marginBottom:2 }}>🎉</div>
          <div style={{ fontFamily:'Fraunces, serif', fontSize:18, color:'#F6F1E7', marginBottom:4 }}>That’s a closing — {celebrate} this period!</div>
          <div style={{ fontSize:12.5, color:'#C8BFAE' }}>Real progress on your chain. Take the win — then let’s line up the next one.</div>
          <button onClick={() => { setCelebrate(null); send('I just closed a deal!'); }} className="btn btn-primary btn-sm" style={{ marginTop:10 }}>Tell {coachName}</button>
        </div>
      )}
      {(moment || rhythmMsg || rhythmBusy) && (
        <div style={{ marginBottom:14, padding:'14px 16px', borderRadius:14, background:'linear-gradient(180deg,#1B1610,#100D09)', border:'1px solid rgba(203,163,92,.4)' }}>
          {rhythmBusy ? <PrismThinking label={coachName + ' is writing'} /> : rhythmMsg ? (<>
            <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:'#CBA35C', marginBottom:6 }}>{rhythmMsg.mode === 'weekly' ? '📋 Weekly review' : rhythmMsg.mode === 'morning' ? '☀️ Morning kickoff' : '🌙 Evening reflection'} · {coachName}</div>
            <div style={{ fontSize:13.5, color:'#F6F1E7', lineHeight:1.55, whiteSpace:'pre-wrap' }}>{rhythmMsg.content}</div>
            {rhythmMsg.mode === 'evening' && <input className="form-input" placeholder={'Reply to ' + coachName + '…'} onKeyDown={e => { if (e.key === 'Enter' && e.target.value.trim()) { send(e.target.value.trim()); setRhythmMsg(null); } }} style={{ marginTop:10 }} />}
          </>) : (<>
            <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:'#CBA35C', marginBottom:6 }}>{moment === 'weekly' ? '📋 Weekly review' : moment === 'morning' ? '☀️ Morning kickoff' : '🌙 Evening reflection'}</div>
            <div style={{ fontSize:13.5, color:'#F6F1E7', marginBottom:10 }}>{moment === 'weekly' ? 'Ready for your weekly review with ' + coachName + '?' : moment === 'morning' ? 'Ready to start the day with ' + coachName + '?' : 'Let’s reflect on today with ' + coachName + '.'}</div>
            <button onClick={() => triggerRhythm(moment)} className="btn btn-primary btn-sm">Start</button>
          </>)}
        </div>
      )}
      <div style={{ margin:'12px 0 14px', padding:'18px', borderRadius:16, background:'linear-gradient(180deg,#1B1610,#100D09)', border:'1px solid rgba(203,163,92,.34)' }}>
        <div style={{ fontSize:11.5, color:'#C8BFAE', marginBottom:4 }}>Today’s leading number — the one domino that makes the rest fall</div>
        <div style={{ fontFamily:'Fraunces, serif', fontSize:44, fontWeight:300, color:'#EBCB82', lineHeight:1 }}>{pace && pace.status === 'behind' ? pace.neededPerDay : bp.leading.perDay}</div>
        <div style={{ fontSize:13, color:'#F6F1E7', marginTop:2 }}>conversations today{pace && pace.status === 'behind' ? ' to get back on track' : ''} · plan is {bp.leading.perDay}/day</div>
      </div>
      {pace && (() => {
        // Four states, because a green/amber binary lied in two of them: it
        // called day one "behind" off a single expected conversation, and it
        // demanded a catch-up rate for a period that had already closed.
        const TONE = {
          ontrack:  { c:'#8FCA8F', bd:'rgba(120,180,120,.4)',  bg:'rgba(120,180,120,.08)', label:'On pace' },
          behind:   { c:'#e0965a', bd:'rgba(224,150,90,.45)',  bg:'rgba(224,150,90,.08)',  label:'Behind pace' },
          early:    { c:'#CBA35C', bd:'rgba(203,163,92,.4)',   bg:'rgba(203,163,92,.07)',  label:'Just getting started' },
          finished: { c:'#C8BFAE', bd:'rgba(200,191,174,.35)', bg:'rgba(200,191,174,.06)', label:'Period ended' },
        };
        const t = TONE[pace.status] || TONE.behind;
        const goalK = (Number(bp.outcome.amount) || 0) / 1000;
        const projK = (Number(pace.projectedGci) || 0) / 1000;
        return (
          <div style={{ marginBottom:16, padding:'14px 16px', borderRadius:14, border:'1px solid '+t.bd, background:t.bg }}>
            <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:t.c, marginBottom:6 }}>{t.label} · day {pace.elapsedDays} of {pace.totalDays}</div>
            {pace.status === 'early' ? (
              <div style={{ fontSize:13.5, color:'#F6F1E7', lineHeight:1.5 }}>Too little of the period has passed to project anything meaningful. Log conversations for a couple of weeks and this will start telling you where you actually stand.</div>
            ) : pace.status === 'finished' ? (
              <div style={{ fontSize:13.5, color:'#F6F1E7', lineHeight:1.5 }}>This goal’s window has closed. You finished with <b style={{ color:'#EBCB82' }}>${pace.gciActual.toLocaleString()}</b> against a ${goalK.toFixed(0)}k goal. Set a new goal to start measuring again.</div>
            ) : (<>
              <div style={{ fontSize:13.5, color:'#F6F1E7', lineHeight:1.5 }}>At your current pace you’re tracking to <b style={{ color:'#EBCB82' }}>${projK.toFixed(0)}k</b> — your goal is ${goalK.toFixed(0)}k.</div>
              {pace.status === 'behind' && <div style={{ fontSize:12.5, color:'#C8BFAE', marginTop:6 }}>To still hit it: <b style={{ color:'#F6F1E7' }}>{pace.neededPerDay} conversations/day</b> from here.</div>}
            </>)}
          </div>
        );
      })()}
      <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.22em', textTransform:'uppercase', color:'#CBA35C', marginBottom:10 }}>Your chain {pace ? '— actual vs. plan' : '— to $'+Number(bp.outcome.amount).toLocaleString()}</div>
      <div style={{ marginBottom:18 }}>
        {(pace ? pace.links : bp.links.map(l => ({ ...l, actual:null, expected:null, paceRatio:1 }))).map((lk, i) => {
          const leading = i === 0;
          const behind = pace && lk.paceRatio < 0.95;
          const pct = pace && lk.needed > 0 ? Math.min(100, Math.round(lk.actual / lk.needed * 100)) : 0;
          const expPct = pace && lk.needed > 0 ? Math.min(100, Math.round(lk.expected / lk.needed * 100)) : 0;
          return (
            <div key={lk.key} style={{ padding:'12px 14px', marginBottom:8, borderRadius:12, border:'1px solid '+(leading?'#CBA35C':'rgba(203,163,92,.18)'), background: leading?'rgba(203,163,92,.08)':'transparent' }}>
              <div style={{ display:'flex', alignItems:'baseline', gap:8, marginBottom: pace?7:0 }}>
                <span style={{ fontSize:13.5, fontWeight:700, color:'#F6F1E7', flex:1 }}>{lk.label}{leading && <span style={{ fontSize:10, color:'#CBA35C', marginLeft:6, fontWeight:700 }}>← DRIVE THIS</span>}</span>
                {pace ? <span style={{ fontSize:12.5, color:'#C8BFAE' }}><b style={{ color: behind?'#e0965a':'#8FCA8F' }}>{lk.actual.toLocaleString()}</b> / {lk.needed.toLocaleString()}</span>
                       : <span style={{ fontFamily:'Fraunces, serif', fontSize:20, color:'#F6F1E7' }}>{lk.needed.toLocaleString()}</span>}
              </div>
              {pace && (
                <div style={{ position:'relative', height:7, borderRadius:100, background:'rgba(203,163,92,.14)', overflow:'hidden' }}>
                  <div style={{ position:'absolute', left:0, top:0, height:'100%', width:pct+'%', background: behind?'linear-gradient(90deg,#c77d43,#e0965a)':'linear-gradient(90deg,#5f9a5f,#8FCA8F)', borderRadius:100 }} />
                  <div style={{ position:'absolute', left:'calc('+expPct+'% - 1px)', top:-2, width:2, height:11, background:'#EBCB82' }} />
                </div>
              )}
            </div>
          );
        })}
        <div style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', borderRadius:12, border:'1px solid rgba(203,163,92,.34)', background:'rgba(203,163,92,.06)' }}>
          <span style={{ fontFamily:'Fraunces, serif', fontSize:22, fontWeight:300, color:'#EBCB82', minWidth:64 }}>${(Number(bp.outcome.amount)/1000).toFixed(0)}k</span>
          <div style={{ fontSize:13.5, fontWeight:700, color:'#F6F1E7', flex:1 }}>{bp.outcome.label} — your goal{pace && pace.gciActual>0 ? <span style={{ fontSize:11, color:'#8FCA8F', fontWeight:400, marginLeft:6 }}>${(pace.gciActual/1000).toFixed(0)}k closed so far</span> : null}</div>
        </div>
      </div>
      {pace && (() => { const wc = weakestLinkCoaching(pace); return (
        <div style={{ marginBottom:18, padding:'14px 16px', borderRadius:14, background:'rgba(203,163,92,.06)', border:'1px solid rgba(203,163,92,.3)' }}>
          <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:'#CBA35C', marginBottom:6 }}>Your weakest link</div>
          <div style={{ fontFamily:'Fraunces, serif', fontSize:17, color:'#F6F1E7', marginBottom:5 }}>{wc.title}</div>
          <div style={{ fontSize:12.5, color:'#C8BFAE', lineHeight:1.55, marginBottom:10 }}>{wc.why}</div>
          <button onClick={() => send('Coach me on my weakest link — ' + wc.title)} className="btn btn-primary btn-sm">Talk to {coachName} about this</button>
        </div>
      ); })()}
      {pace && pace.links.length >= 3 && pace.links[1].actual >= 3 && (() => {
        const c = pace.links[0].actual, a = pace.links[1].actual, d = pace.links[2].actual;
        const real = { cpa: a > 0 ? c / a : null, apd: d > 0 ? a / d : null, comm: d > 0 ? pace.gciActual / d : null };
        const asm = bp.ratios;
        const fmt1 = (x) => x == null ? '—' : (Math.round(x * 10) / 10);
        const worse = (realV, asmV) => realV != null && realV > asmV * 1.15;
        const applyReal = async () => {
          const params = { ...(goal.params || {}), convos_per_appt: real.cpa ? Math.round(real.cpa * 10) / 10 : asm.convosPerAppt, appts_per_deal: real.apd ? Math.round(real.apd * 10) / 10 : asm.apptsPerDeal, avg_commission: real.comm ? Math.round(real.comm) : asm.avgComm };
          try { await supabase.from('coach_goals').update({ params }).eq('id', goal.id); load(); } catch(_){}
        };
        const Row = ({ label, realV, asmV, money }) => (
          <div style={{ display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:'1px solid rgba(203,163,92,.1)' }}>
            <span style={{ flex:1, fontSize:12.5, color:'#F6F1E7' }}>{label}</span>
            <span style={{ fontSize:12.5, color: worse(realV, asmV) ? '#e0965a' : '#8FCA8F', fontWeight:700 }}>{realV == null ? '—' : (money ? ('$' + Math.round(realV).toLocaleString()) : fmt1(realV))}</span>
            <span style={{ fontSize:11, color:'#8C8475', minWidth:64, textAlign:'right' }}>plan {money ? ('$' + Math.round(asmV).toLocaleString()) : asmV}</span>
          </div>
        );
        return (
          <div style={{ marginBottom:18, padding:'14px 16px', borderRadius:14, background:'#150F0A', border:'1px solid rgba(203,163,92,.24)' }}>
            <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.2em', textTransform:'uppercase', color:'#CBA35C', marginBottom:8 }}>Your real conversion · from {a} appointments</div>
            <Row label="Conversations per appointment" realV={real.cpa} asmV={asm.convosPerAppt} />
            <Row label="Appointments per closing" realV={real.apd} asmV={asm.apptsPerDeal} />
            <Row label="Avg commission" realV={real.comm} asmV={asm.avgComm} money />
            <div style={{ fontSize:11.5, color:'#8C8475', margin:'10px 0', lineHeight:1.5 }}>Numbers in amber are running heavier than your plan — that link is where you’re leaking. Apply your real numbers and {coachName} recalibrates the whole Blueprint to reality.</div>
            <button onClick={applyReal} className="btn btn-ghost btn-sm">Apply my real numbers</button>
          </div>
        );
      })()}
      <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.22em', textTransform:'uppercase', color:'#CBA35C', marginBottom:10 }}>Review an appointment with {coachName}</div>
      <div style={{ marginBottom:22 }}>
        {recReview ? (
          <div style={{ padding:'14px 16px', borderRadius:14, background:'linear-gradient(180deg,#1B1610,#100D09)', border:'1px solid rgba(203,163,92,.4)' }}>
            <div style={{ fontSize:12.5, fontWeight:700, color:'#F6F1E7', marginBottom:4 }}>{recReview.title}</div>
            {recReview.meRatio != null && <div style={{ fontSize:11.5, color: recReview.meRatio > 0.6 ? '#e0965a' : '#8FCA8F', marginBottom:8 }}>You spoke {Math.round(recReview.meRatio * 100)}% of the time{recReview.meRatio > 0.6 ? ' — try to listen more' : ''}</div>}
            <div style={{ fontSize:13.5, color:'#F6F1E7', lineHeight:1.55, whiteSpace:'pre-wrap' }}>{recReview.reply}</div>
            <button onClick={() => { setRecReview(null); setRecPickerOpen(false); }} className="btn btn-ghost btn-sm" style={{ marginTop:10 }}>Done</button>
          </div>
        ) : recBusy ? (
          <div style={{ padding:'14px' }}><PrismThinking label={coachName + ' is listening'} /></div>
        ) : recPickerOpen ? (
          <div style={{ padding:'12px', borderRadius:14, background:'#150F0A', border:'1px solid rgba(203,163,92,.2)' }}>
            {recList.length === 0 ? <div style={{ fontSize:12.5, color:'#8C8475', padding:'6px' }}>No transcribed recordings yet. Record an appointment and it’ll appear here.</div> :
             recList.map(r => <button key={r.id} onClick={() => reviewRecording(r.id)} style={{ display:'block', width:'100%', textAlign:'left', padding:'10px 12px', marginBottom:6, borderRadius:10, background:'transparent', border:'1px solid rgba(203,163,92,.2)', color:'#F6F1E7', fontSize:12.5, cursor:'pointer' }}>{r.title || 'Untitled recording'}<span style={{ display:'block', fontSize:10.5, color:'#8C8475' }}>{new Date(r.recorded_at || r.created_at).toLocaleDateString()}</span></button>)}
          </div>
        ) : (
          <div style={{ padding:'14px 16px', borderRadius:14, background:'#150F0A', border:'1px solid rgba(203,163,92,.2)' }}>
            <div style={{ fontSize:12.5, color:'#C8BFAE', marginBottom:10, lineHeight:1.5 }}>Let {coachName} listen to a real appointment and coach you on it — your talk ratio, whether you found the motivation, the ask, the objections, the next steps. This is how the pros get better.</div>
            <button onClick={openRecPicker} className="btn btn-primary btn-sm">Pick a recording</button>
          </div>
        )}
      </div>
      <div style={{ fontSize:10.5, fontWeight:700, letterSpacing:'.22em', textTransform:'uppercase', color:'#CBA35C', marginBottom:10 }}>Talk to {coachName}</div>
      <div style={{ background:'#150F0A', border:'1px solid rgba(203,163,92,.2)', borderRadius:14, padding:'12px', marginBottom:12 }}>
        {msgs.length === 0 && <div style={{ fontSize:12.5, color:'#8C8475', padding:'8px 4px' }}>Ask {coachName} anything — how you’re pacing, what to do next, a slump, a listing you bombed. He knows your Blueprint and your numbers.</div>}
        {msgs.map((m, i) => (
          <div key={i} style={{ display:'flex', justifyContent: m.role==='agent'?'flex-end':'flex-start', marginBottom:8 }}>
            <div style={{ maxWidth:'85%', padding:'9px 12px', borderRadius:12, fontSize:13, lineHeight:1.5, background: m.role==='agent'?'rgba(203,163,92,.16)':'#1B1610', border:'1px solid rgba(203,163,92,.2)', color: m.role==='agent'?'#EBCB82':'#F6F1E7', whiteSpace:'pre-wrap' }}>{m.content}</div>
          </div>
        ))}
        {thinking && <div style={{ padding:'4px' }}><PrismThinking label={coachName + ' is thinking'} /></div>}
      </div>
      <div style={{ display:'flex', gap:8 }}>
        <input className="form-input" value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') send(); }} placeholder={'Message ' + coachName + '…'} style={{ flex:1 }} />
        <button onClick={send} disabled={thinking || !input.trim()} className="btn btn-primary btn-sm">Send</button>
      </div>
    </div>
  );
}
