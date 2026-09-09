import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '../dataService';
import { useTapActivate } from '../useTapActivate';
import { OnboardingModal } from './OnboardingModal';

// The first ninety seconds.
//
// What used to happen: a new agent signed in and got a FORM — name, profession,
// timezone, "assistant context" — and then landed on an app with nothing in it.
// Every screen empty, because nothing had synced. The app asked four questions
// and answered none. Most agents logged in once and never came back, and this
// screen is the likeliest reason.
//
// Three changes, in order of how much they matter:
//
// 1. DO NOT ASK WHAT WE ALREADY KNOW. The MASTER ROSTER gives us 96 active
//    agents, 89 with an email and 88 with a phone. We know their name before
//    they type it. Confirming a name is a different act from filling in a form.
//
// 2. CONNECT EMAIL FIRST, because it is the only thing that makes the app real.
//    Until it happens there are no contacts, no threads, no leads, no history —
//    every screen is an empty state and the product looks like a demo. It is one
//    tap and it is the whole first run.
//
// 3. SHOW THE SYNC HAPPENING. A spinner says "wait"; a count that climbs says
//    "this is yours". The agent watches their own contacts and conversations
//    arrive, which is the moment the app stops being someone else's idea.
//
// Profession, timezone and assistant context are not asked here at all. They are
// useful to the product and worth nothing to the agent in their first minute;
// Settings can have them later.

const GOLD = '#EBCB82';

function Step({ n, of }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
      {Array.from({ length: of }).map((_, i) => (
        <span key={i} style={{ height: 3, flex: 1, borderRadius: 2,
          background: i < n ? GOLD : 'rgba(246,241,231,.16)' }} />
      ))}
    </div>
  );
}

// One definition of "this mailbox works", used by the initial load and again at
// the moment a decision depends on it.
async function emailIsUsable(userId) {
  const { data } = await supabase.from('email_accounts')
    .select('id, refresh_token, reauth_required_at, is_active').eq('user_id', userId);
  return (data || []).some(a => a.is_active !== false && !a.reauth_required_at && !!a.refresh_token);
}

