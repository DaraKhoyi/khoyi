import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';

// One-Tap Implement — Release 1 (read-only).
//
// The panel's open findings as cards: why, impact, effort, risk, who would do
// the work, who backed it, and the status rail. The Implement switch is shown
// but cannot be flipped yet — nothing on this screen writes anything. Reads go
// through panel_findings RLS (is_brokerage_staff), so agents see nothing.
// Plan: one-tap/plan.md. Risk + routing below are display-only heuristics; the
// server-side, diff-based classification arrives with the queue (R2/R3).

const G = '#C5A95E', CREAM = '#F4EEDF';
const SERIF = "'Playfair Display', Georgia, serif";
const RAIL = ['Queued', 'Assigned', 'Building', 'Your OK', 'Shipped', 'Verified'];

const HIGH = /\b(rls|polic|oauth|token|secret|vault|auth|drop|delete|migration|schema|commission|billing|payment|money|send|sms|email blast|permission)/i;
const MED = /\b(edge function|cron|function|table|rows|index|nightly|worker|spend|\$)/i;
export function riskOf(f) {
  const t = (f.title || '') + ' ' + (f.why_it_matters || '');
  if (HIGH.test(t) || /sentinel|fiduciary/i.test(f.agent || '')) return 'high';
  if (MED.test(t) || (f.effort && f.effort !== 'small')) return 'medium';
  return 'low';
}
const ROUTES = [
  [/sentinel/i, 'Security', ['The Sentinel', 'The Fiduciary']],
  [/fiduciary/i, 'Client trust', ['The Fiduciary', 'The Sentinel']],
  [/accountant/i, 'Cost', ['The Accountant']],
  [/\bray\b|marguerite|newcomer/i, 'Agent UX', ['Ray', 'Marguerite']],
  [/merchant|archivist/i, 'Sales & reporting', ['The Merchant', 'The Archivist']],
  [/architect|simplifier|skeptic|curator/i, 'Build', ['The Architect', 'The Simplifier']],
];
export function routeOf(f) {
  const a = f.agent || '';
  const cats = [], rev = new Set();
  ROUTES.forEach(([re, c, r]) => { if (re.test(a)) { cats.push(c); r.forEach(x => rev.add(x)); } });
  return { lead: 'Prism', cats: cats.length ? cats : ['Build'], reviewers: rev.size ? [...rev] : ['The Architect'] };
}
const backers = f => String(f.agent || '').split(/\s*\+\s*/).filter(Boolean);
const RISK = { low: ['#1f3324', '#9fd8a8', 'Low risk'], medium: ['#3a3013', '#ecc96a', 'Medium risk'], high: ['#3d1d17', '#f0907b', 'High risk'] };
const lab = { fontSize: 9.5, letterSpacing: '.18em', color: G, fontWeight: 700, textTransform: 'uppercase', margin: '12px 0 5px', fontFamily: 'Montserrat, sans-serif' };
const chip = { display: 'inline-block', border: '1px solid #4a3f28', borderRadius: 20, padding: '3px 9px', fontSize: 11.5, margin: '0 4px 4px 0', color: CREAM };

