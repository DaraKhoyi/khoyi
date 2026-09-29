import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../dataService';

// Talk to Prism — speak a request, hear the answer. Opened from the PrismOS
// home-screen icon: long-press it and tap "Talk to Prism" (or drag that entry
// onto the home screen as its own icon). Dara, 27 Sep 2026: "an app or widget
// that I can launch from the home screen that I can just speak to."
//
// The phone does the listening (the browser's speech recognition) and the
// talking (its built-in voice) — both free and instant. The thinking is the
// talk-to-prism edge function, which uses the same actions as the Claude
// connector and runs them under this person's own sign-in.
//
// NOTHING CHANGES WITHOUT A YES. When Prism wants to change something it says
// what it is about to do and waits: say "yes" or tap Do it; "no" or Cancel.

const GOLD = '#C5A95E', CREAM = '#E9E1D0', DIM = '#9C927F', EMBER = '#E4674F';
const YES = /^(yes|yeah|yep|yup|sure|ok(ay)?|go ahead|do it|please do|confirm|correct|that'?s right|affirmative)\b/i;
const NO = /^(no|nope|cancel|don'?t|stop|never ?mind|wait)\b/i;
const field = { width: '100%', boxSizing: 'border-box', minHeight: 48, borderRadius: 12, padding: '0 12px', marginBottom: 10,
  background: '#0E0B07', border: '1px solid rgba(255,255,255,.14)', color: CREAM, fontSize: 16 };
const Recognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
// iPhone/iPad: Safari only lets the microphone start from a tap, and some iOS
// versions do not listen at all inside a home-screen app — the keyboard's own
// dictation key always works in the text box, so that is the fallback we name.
const IOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

function speak(text, onEnd) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !text) { onEnd && onEnd(); return; }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = 1.03;
    const v = synth.getVoices().find(x => /en-US/i.test(x.lang) && /Google|Samantha|Natural/i.test(x.name)) || null;
    if (v) u.voice = v;
    u.onend = () => onEnd && onEnd();
    u.onerror = () => onEnd && onEnd();
    synth.speak(u);
  } catch (_) { onEnd && onEnd(); }
}

