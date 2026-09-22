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
  const money0 = (n) => money(n || 0);

  // A goal with nothing behind it is the loudest thing on the card.
  if (a.goal && (a.ytd_gci || 0) === 0) bits.push('Goal of ' + money0(a.goal) + ' with nothing closed this year');
  else if (a.no_goal && a.trailing_12mo > 0) bits.push('No goal set — ' + money0(a.trailing_12mo) + ' over the last 12 months');
  else if (a.no_goal) bits.push('No goal set');
  else if (a.pace_pct != null && a.pace_pct < 95) bits.push(a.pace_pct + '% of the pace their goal needs');

  if ((a.ytd_gci || 0) > 0 && a.days_since_close != null && a.days_since_close > 60) {
    bits.push('nothing closed in ' + a.days_since_close + ' days');
  }
  if (a.same_point_last_year > 0 && a.ytd_gci < a.same_point_last_year * 0.75) {
    bits.push('behind their own pace — ' + money0(a.same_point_last_year) + ' by this date last year');
  }
  if (a.goal_below_trailing) bits.push('goal is under what they already did last year');
  if (!a.has_login) bits.push('never signed in');

  const t = ago(a.last_touch);
  if (t === 'never') bits.push('you have not spoken');
  else if (a.last_touch && (Date.now() - new Date(a.last_touch).getTime()) > 30 * 86400000) bits.push('last spoke ' + t + ' ago');

  // "On track" has to MEAN on track. It used to be the fallback whenever no
  // other sentence fired, so an agent with a $70K goal, $0 closed and 0% of pace
  // read "On track" — the report contradicting itself on the same card, which is
  // the fastest way for a broker to stop believing any of it.
  if (bits.length) return bits.join(' · ');
  if (a.goal && a.pace_pct != null && a.pace_pct >= 95) return 'On track — ' + a.pace_pct + '% of pace';
  if (!a.goal && (a.ytd_gci || 0) > 0) return money0(a.ytd_gci) + ' this year, no goal to measure it against';
  if ((a.ytd_gci || 0) === 0 && (a.trailing_12mo || 0) === 0) return 'No production on record';
  return 'Nothing flagged';
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
  // Commitments that expired with nobody told. The Fiduciary's sharpening: if one
  // ever touched a transaction deadline or a disclosure date, the silence is a
  // gap in the record, not just a product failure. The broker needs the count by
  // agent, and needs it beside the goals rather than on a screen nobody opens.
  const [expired, setExpired] = useState([]);
  // Transactions whose numbers a person has to check against the paperwork.
  const [toCheck, setToCheck] = useState([]);
  // Leads that reached the broker or the office manager, waiting for a producing
  // agent — and how fast each agent actually answers theirs.
  const [routeQ, setRouteQ] = useState([]);
  const [producers, setProducers] = useState([]);
  const [pick, setPick] = useState({});
  const [speed, setSpeed] = useState([]);
  const [routeMsg, setRouteMsg] = useState('');
  const [showCheck, setShowCheck] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('broker_goal_roster');
    if (error) { setErr(error.message); setRows([]); return; }
    if (data && data.error) { setErr(data.error); setRows([]); return; }
    setRows(Array.isArray(data) ? data : []);
    try {
      const { data: ex } = await supabase.rpc('expired_commitments_by_agent');
      setExpired(Array.isArray(ex) ? ex : []);
    } catch (_) { /* the roster still loads */ }
    try {
      const [{ data: lq }, { data: pa }, { data: sp }] = await Promise.all([
        supabase.rpc('brokerage_lead_queue'), supabase.rpc('producing_agents_with_login'), supabase.rpc('speed_to_lead', { p_days: 30 }),
      ]);
      setRouteQ(Array.isArray(lq) ? lq : []);
      setProducers(Array.isArray(pa) ? pa : []);
      setSpeed(Array.isArray(sp) ? sp : []);
    } catch (_) { /* the roster still loads */ }
    try {
      const { data: pr } = await supabase.rpc('txn_data_problems');
      setToCheck(Array.isArray(pr) ? pr : []);
    } catch (_) { /* the roster still loads */ }
  }, []);
  useEffect(() => { load(); }, [load]);

    // RAY'S POINT, AND THE REASON THE WORD IS GONE: "expired" told an agent he had
  // already failed at something whose clock he never saw. Nothing expires now —
  // a promise past its date is WAITING, which is a fact about the promise rather
  // than a verdict on the person.
  const expiredTotal = expired.reduce((n, e) => n + (e.waiting || 0), 0);

  if (err) return <div style={{ padding: 20, color: 'var(--text-3)' }}>{err}</div>;

  const all = rows || [];
  const shown = all.filter(a => {
    if (q.trim() && !String(a.name || '').toLowerCase().includes(q.trim().toLowerCase())) return false;
    if (filter === 'needs') return a.priority >= 60 && !a.departed;
    if (filter === 'nogoal') return a.no_goal && !a.departed;
    if (filter === 'quiet') return !a.departed && (a.no_production || (a.days_since_close != null && a.days_since_close > 60));
    if (filter === 'departed') return a.departed;
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
        {all.filter(a => !a.departed).length} active · {withGoal} with a goal set ·{' '}
        {all.filter(a => a.departed).length} who have left, kept for their history
      </div>
      <hr className="room-rule" />

      {/* SILENT EXPIRY MADE VISIBLE. 255 commitments closed their window with
          nobody told — not the agent, not the broker. A 14% completion rate was
          being recorded and never shown to the one person who could act on it. */}
      {/* NUMBERS TO CHECK. The Skeptic warned that a wrong commission figure
          flows silently into GCI, pace and 1099s. The sheet import had stored 151
          paid dates in the year 2001 and a $43.96 commission on a $350,000 sale,
          and nothing said so. The app cannot know what "$43.96" was meant to be —
          guessing would be making the silent wrong number ourselves — so it
          names each row and the exact place in the spreadsheet to fix it. */}
      {/* LEADS WAITING FOR AN AGENT. A buyer who inquires through a portal has
          usually asked three agents at once and goes with whoever answers
          first. When that inquiry lands on the broker or the office manager it
          used to become a card nobody worked. Now it waits here, with how long
          it has been waiting, until it is handed to someone who sells. */}
      {routeQ.length > 0 && (
        <div style={{ border: '1px solid rgba(201,86,63,.5)', background: 'rgba(201,86,63,.06)',
          borderRadius: 12, padding: '12px 14px', margin: '12px 0 12px' }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 800,
            letterSpacing: '.16em', textTransform: 'uppercase', color: '#E4674F', marginBottom: 6 }}>
            {routeQ.length} lead{routeQ.length === 1 ? '' : 's'} waiting for an agent
          </div>
          {routeMsg && <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginBottom: 6 }}>{routeMsg}</div>}
          {routeQ.map(l => (
            <div key={l.id} style={{ padding: '9px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600 }}>
                {(l.lead_name || 'Unnamed buyer') + (l.property ? ' \u00b7 ' + l.property : '')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
                {l.source + ' \u00b7 to ' + (l.received_by || 'brokerage') + ' \u00b7 waiting ' +
                  (l.minutes_waiting < 90 ? l.minutes_waiting + ' min' : Math.round(l.minutes_waiting / 60) + ' h')}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 7, flexWrap: 'wrap' }}>
                <select value={pick[l.id] || ''} onChange={e => setPick(p => ({ ...p, [l.id]: e.target.value }))}
                  style={{ flex: '1 1 160px', minWidth: 0, minHeight: 44, borderRadius: 10, padding: '0 10px',
                    background: 'var(--bg-input, #1a1510)', color: 'var(--text-1)', border: '1px solid var(--border)' }}>
                  <option value="">Choose an agent…</option>
                  {producers.map(a => <option key={a.user_id} value={a.user_id}>{a.name}</option>)}
                </select>
                <button type="button" disabled={!pick[l.id]}
                  onClick={async () => {
                    const { error } = await supabase.rpc('assign_brokerage_lead', { p_id: l.id, p_agent_user: pick[l.id] });
                    if (error) { setRouteMsg('Could not assign: ' + error.message); return; }
                    const who = (producers.find(a => a.user_id === pick[l.id]) || {}).name || 'the agent';
                    setRouteMsg('Sent to ' + who + ' \u2014 a first reply is drafted and their phone has been told.');
                    setRouteQ(q => q.filter(x => x.id !== l.id));
                  }}
                  style={{ minHeight: 44, padding: '0 16px', borderRadius: 10, border: 'none', fontWeight: 800,
                    background: pick[l.id] ? '#C5A95E' : 'var(--border)', color: '#1a1409', cursor: pick[l.id] ? 'pointer' : 'default' }}>
                  Assign
                </button>
                <button type="button"
                  onClick={async () => {
                    const { error } = await supabase.rpc('dismiss_brokerage_lead', { p_id: l.id });
                    if (error) { setRouteMsg('Could not dismiss: ' + error.message); return; }
                    setRouteQ(q => q.filter(x => x.id !== l.id));
                  }}
                  style={{ minHeight: 44, padding: '0 14px', borderRadius: 10, background: 'transparent',
                    border: '1px solid var(--border)', color: 'var(--text-2)', cursor: 'pointer' }}>
                  Not a lead
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {/* SPEED TO LEAD. The number that predicts whether a lead converts. The
          old measure counted only replies sent from the concierge's own draft,
          and so recorded 20 responses where agents had actually answered 371 by
          email or phone — and then muted the senders it thought were ignored. */}
      {speed.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px', margin: '0 0 12px' }}>
          <div style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 800,
            letterSpacing: '.16em', textTransform: 'uppercase', color: '#C5A95E', marginBottom: 6 }}>
            Speed to lead · last 30 days
          </div>
          {speed.map(r => (
            <div key={r.agent} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '5px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 0', minWidth: 0, fontSize: 13, color: 'var(--text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.agent}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                {r.median_minutes != null ? 'median ' + (r.median_minutes < 120 ? r.median_minutes + ' min' : Math.round(r.median_minutes / 60) + ' h') : 'no replies yet'}
                {' \u00b7 ' + r.within_5_min + ' of ' + r.responses + ' in 5 min'}
                {r.leads > 0 ? ' \u00b7 ' + r.answered + '/' + r.leads + ' portal leads answered' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {toCheck.length > 0 && (
        <div style={{ border: '1px solid rgba(197,169,94,.5)', background: 'rgba(197,169,94,.07)',
          borderRadius: 12, padding: '12px 14px', margin: '12px 0 12px' }}>
          <button type="button" onClick={() => setShowCheck(v => !v)}
            style={{ all: 'unset', cursor: 'pointer', display: 'flex', width: '100%', alignItems: 'center', gap: 8, minHeight: 44 }}>
            <span style={{ fontFamily: "'Barlow Condensed',sans-serif", fontSize: 11, fontWeight: 800,
              letterSpacing: '.16em', textTransform: 'uppercase', color: '#C5A95E', flex: '1 1 0', minWidth: 0 }}>
              {toCheck.length} transaction{toCheck.length === 1 ? '' : 's'} to check in the sheet
            </span>
            <span style={{ color: 'var(--text-3)', fontSize: 12 }}>{showCheck ? 'Hide' : 'Show'}</span>
          </button>
          {showCheck && toCheck.map(t => (
            <div key={t.id} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600 }}>
                {t.agent}{t.address ? ' \u00b7 ' + t.address : ''}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', marginTop: 2 }}>{t.problem}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 2 }}>{t.sheet}</div>
            </div>
          ))}
        </div>
      )}
      {expiredTotal > 0 && (
        <div style={{ border: '1px solid rgba(201,86,63,.45)', background: 'rgba(201,86,63,.07)',
          borderRadius: 12, padding: '12px 14px', margin: '12px 0 16px' }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
            color: '#E4674F', marginBottom: 6 }}>Waiting on a decision</div>
          <div style={{ fontSize: 13, color: 'var(--text-2)', lineHeight: 1.55, marginBottom: 8 }}>
            {expiredTotal} promise{expiredTotal === 1 ? ' is' : 's are'} past the date with nobody
            having decided what to do. Nothing expires or disappears — they wait until
            someone acts.
          </div>
          {expired.slice(0, 6).map(e => (
            <div key={e.user_id} style={{ display: 'flex', justifyContent: 'space-between',
              gap: 10, padding: '5px 0', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12.5, color: 'var(--text-1)', minWidth: 0, overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.agent}</span>
              <span style={{ fontSize: 12.5, color: 'var(--text-3)', flexShrink: 0 }}>
                {e.waiting} waiting &middot; {e.done} done
                {e.kept_pct != null ? ' · ' + e.kept_pct + '% kept' : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 7, margin: '14px 0 10px', flexWrap: 'wrap' }}>
        {[['needs', 'Needs a call'], ['nogoal', 'No goal'], ['quiet', 'Gone quiet'], ['departed', 'Left'], ['all', 'Everyone']].map(([k, l]) => (
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
        // A departed agent keeps their history but stops competing for attention:
        // muted, no gold, and never a call-to-action. Deleting them made the
        // report disagree with the brokerage total and erased the work they did.
        <div key={a.agent_id} style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '12px 13px',
          marginBottom: 9, opacity: a.departed ? 0.62 : 1,
          background: a.departed ? 'rgba(246,241,231,.02)' : 'transparent' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <button type="button" onClick={() => { try { a.contact_id && window.__openContact && window.__openContact(a.contact_id); } catch (_) {} }}
              style={{ flex: '1 1 auto', minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0,
                color: 'var(--text-1)', fontSize: 15, fontWeight: 700, cursor: a.contact_id ? 'pointer' : 'default',
                textDecorationLine: a.contact_id ? 'underline' : 'none', textDecorationStyle: 'dotted', textUnderlineOffset: 3 }}>
              {a.name}
            </button>
            {a.departed && (
              <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
                color: 'var(--text-3)', border: '1px solid var(--border)', borderRadius: 100, padding: '1px 7px' }}>
                Left
              </span>
            )}
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
            {a.phone && !a.departed && (
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
