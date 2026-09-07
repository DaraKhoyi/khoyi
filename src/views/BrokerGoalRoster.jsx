import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../dataService';

// Who to call, and what to say when they answer.
//
// The brief asked for three numbers per agent: their goal, this year against a
// pro-rated pace, and the last twelve months. Those are here. What makes it a
// list you can work rather than a table you read is the ORDER and the sentence.
//
// Sorted by who needs the call, not by who is furthest behind. An agent 40%
// behind and climbing needs less from you than one 12% behind who has gone
// quiet. The weighting lives in broker_goal_roster(): no goal at all outranks a
// bad number, because an agent with no goal is invisible to every other part of
// this system; then producers who have stopped; then slippage against their own
// pace and against the same point last year.
//
// THE PROJECTION IS STRAIGHT-LINE AND THE SCREEN SAYS SO. The GOLD report holds
// closed and paid business only — there are no pendings anywhere in this
// database. An agent with three deals about to close reads as behind. That is a
// gap in the data, not a judgement about the agent, and a broker ringing someone
// on the strength of a number that ignores their pipeline would burn the trust
// this report exists to build.

const money = (n) => n == null ? '—'
  : n >= 1000000 ? '$' + (n / 1000000).toFixed(2) + 'M'
  : n >= 1000 ? '$' + Math.round(n / 1000) + 'K'
  : '$' + Math.round(n);

const ago = (ts) => {
  if (!ts) return 'never';
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
  return d < 1 ? 'today' : d < 30 ? d + 'd' : d < 365 ? Math.round(d / 30) + 'mo' : (d / 365).toFixed(1) + 'y';
};

// The sentence under each name. This is the part that decides whether the report
// gets used: a number tells you something is wrong, a sentence tells you what to
// open the call with.
function why(a) {
  const bits = [];
  if (a.no_goal && a.trailing_12mo > 0) bits.push('No goal set — ' + money(a.trailing_12mo) + ' over the last 12 months');
  else if (a.no_goal) bits.push('No goal set');
  if (a.no_production && a.trailing_12mo > 0) bits.push('nothing closed this year');
  else if (a.days_since_close != null && a.days_since_close > 60) bits.push('nothing closed in ' + a.days_since_close + ' days');
  if (a.same_point_last_year > 0 && a.ytd_gci < a.same_point_last_year * 0.75) {
    bits.push('behind their own pace — ' + money(a.same_point_last_year) + ' by this date last year');
  }
  if (a.goal_below_trailing) bits.push('goal is under what they already did last year');
  if (!a.has_login) bits.push('never signed in');
  const t = ago(a.last_touch);
  if (t === 'never') bits.push('you have not spoken');
  else if (a.last_touch && (Date.now() - new Date(a.last_touch).getTime()) > 30 * 86400000) bits.push('last spoke ' + t + ' ago');
  return bits.length ? bits.join(' · ') : 'On track';
}

function Num({ label, value, tone }) {
  return (
    <div style={{ flex: '1 1 0', minWidth: 0 }}>
      <div style={{ fontSize: 9.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>{label}</div>
      <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 17, color: tone || 'var(--text-1)', lineHeight: 1.25 }}>{value}</div>
    </div>
  );
}