export default function FirstRun({ userId, userEmail, onDone }) {
  // Returning from Google is a full page load carrying ?google_connected=. Read
  // it SYNCHRONOUSLY so the first render is already past the email step.
  //
  // The old version started at step 0 and relied on a localStorage flag AND on
  // hasEmail, which loads asynchronously. Josh connected successfully, came
  // back, was asked his name again, tapped Continue before the account query
  // returned, and was sent to "connect your email" — the step he had just
  // completed. Round and round. Both of those inputs could be late or missing;
  // the URL cannot.
  const returnedFromGoogle = (() => {
    try { return !!new URLSearchParams(window.location.search).get('google_connected'); }
    catch (_) { return false; }
  })();
  const [step, setStep] = useState(returnedFromGoogle ? 2 : 0);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [knownName, setKnownName] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Josh had to tap "Connect my email" twice. Same cause as the tuning-fork
  // menu: iOS does not reliably turn a touch into a click when the surface has
  // just finished laying out or scrolling, and the tap is spent elsewhere. On
  // the one button that carries the whole first run, one tap has to be enough.
  const tapConnect = useTapActivate(() => connectEmail());
  const tapContinue = useTapActivate(() => saveName());
  const [counts, setCounts] = useState(null);
  const [hasEmail, setHasEmail] = useState(false);

  // What the brokerage already knows about this person.
  useEffect(() => {
    let dead = false;
    (async () => {
      // Show them what the brokerage already holds and let them correct it. An
      // agent whose phone number is wrong on the roster is unreachable by every
      // feature built on top of it, and this is the one moment they are looking.
      const { data: agent } = await supabase.from('agents')
        .select('name, email, phone').eq('auth_user_id', userId).maybeSingle();
      if (dead) return;
      const n = (agent && agent.name) || '';
      setKnownName(n || null);
      setName(n);
      setEmail((agent && agent.email) || userEmail || '');
      setPhone((agent && agent.phone) || '');
      // CONNECTED MEANS USABLE, not merely present. This used to check that a
      // row existed, so an agent whose token had been revoked was skipped past
      // the one step that would have fixed it and dropped into a workspace that
      // could never fill. A row with no refresh token, or one flagged for
      // reauth, is a disconnected mailbox wearing a connected row.
      const usable = await emailIsUsable(userId);
      if (!dead) setHasEmail(usable);
    })();
    return () => { dead = true; };
  }, [userId]);

  // Poll what has landed. The numbers are the point: an agent watching their own
  // contacts arrive believes the app in a way no explanatory copy achieves.
  const poll = useCallback(async () => {
    const [c, m, l] = await Promise.all([
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('email_messages').select('id', { count: 'exact', head: true }).eq('user_id', userId),
      supabase.from('lead_concierge').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'pending'),
    ]);
    setCounts({ contacts: c.count || 0, messages: m.count || 0, leads: l.count || 0 });
  }, [userId]);

  useEffect(() => {
    if (step !== 2) return;
    poll();
    const t = setInterval(poll, 4000);
    return () => clearInterval(t);
  }, [step, poll]);

  async function saveName() {
    const v = name.trim();
    if (!v) { setErr('We need a name to put on your work.'); return; }
    setBusy(true); setErr('');
    // Corrections go back to the roster, not just to their profile — the roster
    // is what the brokerage and every report reads from.
    try {
      await supabase.from('agents')
        .update({ name: v, email: (email || '').trim() || null, phone: (phone || '').trim() || null })
        .eq('auth_user_id', userId);
    } catch (_) { /* the setup continues; the broker can fix the roster */ }
    const { error } = await supabase.from('user_settings').upsert({
      user_id: userId, display_name: v,
      // NOT complete yet. The run is finished when they have seen their data,
      // not when they have told us their name — otherwise a refresh mid-setup
      // drops them into the empty app this screen exists to prevent.
      onboarding_complete: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) { setBusy(false); setErr('Could not save that: ' + error.message); return; }
    // Ask the database NOW rather than trusting hasEmail, which may not have
    // loaded yet. Getting this wrong sends someone back to a step they have
    // already finished, which is the worst thing a setup flow can do.
    const usable = await emailIsUsable(userId);
    setHasEmail(usable);
    setBusy(false);
    setStep(usable ? 3 : 1);
  }

  async function connectEmail() {
    setBusy(true); setErr('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not signed in.');
      // Remember where we were, so the OAuth round trip returns here and not to
      // a cold start that looks like the setup never happened.
      try { localStorage.setItem('prism_firstrun', '1'); } catch (_) {}
      const { data, error } = await supabase.functions.invoke('google-oauth-start', {
        body: { return_to: window.location.origin + window.location.pathname, purpose: 'full', login_hint: userEmail || '' },
      });
      if (error) throw error;
      if (data && data.error) throw new Error(data.error);
      if (!data || !data.url) throw new Error('No URL returned.');
      window.location.href = data.url;
    } catch (e) {
      setErr(e.message || String(e));
      setBusy(false);
    }
  }

  useEffect(() => { try { localStorage.removeItem('prism_firstrun'); } catch (_) {} }, []);

  async function finish() {
    setBusy(true);
    await supabase.from('user_settings').upsert({
      user_id: userId, onboarding_complete: true, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    setBusy(false);
    onDone && onDone();
  }

  const card = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '24px 22px', width: '100%', maxWidth: 460 };
  const btn = (primary) => ({
    width: '100%', padding: '13px 16px', borderRadius: 11, fontSize: 15, fontWeight: 800, cursor: 'pointer',
    border: primary ? 'none' : '1px solid var(--border)',
    background: primary ? GOLD : 'transparent', color: primary ? '#1a1205' : 'var(--text-2)',
  });

  return (
    // ABOVE THE ROOMS DRAWER. That drawer is z-index 9000 and opens by default
    // for someone with no resume state — which is exactly a new agent. At 4000
    // this screen rendered underneath it and the first run was invisible: the
    // very users it exists for were the only ones who could not see it. Caught
    // by signing in as a genuinely new account rather than trusting the props.
    <div style={{ position: 'fixed', inset: 0, zIndex: 9500, background: '#100D09',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <div style={card}>
        <Step n={step + 1} of={4} />

        {step === 0 && (
          <>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 27, margin: '0 0 8px', color: 'var(--text-1)' }}>
              {knownName ? 'Welcome, ' + knownName.split(' ')[0] + '.' : 'Welcome.'}
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.55, margin: '0 0 16px' }}>
              {knownName
                ? 'This is your workspace at Realty ONE Group Advantage. Here is what we have for you — fix anything that is wrong.'
                : 'This is your workspace at Realty ONE Group Advantage. Tell us how to reach you.'}
            </p>
            {[['Your name', name, setName, 'text'], ['Email', email, setEmail, 'email'], ['Mobile', phone, setPhone, 'tel']].map(([ph, val, set, t]) => (
              <div key={ph} style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10.5, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--text-3)', marginBottom: 4 }}>{ph}</div>
                <input value={val} type={t} onChange={e => set(e.target.value)} placeholder={ph}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-base)', border: '1px solid var(--border)',
                    borderRadius: 10, padding: '12px 13px', color: 'var(--text-1)', fontSize: 15 }} />
              </div>
            ))}
            {err ? <p style={{ color: '#E4674F', fontSize: 13, margin: '0 0 10px' }}>{err}</p> : null}
            <button disabled={busy} style={btn(true)} {...tapContinue}>Continue</button>
          </>
        )}

        {step === 1 && (
          <>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 27, margin: '0 0 8px', color: 'var(--text-1)' }}>
              Bring your email in.
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.55, margin: '0 0 14px' }}>
              This is the one that matters. Until your email is connected there is nothing here — no
              contacts, no history, no leads. Connect it and the app fills with your own work in a
              couple of minutes.
            </p>
            {/* Say what it does and what it does not, before asking for access.
                An agent handing over their mailbox deserves that in plain words. */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 11, padding: '12px 13px', marginBottom: 14 }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-2)', lineHeight: 1.6 }}>
                <div>• Your contacts and conversations become your database.</div>
                <div>• New enquiries get spotted and brought to you.</div>
                <div>• Your broker cannot read your mail. Only agent records shared with the
                  brokerage are visible to anyone but you.</div>
              </div>
            </div>
            {err ? <p style={{ color: '#E4674F', fontSize: 13, margin: '0 0 10px' }}>{err}</p> : null}
            <button disabled={busy} style={btn(true)} {...tapConnect}>
              {busy ? 'Opening Google…' : 'Connect my email'}
            </button>
            <button style={{ ...btn(false), marginTop: 8 }} onClick={() => setStep(2)}>
              Not now
            </button>
          </>
        )}

        {step >= 2 && (
          <>
            <h1 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 27, margin: '0 0 8px', color: 'var(--text-1)' }}>
              {hasEmail ? 'Filling your workspace…' : 'You are set up.'}
            </h1>
            <p style={{ fontSize: 14, color: 'var(--text-3)', lineHeight: 1.55, margin: '0 0 16px' }}>
              {hasEmail
                ? 'This keeps running after you close it. You can start looking around now.'
                : 'You can connect your email any time from Settings — until you do, most screens will be empty.'}
            </p>
            {hasEmail && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
                {[['Contacts', counts && counts.contacts], ['Messages', counts && counts.messages], ['Leads', counts && counts.leads]].map(([l, v]) => (
                  <div key={l} style={{ border: '1px solid var(--border)', borderRadius: 11, padding: '12px 8px', textAlign: 'center' }}>
                    <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 24, color: GOLD }}>
                      {v == null ? '—' : v}
                    </div>
                    <div style={{ fontSize: 10.5, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{l}</div>
                  </div>
                ))}
              </div>
            )}
            <button disabled={busy} style={btn(true)} onClick={finish}>
              {hasEmail ? 'Start' : 'Take a look around'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}


// Which one to show.
//
// A brand-new agent gets FirstRun: confirm the name the roster already has,
// connect email, watch the workspace fill. Someone reopening this from Settings
// gets the original form, which is the right shape for editing fields you have
// already set. They were one modal doing both jobs, and the first-run half was
// losing agents.
export function OnboardingGate({ userId, userEmail, userSettings, reopen, onClose, onComplete, onFirstRunDone }) {
  if (reopen) {
    return (
      <OnboardingModal userId={userId} userEmail={userEmail} initial={userSettings}
        onClose={onClose} onComplete={onComplete} />
    );
  }
  return <FirstRun userId={userId} userEmail={userEmail} onDone={onFirstRunDone} />;
}
