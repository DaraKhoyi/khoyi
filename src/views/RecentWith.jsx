import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { calm } from '../calm';

// WHAT THEY SAID — the recent back-and-forth with one person, in place (1 Oct).
//
// Dara, circling "Reply to Javier Suarez" and "Reply to Scott Kellogg" on Today:
// "Give me the ability to select a contact to see what's going on with their
// recent communications to me." A row that says someone is waiting on you is
// only half an answer; the other half is WHAT they said, so you can decide
// "reply", "no reply needed" or "not today" without leaving the screen.
//
// Texts (Quo, including group texts), emails both ways, and call summaries,
// newest first, each with who, how and a calendar date — never "3 days ago"
// (house rule, Ray). Read straight from the person's own rows; RLS keeps it
// theirs. No AI here: these are their words, not a summary of them.

const DAYMS = 864e5;
const when = (iso) => {
  const d = new Date(iso); const today = new Date();
  const ny = (x) => x.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const t = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  if (ny(d) === ny(today)) return 'Today ' + t;
  if (ny(d) === ny(new Date(Date.now() - DAYMS))) return 'Yesterday ' + t;
  return d.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};
const p10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
// The reply part of an email, not the quoted history below it.
const ownPart = (s) => String(s || '').split(/\n\s*(On .{6,90}wrote:|-{2,}\s*Original Message|From: .+\n)/i)[0]
  .replace(/\n{3,}/g, '\n\n').trim();

export default function RecentWith({ contactId, name, setView, limit = 6 }) {
  const [items, setItems] = useState(null);
  const [openIdx, setOpenIdx] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: c } = await supabase.from('contacts').select('id, user_id, email, emails, phone, phones').eq('id', contactId).maybeSingle();
      if (!c) { if (alive) setItems([]); return; }
      const emails = [c.email, ...((Array.isArray(c.emails) ? c.emails : []).map(e => (e && (e.value || e.email)) || e))]
        .filter(e => typeof e === 'string' && e.includes('@')).map(e => e.toLowerCase().trim());
      const phones = [...new Set([c.phone, ...((Array.isArray(c.phones) ? c.phones : []).map(p => (p && (p.value || p.number)) || p))]
        .map(p10).filter(p => p.length === 10))];
      const since = new Date(Date.now() - 120 * DAYMS).toISOString();
      const out = [];
      const jobs = [];
      if (phones.length) {
        const ors = phones.flatMap(p => [`from_number.eq.+1${p}`, `to_number.ilike.*${p}*`]).join(',');
        jobs.push(supabase.from('quo_messages').select('op_created_at, body, from_number, to_number, direction')
          .or(ors).gte('op_created_at', since).order('op_created_at', { ascending: false }).limit(limit + 4)
          .then(({ data }) => (data || []).forEach(m => {
            if (!m.body) return;
            const fromThem = m.direction === 'incoming' && phones.includes(p10(m.from_number));
            const group = String(m.to_number || '').includes(',');
            out.push({ at: m.op_created_at, who: fromThem ? 'them' : (m.direction === 'incoming' ? 'other' : 'you'), via: group ? 'group text' : 'text', text: m.body });
          })));
      }
      if (emails.length) {
        jobs.push(supabase.from('email_messages').select('internal_date, subject, snippet, body_text, direction')
          .eq('direction', 'inbound').in('from_address', emails).gte('internal_date', since)
          .order('internal_date', { ascending: false }).limit(limit)
          .then(({ data }) => (data || []).forEach(m => out.push({ at: m.internal_date, who: 'them', via: 'email', subject: m.subject, text: ownPart(m.body_text) || m.snippet || '' }))));
        for (const e of emails.slice(0, 2)) {
          jobs.push(supabase.from('email_messages').select('internal_date, subject, snippet, body_text')
            .eq('direction', 'outbound').filter('to_addresses', 'cs', JSON.stringify([{ email: e }])).gte('internal_date', since)
            .order('internal_date', { ascending: false }).limit(3)
            .then(({ data }) => (data || []).forEach(m => out.push({ at: m.internal_date, who: 'you', via: 'email', subject: m.subject, text: ownPart(m.body_text) || m.snippet || '' }))));
        }
      }
      jobs.push(supabase.from('quo_calls').select('op_created_at, created_at, summary, direction').eq('contact_id', c.id)
        .not('summary', 'is', null).order('op_created_at', { ascending: false }).limit(2)
        .then(({ data }) => (data || []).forEach(k => out.push({ at: k.op_created_at || k.created_at, who: 'call', via: 'call', text: k.summary }))));
      await Promise.all(jobs.map(j => Promise.resolve(j).catch(() => {})));
      const seen = new Set();
      const list = out.filter(x => x.at && x.text).sort((a, b) => new Date(b.at) - new Date(a.at))
        .filter(x => { const k = x.via + x.at + x.text.slice(0, 40); if (seen.has(k)) return false; seen.add(k); return true; })
        .slice(0, limit);
      if (alive) setItems(list);
    })();
    return () => { alive = false; };
  }, [contactId, limit]);

  const first = (name || 'They').split(' ')[0];
  if (items === null) return <div style={{ ...calm.rowWhy, padding: '8px 0' }}>Reading what {first} said…</div>;

  return (
    <div data-testid="recent-with" style={{ margin: '10px 0 2px', paddingLeft: 12, borderLeft: '2px solid rgba(197,169,94,0.35)' }}>
      {items.length === 0 && <div style={calm.rowWhy}>Nothing from {first} in PrismOS in the last four months — it may have been a call or a message on another phone.</div>}
      {items.map((it, i) => {
        const long = it.text.length > 220;
        const open = openIdx === i;
        const label = it.who === 'them' ? first : it.who === 'you' ? 'You' : it.who === 'call' ? 'Call' : 'Someone else';
        return (
          <div key={i} style={{ padding: '8px 0', borderTop: i ? calm.HAIR : 'none' }}>
            <div style={{ fontSize: 12.5, color: it.who === 'them' ? '#C5A95E' : 'var(--text-3)', fontWeight: 600 }}>
              {label} · {it.via} · {when(it.at)}
            </div>
            {it.subject && <div style={{ fontSize: 13.5, color: 'var(--text-1)', fontWeight: 600, marginTop: 2 }}>{it.subject}</div>}
            <div style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.5, marginTop: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {long && !open ? it.text.slice(0, 220).trim() + '…' : it.text}
            </div>
            {long && <button type="button" onClick={() => setOpenIdx(open ? null : i)} style={{ ...calm.link, minHeight: 32, fontSize: 13 }}>{open ? 'Less' : 'Read all'}</button>}
          </div>
        );
      })}
      <button type="button" onClick={() => { try { window.__pendingOpenContact = contactId; } catch (_) {} setView && setView('contacts'); }}
        style={{ ...calm.link, minHeight: 40, fontSize: 13.5 }}>Open {first}’s record ›</button>
    </div>
  );
}