export default function BrokerGoalRoster() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('needs');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('broker_goal_roster');
    if (error) { setErr(error.message); setRows([]); return; }
    if (data && data.error) { setErr(data.error); setRows([]); return; }
    setRows(Array.isArray(data) ? data : []);
  }, []);
  useEffect(() => { load(); }, [load]);

  if (err) return <div style={{ padding: 20, color: 'var(--text-3)' }}>{err}</div>;

  const all = rows || [];
  const shown = all.filter(a => {
    if (q.trim() && !String(a.name || '').toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === 'needs') return a.priority >= 60;
    if (filter === 'nogoal') return a.no_goal;
    if (filter === 'quiet') return a.no_production || (a.days_since_close != null && a.days_since_close > 60);
    return true;
  });

  const withGoal = all.filter(a => a.goal).length;

  return (
    <div style={{ padding: '2px 2px 20px' }}>
      <div className="room-eyebrow" style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase',
        letterSpacing: '.14em', fontSize: 11, fontWeight: 700 }}>Roster</div>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 30, margin: '4px 0 6px', display: 'flex', minWidth: 0 }}>
        <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>Who needs a call.</span>
      </h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
        {all.length} active · {withGoal} with a goal set · ordered by who needs you most
      </div>
      <hr className="room-rule" />

      <div style={{ display: 'flex', gap: 7, margin: '14px 0 10px', flexWrap: 'wrap' }}>
        {[['needs', 'Needs a call'], ['nogoal', 'No goal'], ['quiet', 'Gone quiet'], ['all', 'Everyone']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setFilter(k)}
            style={{ padding: '6px 12px', borderRadius: 100, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              border: '1px solid ' + (filter === k ? 'var(--room-accent, var(--accent))' : 'var(--border)'),
              background: filter === k ? 'var(--room-accent-16, rgba(203,163,92,.16))' : 'transparent',
              color: filter === k ? 'var(--room-accent, var(--accent))' : 'var(--text-2)' }}>
            {l}
          </button>
        ))}
      </div>
      <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search a name"
        style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border)',
          borderRadius: 9, padding: '9px 11px', color: 'var(--text-1)', fontSize: 13.5, marginBottom: 12 }} />

      {/* Said once, at the top, rather than hedged on every row. */}
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.5, marginBottom: 14,
        borderLeft: '2px solid var(--room-accent-30, rgba(203,163,92,.3))', paddingLeft: 10 }}>
        Projections are straight-line from closed business. PrismOS has no pending
        sales, so an agent about to close will look behind. Treat it as a prompt to
        ask, not as a verdict.
      </div>

      {rows === null ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Reading the roster…</div>
      ) : !shown.length ? (
        <div style={{ fontSize: 13, color: 'var(--text-3)' }}>Nobody in this group.</div>
      ) : shown.map(a => (
        <div key={a.agent_id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 13px', marginBottom: 9 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <button type="button" onClick={() => { try { a.contact_id && window.__openContact && window.__openContact(a.contact_id); } catch (_) {} }}
              style={{ flex: '1 1 auto', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0,
                color: 'var(--text-1)', fontSize: 15, fontWeight: 700, cursor: a.contact_id ? 'pointer' : 'default',
                textDecorationLine: a.contact_id ? 'underline' : 'none', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
              {a.name}
            </button>
            {a.pace_pct != null && (
              <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 100,
                color: a.pace_pct >= 95 ? '#86efac' : a.pace_pct >= 75 ? '#EBCB82' : '#E4674F',
                background: a.pace_pct >= 95 ? 'rgba(34,197,94,.14)' : a.pace_pct >= 75 ? 'rgba(235,203,130,.14)' : 'rgba(201,86,63,.16)' }}>
                {a.pace_pct}% of pace
              </span>
            )}
          </div>

          <div style={{ fontSize: 12, color: 'var(--text-3)', margin: '5px 0 9px', lineHeight: 1.45 }}>{why(a)}</div>

          <div style={{ display: 'flex', gap: 10 }}>
            <Num label="Goal" value={a.goal ? money(a.goal) : 'not set'} tone={a.goal ? undefined : '#E4674F'} />
            <Num label="This year" value={money(a.ytd_gci)} />
            <Num label="Projected" value={money(a.projected)} />
            <Num label="Last 12mo" value={money(a.trailing_12mo)} />
          </div>

          {a.goal && a.gap != null && a.gap > 0 && (
            <div style={{ fontSize: 12, color: '#E4674F', marginTop: 8, fontWeight: 700 }}>
              {money(a.gap) + ' short of goal at this rate'}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {a.phone && (
              <a href={'tel:' + a.phone} style={{ textDecoration: 'none', fontSize: 12, fontWeight: 800, padding: '7px 14px',
                borderRadius: 9, background: '#EBCB82', color: '#1a1205' }}>Call</a>
            )}
            {a.contact_id && (
              <button type="button" onClick={() => { try { window.__openContact && window.__openContact(a.contact_id); } catch (_) {} }}
                style={{ fontSize: 12, fontWeight: 700, padding: '7px 12px', borderRadius: 9, cursor: 'pointer',
                  background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-2)' }}>
                Open record
              </button>
            )}
            <span style={{ fontSize: 11, color: 'var(--text-3)', alignSelf: 'center' }}>
              {'last spoke ' + ago(a.last_touch)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
