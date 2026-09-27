import React, { useEffect, useState } from 'react';
import { supabase } from '../dataService';

// darasapp.com/oauth/consent — "Claude wants to connect to your PrismOS."
//
// Supabase's OAuth server sends the person here with ?authorization_id=… when
// Claude (the connector, supabase/functions/prism-mcp) asks for access. Approving
// hands Claude a token that acts as THIS person, under their own row-level
// security — so the page says exactly that, in plain words, and has two guards:
//   1. It only ever approves a request whose return address is Claude's own
//      (claude.ai / claude.com). Anyone can register an OAuth client; a look-alike
//      "Claude" pointing somewhere else is refused here, never approved.
//   2. While the connector is new, only people on the mcp_access list may
//      approve. Everyone else is told it is not switched on yet.

const CLAUDE_HOSTS = ['claude.ai', 'claude.com', 'www.claude.ai', 'www.claude.com'];
const GOLD = '#C5A95E';

const wrap = { minHeight: '100vh', background: '#100D09', color: '#E9E1D0', display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: 16, boxSizing: 'border-box', fontFamily: 'Inter, system-ui, sans-serif' };
const card = { width: '100%', maxWidth: 440, background: '#17130D', border: '1px solid rgba(197,169,94,.45)', borderRadius: 18,
  padding: '22px 20px', boxShadow: '0 10px 30px rgba(0,0,0,.4)' };
const btn = (primary) => ({ flex: 1, minHeight: 48, borderRadius: 12, fontSize: 15, fontWeight: 800, cursor: 'pointer',
  border: primary ? 'none' : '1px solid rgba(255,255,255,.18)', background: primary ? '#EBCB82' : 'transparent',
  color: primary ? '#100D09' : '#C8BFAE' });
const input = { width: '100%', boxSizing: 'border-box', minHeight: 46, borderRadius: 10, padding: '0 12px', marginBottom: 10,
  background: '#0E0B07', border: '1px solid rgba(255,255,255,.14)', color: '#E9E1D0', fontSize: 15 };

export default function OAuthConsent() {
  const id = new URLSearchParams(window.location.search).get('authorization_id');
  const [session, setSession] = useState(undefined);
  const [details, setDetails] = useState(null);
  const [allowed, setAllowed] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s || null));
    return () => { try { sub.subscription.unsubscribe(); } catch (_) {} };
  }, []);

  useEffect(() => {
    if (!session || !id) return;
    (async () => {
      const { data, error } = await supabase.auth.oauth.getAuthorizationDetails(id);
      if (error) { setErr('This connection request has expired or is not valid. Start again from Claude.'); return; }
      if (data && data.redirect_url && !data.authorization_id) { window.location.replace(data.redirect_url); return; }
      setDetails(data);
      const { data: ok } = await supabase.rpc('mcp_access_allowed');
      setAllowed(ok === true);
    })();
  }, [session, id]);

  const host = (() => { try { return new URL(details && details.redirect_uri).hostname.toLowerCase(); } catch (_) { return ''; } })();
  const isClaude = CLAUDE_HOSTS.includes(host);

  const decide = async (approve) => {
    setBusy(true); setErr('');
    const fn = approve ? supabase.auth.oauth.approveAuthorization : supabase.auth.oauth.denyAuthorization;
    const { data, error } = await fn.call(supabase.auth.oauth, id, { skipBrowserRedirect: true });
    if (error) { setBusy(false); setErr((approve ? 'Could not connect: ' : 'Could not cancel: ') + (error.message || error)); return; }
    if (data && data.redirect_url) window.location.replace(data.redirect_url);
    else setBusy(false);
  };

  const signIn = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) setErr('That email and password did not match a PrismOS account.');
  };

  const head = (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", letterSpacing: '.18em', textTransform: 'uppercase', fontSize: 12, fontWeight: 800, color: GOLD }}>PrismOS</div>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 400, marginTop: 6, lineHeight: 1.25 }}>
        {details && !CLAUDE_HOSTS.includes((() => { try { return new URL(details.redirect_uri).hostname.toLowerCase(); } catch (_) { return ''; } })())
          ? 'An app is asking to connect to your PrismOS'
          : 'Claude wants to connect to your PrismOS'}
      </div>
    </div>
  );

  let body;
  if (!id) body = <div>This page is only reached from Claude's connector sign-in.</div>;
  else if (session === undefined) body = <div style={{ color: '#9C927F' }}>Checking your sign-in…</div>;
  else if (!session) body = (
    <form onSubmit={signIn}>
      <div style={{ fontSize: 14, color: '#C8BFAE', marginBottom: 12 }}>Sign in with your PrismOS email and password to continue.</div>
      <input style={input} type="email" autoComplete="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input style={input} type="password" autoComplete="current-password" placeholder="Password" value={pw} onChange={e => setPw(e.target.value)} />
      <button type="submit" disabled={busy} style={{ ...btn(true), width: '100%' }}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
  else if (!details) body = <div style={{ color: '#9C927F' }}>{err || 'Loading the request…'}</div>;
  else if (!isClaude) body = (
    <>
      <div style={{ fontSize: 14.5, lineHeight: 1.55, color: '#E4674F', marginBottom: 14 }}>
        This request would send your PrismOS access to <b>{host || 'an unknown address'}</b>, which is not Claude.
        PrismOS only connects to Claude, so this has been stopped.
      </div>
      <button type="button" disabled={busy} onClick={() => decide(false)} style={{ ...btn(true), width: '100%' }}>Refuse and close</button>
    </>
  );
  else if (allowed === false) body = (
    <>
      <div style={{ fontSize: 14.5, lineHeight: 1.55, marginBottom: 14 }}>
        The Claude connector is not switched on for your account yet. Ask Dara to add you.
      </div>
      <button type="button" disabled={busy} onClick={() => decide(false)} style={{ ...btn(false), width: '100%' }}>OK</button>
    </>
  );
  else if (allowed === null) body = <div style={{ color: '#9C927F' }}>Checking your account…</div>;
  else body = (
    <>
      <div style={{ fontSize: 14, lineHeight: 1.6, color: '#C8BFAE' }}>
        Signed in as <b style={{ color: '#E9E1D0' }}>{session.user.email}</b>. Claude will act as you, and see only what you see in PrismOS.
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.6, margin: '12px 0 4px', color: '#E9E1D0' }}>It will be able to:</div>
      <ul style={{ margin: '0 0 12px', paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7, color: '#C8BFAE' }}>
        <li>read your call list, leads, contacts, tasks and call follow-ups</li>
        <li>add tasks and notes, tick off or postpone calls — Claude asks you first</li>
      </ul>
      <div style={{ fontSize: 12.5, color: '#9C927F', marginBottom: 16 }}>
        It cannot send emails or texts. You can disconnect any time in Claude's connector settings.
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button type="button" disabled={busy} onClick={() => decide(false)} style={btn(false)}>Cancel</button>
        <button type="button" disabled={busy} onClick={() => decide(true)} style={btn(true)}>{busy ? 'Connecting…' : 'Connect'}</button>
      </div>
    </>
  );

  return (
    <div style={wrap}>
      <div style={card}>
        {head}
        {body}
        {err && details ? <div style={{ marginTop: 12, fontSize: 13, color: '#E4674F' }}>{err}</div> : null}
      </div>
    </div>
  );
}