function Card({ f }) {
  const risk = riskOf(f), r = routeOf(f), [bg, fg, rl] = RISK[risk];
  const stat = (big, small) => (
    <div style={{ flex: 1, borderTop: '1px solid #3a3222', paddingTop: 6, minWidth: 0 }}>
      <b style={{ display: 'block', fontFamily: SERIF, fontWeight: 600, fontSize: 30, color: G, lineHeight: 1 }}>{big}</b>
      <span style={{ fontSize: 8.5, letterSpacing: '.16em', textTransform: 'uppercase', color: '#aaa', fontWeight: 600 }}>{small}</span>
    </div>);
  const dis = { flex: 1, textAlign: 'center', border: '1px solid #333', borderRadius: 10, padding: '13px 0', fontSize: 11,
    letterSpacing: '.14em', fontWeight: 700, textTransform: 'uppercase', color: '#666', background: 'none', cursor: 'not-allowed' };
  return (
    <div data-testid="onetap-card" style={{ background: '#141210', border: '1px solid #3a3222', borderRadius: 14, padding: 16, marginBottom: 12, fontFamily: 'Montserrat, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 9.5, letterSpacing: '.16em', fontWeight: 700, textTransform: 'uppercase' }}>
        <span style={{ color: G }}>Ready · {r.cats.join(' + ')}</span>
        <span style={{ background: bg, color: fg, padding: '2px 8px', borderRadius: 20, fontSize: 9 }}>{rl}</span>
      </div>
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 19, lineHeight: 1.22, margin: '10px 0 8px', color: CREAM }}>{f.title}</div>
      {f.why_it_matters && <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 14, lineHeight: 1.45, color: '#ddd', display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f.why_it_matters}</div>}
      <div style={{ display: 'flex', gap: 10, margin: '12px 0 4px' }}>
        {stat((f.effort || '?').charAt(0).toUpperCase(), 'Effort')}
        {stat(backers(f).length, 'Backers')}
        {stat(f.times_raised || 1, 'Times raised')}
      </div>
      <div style={lab}>Impact</div>
      <div style={{ fontSize: 12.5, color: '#ddd', lineHeight: 1.5 }}>{r.cats.join(', ')} · confidence {f.confidence || 'unrated'}</div>
      <div style={lab}>Panel</div>
      <div>{backers(f).map(b => <span key={b} style={chip}>✓ {b}</span>)}<span style={{ ...chip, color: '#888', borderColor: '#333' }}>No dissent recorded</span></div>
      <div style={lab}>Routing</div>
      <div style={{ fontSize: 12.5, color: '#ddd', lineHeight: 1.5 }}><b style={{ color: CREAM }}>{r.lead}</b> builds · {r.reviewers.join(' + ')} review</div>
      <div style={{ display: 'flex', gap: 3, margin: '12px 0 4px' }}>{RAIL.map(s => <i key={s} style={{ flex: 1, height: 5, borderRadius: 3, background: '#2a251b' }} />)}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7.5, letterSpacing: '.06em', color: '#777', textTransform: 'uppercase' }}>{RAIL.map(s => <span key={s}>{s}</span>)}</div>
      <label title="Coming in the next release" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid ' + G, borderRadius: 40, padding: '10px 12px 10px 20px', marginTop: 14, minHeight: 60, opacity: .6, cursor: 'not-allowed' }}>
        <span style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 20, color: G }}>Implement</span>
        <input type="checkbox" role="switch" aria-label={'Implement: ' + f.title} checked={false} disabled readOnly style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }} />
        <span aria-hidden style={{ width: 76, height: 40, borderRadius: 20, background: '#2a251b', position: 'relative' }}>
          <span style={{ position: 'absolute', left: 4, top: 4, width: 32, height: 32, borderRadius: '50%', background: '#777' }} />
        </span>
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        {['Skip', 'Snooze', 'Edit'].map(x => <button key={x} type="button" disabled style={dis}>{x}</button>)}
      </div>
    </div>);
}

export default function OneTapCards() {
  const [rows, setRows] = useState(null);
  useEffect(() => {
    let on = true;
    supabase.from('panel_findings')
      .select('id,agent,title,why_it_matters,effort,confidence,status,times_raised,last_seen')
      .eq('status', 'new').order('last_seen', { ascending: false }).limit(10)
      .then(({ data, error }) => { if (on) setRows(error ? [] : (data || [])); });
    return () => { on = false; };
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <section data-testid="onetap" style={{ margin: '16px 0' }}>
      <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 28, lineHeight: 1, color: CREAM }}>One-Tap <i style={{ fontWeight: 400, color: G }}>Implement</i></div>
      <div style={{ fontSize: 10, letterSpacing: '.18em', color: '#aaa', textTransform: 'uppercase', fontWeight: 600, margin: '6px 0 12px' }}>
        {rows.length} recommendations · preview, switches arrive next release
      </div>
      {rows.map(f => <Card key={f.id} f={f} />)}
    </section>);
}
