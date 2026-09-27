import React from 'react';

// Can this person buy, and when? One line of chips on a lead card, written by
// lead-qualify (supabase/functions/lead-qualify). Marguerite, on the panel:
// "If the system cannot tell me that this person has a pre-approval letter and a
// timeline, I am wasting my time on the phone." Every fact here came from the
// lead's own words or the portal's template — nothing is guessed — and a fact
// nobody has stated yet is shown as unknown, with the one question that finds it.

const GRADE = {
  ready:   { label: 'Ready to buy',   color: '#7BC47F', bg: 'rgba(123,196,127,.14)' },
  active:  { label: 'Active',         color: '#EBCB82', bg: 'rgba(235,203,130,.14)' },
  early:   { label: 'Early',          color: 'var(--text-3)', bg: 'rgba(255,255,255,.05)' },
  unknown: { label: 'Not yet known',  color: 'var(--text-3)', bg: 'rgba(255,255,255,.05)' },
};
const PRE = { yes: 'Pre-approved', cash: 'Paying cash', in_progress: 'Talking to a lender', no: 'Not pre-approved' };
const TL = { now: 'Within a month', '1-3m': '1–3 months', '3-6m': '3–6 months', '6-12m': '6–12 months', '12m+': 'A year or more' };

function Chip({ children, color = 'var(--text-2)', bg = 'rgba(255,255,255,.05)', title }) {
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999,
      fontSize: 11.5, fontWeight: 700, color, background: bg, border: '1px solid var(--border)', lineHeight: 1.3 }}>
      {children}
    </span>
  );
}

export default function LeadReadiness({ r, compact = false }) {
  if (!r) return null;
  const g = GRADE[r.grade] || GRADE.unknown;
  const f = r.facts || {};
  const say = (x) => (x && x.quote ? '“' + x.quote + '”' : undefined);
  const buy = r.intent !== 'rent' && r.intent !== 'sell';
  const pre = f.preapproval && f.preapproval.value;
  return (
    <div style={{ margin: '8px 0 4px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <Chip color={g.color} bg={g.bg}>{g.label}</Chip>
        {buy ? (
          <Chip title={say(f.preapproval)} color={pre === 'yes' || pre === 'cash' ? '#7BC47F' : pre === 'no' ? '#E4674F' : 'var(--text-3)'}>
            {PRE[pre] || 'Pre-approval unknown'}
          </Chip>
        ) : null}
        {f.timeline && f.timeline.value ? <Chip title={say(f.timeline)}>{TL[f.timeline.value] || f.timeline.value}</Chip>
          : r.intent === 'rent' && f.move_in && f.move_in.value ? <Chip title={say(f.move_in)}>{'Move-in ' + f.move_in.value}</Chip>
          : <Chip color="var(--text-3)">{r.intent === 'rent' ? 'Move-in date unknown' : 'Timeline unknown'}</Chip>}
        {f.must_sell_first && f.must_sell_first.value === true ? <Chip title={say(f.must_sell_first)}>Must sell first</Chip> : null}
        {f.has_agent && f.has_agent.value === true ? <Chip title={say(f.has_agent)} color="#E4674F">Has an agent</Chip> : null}
      </div>
      {!compact && Array.isArray(r.signals) && r.signals.length ? (
        <div style={{ fontSize: 12, color: 'var(--text-2)', marginTop: 6 }}>{r.signals.join(' · ')}</div>
      ) : null}
      {r.ask_next ? (
        <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
          <span style={{ fontWeight: 700, color: 'var(--text-2)' }}>Ask: </span>{r.ask_next}
        </div>
      ) : null}
    </div>
  );
}
