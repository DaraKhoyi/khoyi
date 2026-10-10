// StartupSetup — the launch check Dara asked for on 10 Oct 2026.
// 1. No annual GCI goal -> a one-field goal prompt (Skip for now = rest of today).
// 2. Google mail, calendar or contacts not connected, or the connection was
//    revoked -> straight to Reconnect Google, asking for all three.
//    (Later = this launch only; it comes back next time the app opens.)
// Never shown during act-as / support. Decisions live in lib/startupSetup.js.
import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { todayNY } from '../clock';
import { nextStep, googleStatus, connectPurposes, skipGoalToday, dismissGoogle, parseGoal, isActingAs } from '../lib/startupSetup';

const GOLD = '#C5A95E';
const LABEL = { email: 'mail', calendar: 'calendar', contacts: 'contacts' };
const join = (l) => (l.length <= 1 ? l.join('') : l.slice(0, -1).join(', ') + ' and ' + l[l.length - 1]);

export default function StartupSetup({ userId, preview = null }) {
  const [facts, setFacts] = useState(preview);
  const [step, setStep] = useState(null);
  const [goal, setGoal] = useState('');
  const [suggested, setSuggested] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (preview || !userId || isActingAs()) return;
    let off = false;
    (async () => {
      const { data, error } = await supabase.rpc('my_startup_setup');
      if (!off && !error && data) setFacts(data);
    })();
    return () => { off = true; };
  }, [userId, preview]);

  useEffect(() => {
    if (!facts) return;
    setStep(nextStep({ facts, uid: userId, today: todayNY() }));
  }, [facts, userId]);

  useEffect(() => {
    if (step !== 'goal' || preview) return;
    supabase.rpc('my_trailing_gci').then(({ data }) => {
      const n = Number(data || 0);
      if (n > 0) setSuggested(Math.ceil(n / 10000) * 10000);
    }, () => {});
  }, [step, preview]);

  if (!step || !facts) return null;
  const g = googleStatus(facts.google);
  const advance = (patch) => { const f = { ...facts, ...patch }; setFacts(f); setErr(''); };

  async function saveGoal() {
    const n = parseGoal(goal);
    if (!n) { setErr('Enter your goal for the year, e.g. 250,000.'); return; }
    setBusy(true); setErr('');
    const a = await supabase.from('finance_settings').upsert({ user_id: userId, annual_gci_goal: n }, { onConflict: 'user_id' });
    let b = { error: null };
    if (facts.has_agent) b = await supabase.rpc('set_my_gci_goal', { p_goal: n });
    setBusy(false);
    if (a.error && (!facts.has_agent || b.error)) { setErr('Could not save your goal. Please try again.'); return; }
    if (window.__notify) window.__notify('GCI goal set to $' + n.toLocaleString(), 'success');
    advance({ has_goal: true });
  }
  function skipGoal() { skipGoalToday(userId, todayNY()); setStep(nextStep({ facts, uid: userId, today: todayNY() })); }

  async function connect() {
    setBusy(true); setErr('');
    try {
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { return_to: window.location.origin + window.location.pathname, purpose: 'full', purposes: connectPurposes(facts.google), login_hint: g.hint || '' },
      });
      if (error) throw error;
      if (!data?.url) throw new Error(data?.error || 'No sign-in link came back.');
      window.location.href = data.url;
    } catch (e) { setBusy(false); setErr('Could not open Google: ' + (e.message || String(e))); }
  }
  function openSettings() {
    dismissGoogle(userId); setStep(null);
    try { if (window.__openSettings) window.__openSettings('setup'); } catch (_) {}
    setTimeout(() => { try { document.getElementById('settings-google-accounts')?.scrollIntoView({ behavior: 'smooth' }); } catch (_) {} }, 400);
  }
  function later() { dismissGoogle(userId); setStep(null); }

  const btn = (primary) => ({
    width: '100%', minHeight: 48, padding: '13px 16px', borderRadius: 12, fontSize: 16, fontWeight: 800, cursor: 'pointer',
    border: primary ? 'none' : '1px solid rgba(197,169,94,.35)', background: primary ? GOLD : 'transparent', color: primary ? '#14100a' : '#E8E1D0',
  });

  let body;
  if (step === 'goal') {
    body = (<>
      <div style={eyebrow}>Your {facts.year || new Date().getFullYear()} goal</div>
      <h2 style={h2}>What do you want to earn this year?</h2>
      <p style={p}>Your annual GCI goal powers Today's progress bar and your daily Top 3. It stays private to you.</p>
      <label htmlFor="ss-goal" style={{ fontSize: 13, color: '#A89F8C' }}>Annual GCI goal</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0 4px', background: '#0c0b09', border: '1px solid rgba(197,169,94,.45)', borderRadius: 12, padding: '0 14px' }}>
        <span style={{ color: GOLD, fontSize: 22, fontWeight: 700 }}>$</span>
        <input id="ss-goal" inputMode="numeric" autoComplete="off" placeholder={suggested ? suggested.toLocaleString() : '250,000'}
          value={goal} onChange={(e) => { const d = e.target.value.replace(/[^0-9]/g, ''); setGoal(d ? Number(d).toLocaleString() : ''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') saveGoal(); }}
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: '#F4EEDF', fontSize: 24, fontWeight: 700, padding: '14px 0', fontVariantNumeric: 'tabular-nums' }} />
      </div>
      {suggested > 0 && !goal && (
        <button type="button" onClick={() => setGoal(suggested.toLocaleString())} style={{ background: 'none', border: 'none', color: GOLD, fontSize: 14, padding: '8px 0', cursor: 'pointer', textAlign: 'left' }}>
          Use ${suggested.toLocaleString()} (your last 12 months, rounded up)
        </button>
      )}
      {err && <div style={errS}>{err}</div>}
      <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
        <button type="button" style={btn(true)} disabled={busy} onClick={saveGoal}>{busy ? 'Saving…' : 'Save my goal'}</button>
        <button type="button" style={btn(false)} disabled={busy} onClick={skipGoal}>Skip for today</button>
      </div>
    </>);
  } else {
    const what = g.status === 'none' ? 'Connect your Google account'
      : g.status === 'revoked' ? 'Google disconnected PrismOS' : `Google isn't sharing your ${join(g.missing.map((m) => LABEL[m]))}`;
    const why = g.status === 'none'
      ? 'PrismOS runs on your mail, calendar and contacts: your inbox, reply drafts, appointments and who to call. One tap connects all three.'
      : g.status === 'revoked'
        ? `${g.hint || 'Your account'} needs to sign in again before mail, calendar and contacts can sync. Tick every box on Google's screen.`
        : `${join(g.missing.map((m) => LABEL[m])).replace(/^./, (c) => c.toUpperCase())} won't sync until you reconnect. On Google's screen, tick every box.`;
    body = (<>
      <div style={eyebrow}>Connected accounts</div>
      <h2 style={h2}>{what}</h2>
      <p style={p}>{why}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 14px' }}>
        {['email', 'calendar', 'contacts'].map((k) => {
          const ok = g.status !== 'none' && g.status !== 'revoked' && !g.missing.includes(k);
          return <span key={k} style={{ fontSize: 13, fontWeight: 700, padding: '6px 11px', borderRadius: 999, border: `1px solid ${ok ? 'rgba(143,184,168,.6)' : 'rgba(197,169,94,.6)'}`, color: ok ? '#8FB8A8' : GOLD }}>{ok ? '✓' : '○'} {LABEL[k]}</span>;
        })}
      </div>
      <p style={{ ...p, fontSize: 13 }}>Your mail and clients stay private to you. The brokerage sees counts only.</p>
      {err && <div style={errS}>{err}</div>}
      <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
        <button type="button" style={btn(true)} disabled={busy} onClick={connect}>{busy ? 'Opening Google…' : g.status === 'none' ? 'Connect Google' : 'Reconnect Google'}</button>
        <button type="button" style={btn(false)} disabled={busy} onClick={openSettings}>Open Connected Google Accounts</button>
        <button type="button" disabled={busy} onClick={later} style={{ background: 'none', border: 'none', color: '#A89F8C', fontSize: 15, padding: 10, cursor: 'pointer' }}>Later</button>
      </div>
    </>);
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Finish setting up" data-testid="startup-setup"
      style={{ position: 'fixed', inset: 0, zIndex: 9600, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 480, maxHeight: '92vh', overflowY: 'auto', background: 'linear-gradient(180deg,#17140f,#0d0c0a)', borderTop: `2px solid ${GOLD}`, borderRadius: '22px 22px 0 0', padding: '22px 20px calc(22px + env(safe-area-inset-bottom))', boxSizing: 'border-box', color: '#F4EEDF' }}>
        <div style={{ width: 44, height: 4, borderRadius: 2, background: 'rgba(197,169,94,.5)', margin: '0 auto 16px' }} />
        {body}
      </div>
    </div>
  );
}

const eyebrow = { fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: GOLD, fontWeight: 700, marginBottom: 6 };
const h2 = { fontFamily: 'Fraunces, Georgia, serif', fontSize: 25, lineHeight: 1.2, margin: '0 0 10px', color: '#F4EEDF', fontWeight: 600 };
const p = { fontSize: 15, lineHeight: 1.5, color: '#CFC6B2', margin: '0 0 14px' };
const errS = { color: '#E8A08A', fontSize: 14, margin: '8px 0 0' };
