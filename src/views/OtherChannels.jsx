// OtherChannels — "you also texted them on Wednesday".
//
// FINDING #29, the cheap half. People do not think in channels, they think in
// relationships — but Inbox and Phone & Text are separate screens, so an agent
// who emailed a client on Monday and texted them Wednesday had to check two
// places to remember what was said.
//
// The EXPENSIVE half — merging the two screens into one conversation view — is
// deliberately not built. That is 4,300 lines of two mature views rewritten, and
// there is no evidence anyone wants it: the finding came from noticing two files
// were separate, not from anyone struggling. This is the version that costs a day
// and can be removed in ten minutes if it turns out to be noise.
//
// It uses contact_interactions, which ALREADY carries call, email and text for the
// same contact_id — 369 calls, 92 emails, 74 texts today. No new table, no sync,
// nothing to keep in step. The unified timeline it links to already exists on the
// contact record; this is the signpost pointing at it.
//
// It shows NOTHING when there is nothing to say. A line that always appears is
// chrome; a line that appears only when the other channel has history is
// information.
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';

const LABEL = { call: 'call', email: 'email', text: 'text' };

/** "3 texts and a call" — plain counting, no cleverness. */
function phrase(counts) {
  const parts = [];
  for (const k of ['text', 'call', 'email']) {
    const n = counts[k] || 0;
    if (!n) continue;
    parts.push(n === 1 ? `a ${LABEL[k]}` : `${n} ${LABEL[k]}s`);
  }
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

const ago = (d) => {
  const days = Math.floor((Date.now() - new Date(d)) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return days + ' days ago';
  if (days < 60) return 'last month';
  return Math.round(days / 30) + ' months ago';
};

/**
 * @param contactId  who the current thread is with
 * @param exclude    the channel of the screen you are ON, so it reports the OTHERS
 * @param onOpen     opens the contact record, where the full timeline already lives
 */
export default function OtherChannels({ contactId, exclude, onOpen }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!contactId) { setInfo(null); return; }
    let alive = true;
    (async () => {
      try {
        const since = new Date(Date.now() - 90 * 86400000).toISOString();
        const { data } = await supabase.from('contact_interactions')
          .select('channel, occurred_at')
          .eq('contact_id', contactId).gte('occurred_at', since)
          .order('occurred_at', { ascending: false }).limit(60);
        if (!alive || !Array.isArray(data)) return;
        const rows = data.filter((r) => r.channel && r.channel !== exclude);
        if (!rows.length) { setInfo(null); return; }
        const counts = {};
        for (const r of rows) counts[r.channel] = (counts[r.channel] || 0) + 1;
        setInfo({ text: phrase(counts), last: rows[0].occurred_at });
      } catch (_) { if (alive) setInfo(null); }
    })();
    return () => { alive = false; };
  }, [contactId, exclude]);

  if (!info || !info.text) return null;

  return (
    <button type="button" onClick={onOpen} style={{
      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit',
      background: 'rgba(203,163,92,.07)', border: '1px solid rgba(203,163,92,.24)',
      borderRadius: 10, padding: '9px 12px', margin: '0 0 10px',
    }}>
      <span style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.5 }}>
        Also {info.text} with them in the last 90 days — most recently {ago(info.last)}.
        <span style={{ color: '#EBCB82' }}> See everything →</span>
      </span>
    </button>
  );
}
