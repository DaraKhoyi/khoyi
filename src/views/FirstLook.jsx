import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../dataService';

// ── FirstLook ────────────────────────────────────────────────────────────────
// The first ten minutes decide everything.
//
// Four of seven beta agents signed in once and never came back. They didn't
// bounce off complexity — they bounced off an EMPTY app that asked them to give
// before it gave anything. A form, then a blank screen, then homework.
//
// This flips it: connect email, and Prism immediately shows the agent THEIR OWN
// world, already sorted. People you owe. People you've lost touch with. What's
// on your calendar. Nothing typed, nothing configured — the value arrives first.
//
// Shown once, after onboarding, until dismissed (user_settings.first_look_done).

export default function FirstLook({ userId, onDone, setView }) {
  const [phase, setPhase] = useState('intro');   // intro | scanning | reveal
  const [found, setFound] = useState(null);
  const [hasEmail, setHasEmail] = useState(null);

  useEffect(() => {
    let go = true;
    (async () => {
      const { data } = await supabase.from('email_accounts').select('id').limit(1);
      if (go) setHasEmail(!!(data && data.length));
    })();
    return () => { go = false; };
  }, [userId]);

  const scan = useCallback(async () => {
    setPhase('scanning');
    const out = { owed: 0, contacts: 0, coldContacts: 0, events: 0, oldestDays: 0, name: null };
    try {
      const { data: owe } = await supabase.rpc('my_owe_reply');
      out.owed = (owe || []).length;
      if (out.owed) {
        const oldest = (owe || []).reduce((a, b) => new Date(a.last_inbound_at) < new Date(b.last_inbound_at) ? a : b);
        out.oldestDays = Math.floor((Date.now() - new Date(oldest.last_inbound_at)) / 86400000);
        const { data: c } = await supabase.from('contacts').select('name').eq('id', oldest.contact_id).maybeSingle();
        out.name = c?.name || null;
      }
    } catch (_) {}
    try {
      const { count } = await supabase.from('contacts').select('id', { count: 'exact', head: true });
      out.contacts = count || 0;
    } catch (_) {}
    try {
      const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
      const { count } = await supabase.from('contacts').select('id', { count: 'exact', head: true }).lt('last_contact_at', cutoff);
      out.coldContacts = count || 0;
    } catch (_) {}
    try {
      const now = new Date().toISOString();
      const wk = new Date(Date.now() + 7 * 86400000).toISOString();
      const { count } = await supabase.from('events').select('id', { count: 'exact', head: true }).gte('start_at', now).lte('start_at', wk);
      out.events = count || 0;
    } catch (_) {}
    // a beat, so the reveal lands rather than flickers
    setTimeout(() => { setFound(out); setPhase('reveal'); }, 900);
  }, []);

  const finish = async () => {
    try { await supabase.from('user_settings').update({ first_look_done: true }).eq('user_id', userId); } catch (_) {}
    onDone && onDone();
  };

  const Stat = ({ n, label, sub, tone }) => (
    <div style={{ padding: '14px 16px', borderRadius: 14, background: 'var(--bg-card)', border: '1px solid var(--border)', marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 300, color: tone || 'var(--accent)' }}>{n}</span>
        <span style={{ fontSize: 14, color: 'var(--text-1)' }}>{label}</span>
      </div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 3 }}>{sub}</div>}
    </div>
  );

  return (
    <div className="modal-overlay" style={{ zIndex: 3000 }}>
      <div className="modal" style={{ maxWidth: 460, width: '100%', maxHeight: '92vh', overflowY: 'auto' }}>

        {phase === 'intro' && (
          <>
            <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
              <div style={{ fontSize: 34 }}>✦</div>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 25, margin: '8px 0 6px', color: 'var(--text-1)' }}>
                Let me show you something.
              </h2>
              <p style={{ fontSize: 13.5, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 6px' }}>
                Connect your email and I'll read the last 90 days — then show you who's waiting on you,
                who you've lost touch with, and what's coming up.
              </p>
              <p style={{ fontSize: 12, color: 'var(--text-3)', lineHeight: 1.5 }}>
                Nothing to type. Nothing to set up. It's your own world, sorted.
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
              {hasEmail === false && (
                <button className="btn btn-primary" onClick={() => { setView && setView('settings'); }}>
                  Connect my email
                </button>
              )}
              {hasEmail && (
                <button className="btn btn-primary" onClick={scan}>Show me what you found</button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={finish}>Skip for now</button>
            </div>
          </>
        )}

        {phase === 'scanning' && (
          <div style={{ textAlign: 'center', padding: '40px 10px' }}>
            <div style={{ fontSize: 30, marginBottom: 10 }}>✦</div>
            <div style={{ fontFamily: 'Fraunces, serif', fontSize: 19, fontWeight: 300, color: 'var(--text-1)' }}>Reading your last 90 days…</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-3)', marginTop: 6 }}>Finding the people who are waiting on you.</div>
          </div>
        )}

        {phase === 'reveal' && found && (
          <>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 11, letterSpacing: 1.8, color: 'var(--accent)', fontWeight: 700 }}>HERE'S WHAT I FOUND</div>
              <h2 style={{ fontFamily: 'Fraunces, serif', fontWeight: 300, fontSize: 24, margin: '4px 0 0', color: 'var(--text-1)' }}>
                You didn't have to type a thing.
              </h2>
            </div>

            {found.owed > 0 && (
              <Stat n={found.owed} label={found.owed === 1 ? 'person is waiting on your reply' : 'people are waiting on your reply'}
                sub={found.name ? `Longest wait: ${found.name}, ${found.oldestDays} days` : null} tone="var(--yellow)" />
            )}
            {found.contacts > 0 && (
              <Stat n={found.contacts} label="people already in your world" sub="Pulled from your email — no importing" />
            )}
            {found.coldContacts > 0 && (
              <Stat n={found.coldContacts} label="have gone quiet" sub="No contact in 90+ days — the ones that quietly cost you business" tone="var(--text-2)" />
            )}
            {found.events > 0 && (
              <Stat n={found.events} label="on your calendar this week" sub="I'll prep you before each one" tone="#06b6d4" />
            )}

            {found.owed === 0 && found.contacts === 0 && (
              <div style={{ padding: '18px 16px', borderRadius: 14, border: '1px dashed var(--border)', textAlign: 'center' }}>
                <div style={{ fontSize: 13.5, color: 'var(--text-2)' }}>Nothing to show yet.</div>
                <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 4 }}>
                  Once your email is connected and synced, this fills in on its own.
                </div>
              </div>
            )}

            <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6, margin: '14px 0 4px' }}>
              From here, Prism tells you the <b>single next thing</b> worth doing — and drafts it in the
              other person's style. You never start from a blank page again.
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
              <button className="btn btn-primary" onClick={() => { finish(); setView && setView('today'); }}>
                {found.owed > 0 ? 'Show me who to reply to first' : 'Take me to Today'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={finish}>I'll look around myself</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