export default function TalkToPrism() {
  const [session, setSession] = useState(undefined);
  const [state, setState] = useState('idle');          // idle | listening | thinking | speaking
  const [heard, setHeard] = useState('');
  const [turns, setTurns] = useState([]);                // [{ who: 'you'|'prism', text }]
  const [pending, setPending] = useState(null);
  const [typed, setTyped] = useState('');
  const [err, setErr] = useState('');
  const messages = useRef([]);
  const rec = useRef(null);
  const pendingRef = useRef(null);
  const autoStarted = useRef(false);

  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s || null));
    return () => { try { sub.subscription.unsubscribe(); } catch (_) {} };
  }, []);
  const signIn = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr('That email and password did not match a PrismOS account.');
  };
  useEffect(() => { pendingRef.current = pending; }, [pending]);

  const add = (who, text) => setTurns(t => [...t.slice(-7), { who, text }]);

  const send = useCallback(async (payload, spokenBy) => {
    setErr(''); setState('thinking');
    if (payload.text) add('you', payload.text);
    try {
      const { data, error } = await supabase.functions.invoke('talk-to-prism', { body: { ...payload, messages: messages.current } });
      if (error) {
        let msg = error.message || 'Prism could not answer.';
        try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (_) {}
        throw new Error(msg);
      }
      messages.current = data.messages || messages.current;
      setPending(data.pending || null);
      add('prism', data.reply);
      setState('speaking');
      speak(data.reply, () => {
        setState('idle');
        // Asked a yes/no? Listen for the answer straight away.
        if (data.pending && spokenBy === 'voice') setTimeout(() => startListening(), 250);
      });
    } catch (e) {
      setState('idle'); setErr(e.message || String(e));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const decide = (d) => { setPending(null); add('you', d === 'confirm' ? 'Yes' : 'No'); send({ decision: d }, 'tap'); };

  const handleSpoken = (text) => {
    const t = text.trim();
    if (!t) return;
    if (pendingRef.current) {
      if (YES.test(t)) { setPending(null); add('you', t); send({ decision: 'confirm' }, 'voice'); return; }
      if (NO.test(t)) { setPending(null); add('you', t); send({ decision: 'cancel' }, 'voice'); return; }
    }
    setPending(null);
    send({ text: t }, 'voice');
  };

  function startListening() {
    setErr('');
    if (!Recognition) { setErr(IOS ? 'Your iPhone cannot listen from here. Tap the box below and press the microphone on your keyboard to speak.' : 'This browser cannot listen. Type your request below instead.'); return; }
    try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (_) {}
    try { rec.current && rec.current.abort(); } catch (_) {}
    const r = new Recognition();
    r.lang = 'en-US'; r.interimResults = true; r.continuous = false; r.maxAlternatives = 1;
    let finalText = '';
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const s = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += s; else interim += s;
      }
      setHeard((finalText + ' ' + interim).trim());
    };
    r.onerror = (ev) => {
      setState('idle');
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') setErr(IOS ? 'Your iPhone did not let PrismOS listen. Tap the big button to try again, or tap the box below and press the microphone on your keyboard.' : 'PrismOS needs the microphone. Allow it when your phone asks, then tap the button.');
      else if (ev.error !== 'no-speech' && ev.error !== 'aborted') setErr('I did not catch that (' + ev.error + '). Tap to try again.');
    };
    r.onend = () => { setState(s => (s === 'listening' ? 'idle' : s)); const t = finalText.trim(); setHeard(''); if (t) handleSpoken(t); };
    rec.current = r;
    setHeard(''); setState('listening');
    try { r.start(); } catch (_) { setState('idle'); }
  }

  // Opened from the home screen: start listening at once. (If the phone wants
  // a tap first, the big button is right there.)
  useEffect(() => {
    if (session && !autoStarted.current && !IOS) { autoStarted.current = true; setTimeout(() => startListening(), 400); }
  }, [session]); // eslint-disable-line react-hooks/exhaustive-deps

  const tap = () => {
    if (state === 'listening') { try { rec.current && rec.current.stop(); } catch (_) {} return; }
    if (state === 'speaking') { try { window.speechSynthesis.cancel(); } catch (_) {} setState('idle'); return; }
    if (state === 'idle') startListening();
  };

  const wrap = { minHeight: '100vh', background: 'radial-gradient(120% 80% at 50% 0%, #221B10 0%, #100D09 60%)', color: CREAM,
    display: 'flex', flexDirection: 'column', fontFamily: 'Inter, system-ui, sans-serif', boxSizing: 'border-box',
    padding: 'max(16px, env(safe-area-inset-top)) 16px max(20px, env(safe-area-inset-bottom))' };

  if (session === undefined) return <div style={wrap} />;
  // Opened from its own home-screen icon before ever signing in there (an iPhone
  // keeps a separate sign-in per home-screen app): sign in right here.
  if (!session) return (
    <div style={{ ...wrap, alignItems: 'center', justifyContent: 'center' }}>
      <form onSubmit={signIn} style={{ width: '100%', maxWidth: 380 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: '.2em', textTransform: 'uppercase', fontSize: 12, fontWeight: 800, color: GOLD, marginBottom: 8 }}>Talk to Prism</div>
        <div style={{ fontSize: 16, marginBottom: 14, lineHeight: 1.5 }}>Sign in with your PrismOS email and password.</div>
        <input style={field} type="email" autoComplete="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
        <input style={field} type="password" autoComplete="current-password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} />
        <button type="submit" disabled={busy} style={{ width: '100%', minHeight: 50, borderRadius: 12, border: 'none', background: '#EBCB82', color: '#100D09', fontSize: 16, fontWeight: 800 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {err && <div style={{ color: EMBER, fontSize: 14, marginTop: 10 }}>{err}</div>}
      </form>
    </div>
  );

  const label = { idle: 'Tap and speak', listening: 'Listening…', thinking: 'Thinking…', speaking: 'Tap to stop' }[state];
  const ring = state === 'listening' ? '0 0 0 12px rgba(235,203,130,.18), 0 0 0 26px rgba(235,203,130,.08)'
    : state === 'thinking' ? '0 0 0 10px rgba(197,169,94,.12)' : '0 10px 30px rgba(0,0,0,.45)';

  return (
    <div style={wrap}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: '.2em', textTransform: 'uppercase', fontSize: 12, fontWeight: 800, color: GOLD }}>Talk to Prism</div>
        <a href="/" aria-label="Close" style={{ marginLeft: 'auto', color: DIM, textDecoration: 'none', fontSize: 14, padding: '10px 4px', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Open PrismOS ›</a>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 0 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {turns.length === 0 && (
          <div style={{ color: DIM, fontSize: 14.5, lineHeight: 1.6, marginTop: 8 }}>
            Try: <i style={{ color: CREAM }}>"Who's on my call list?"</i> · <i style={{ color: CREAM }}>"Postpone Chris Baron to Tuesday."</i> · <i style={{ color: CREAM }}>"Add a task to send Maria the CMA Thursday."</i> · <i style={{ color: CREAM }}>"Any new leads?"</i>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} style={{ alignSelf: t.who === 'you' ? 'flex-end' : 'flex-start', maxWidth: '88%',
            background: t.who === 'you' ? 'rgba(197,169,94,.16)' : '#1B160F', border: '1px solid ' + (t.who === 'you' ? 'rgba(197,169,94,.4)' : 'rgba(255,255,255,.08)'),
            borderRadius: 14, padding: '10px 13px', fontSize: t.who === 'you' ? 14.5 : 16, lineHeight: 1.5, color: CREAM }}>{t.text}</div>
        ))}
        {heard && <div style={{ alignSelf: 'flex-end', color: DIM, fontSize: 14.5, fontStyle: 'italic' }}>{heard}</div>}
      </div>

      {pending && (
        <div style={{ border: '1px solid rgba(197,169,94,.55)', background: 'rgba(197,169,94,.08)', borderRadius: 14, padding: '12px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, letterSpacing: '.12em', textTransform: 'uppercase', color: GOLD, fontWeight: 800, marginBottom: 6 }}>Waiting for your yes</div>
          <div style={{ fontSize: 15, lineHeight: 1.5, marginBottom: 10 }}>{pending.say}</div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" onClick={() => decide('cancel')} style={{ flex: 1, minHeight: 50, borderRadius: 12, border: '1px solid rgba(255,255,255,.2)', background: 'transparent', color: CREAM, fontSize: 16, fontWeight: 700 }}>Cancel</button>
            <button type="button" onClick={() => decide('confirm')} style={{ flex: 1, minHeight: 50, borderRadius: 12, border: 'none', background: '#EBCB82', color: '#100D09', fontSize: 16, fontWeight: 800 }}>Do it</button>
          </div>
        </div>
      )}
      {err && <div style={{ color: EMBER, fontSize: 14, marginBottom: 10, lineHeight: 1.5 }}>{err}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '6px 0 12px' }}>
        <button type="button" onClick={tap} disabled={state === 'thinking'} aria-label={label}
          style={{ width: 118, height: 118, borderRadius: '50%', border: 'none', cursor: 'pointer', boxShadow: ring,
            background: state === 'listening' ? '#EBCB82' : 'linear-gradient(160deg,#EBCB82,#B8963E)', color: '#100D09',
            display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'box-shadow .25s', opacity: state === 'thinking' ? 0.7 : 1 }}>
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="#100D09" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {state === 'speaking'
              ? <rect x="6" y="6" width="12" height="12" rx="2" fill="#100D09" />
              : <><rect x="9" y="2" width="6" height="12" rx="3" fill="#100D09" /><path d="M5 10a7 7 0 0 0 14 0" /><line x1="12" y1="17" x2="12" y2="22" /></>}
          </svg>
        </button>
        <div style={{ fontSize: 13.5, color: DIM }}>{label}</div>
      </div>

      <form onSubmit={(e) => { e.preventDefault(); const t = typed.trim(); if (t && state !== 'thinking') { setTyped(''); if (pending && (YES.test(t) || NO.test(t))) { setPending(null); add('you', t); send({ decision: YES.test(t) ? 'confirm' : 'cancel' }, 'tap'); } else { setPending(null); send({ text: t }, 'tap'); } } }}
        style={{ display: 'flex', gap: 8 }}>
        <input value={typed} onChange={e => setTyped(e.target.value)} placeholder="Or type it here"
          style={{ flex: 1, minHeight: 46, borderRadius: 12, padding: '0 12px', background: '#0E0B07', border: '1px solid rgba(255,255,255,.14)', color: CREAM, fontSize: 16 }} />
        <button type="submit" style={{ minHeight: 46, padding: '0 16px', borderRadius: 12, border: '1px solid rgba(197,169,94,.5)', background: 'transparent', color: GOLD, fontWeight: 800 }}>Send</button>
      </form>
    </div>
  );
}
