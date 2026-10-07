// mcp_connector.mjs — the PrismOS connector for Claude still works, and is still locked.
//
// prism-mcp (supabase/functions/prism-mcp) lets Claude act as a signed-in person.
// That is only safe while four things hold, so every gate run proves all four,
// the way Claude itself would connect:
//
//   1. THE REAL SIGN-IN WORKS. Register a client the way Claude does (dynamic
//      registration), authorize with PKCE, approve as a throwaway user, swap the
//      code for a token, then initialize + list tools + call tools.
//   2. RLS STILL HOLDS. The throwaway user searches for a name that exists only
//      in the broker's contacts and must get nothing back.
//   3. THE GATES STILL CLOSE. No token -> 401 with the sign-in pointer; a forged
//      token -> 401; an ordinary app session (not from the consent flow) -> 401;
//      a person not on mcp_access -> 403.
//   4. STAFF TOOLS STAY STAFF. brokerage_snapshot is not offered to an agent.
//
// Everything it creates (user, contact, task, note, OAuth client, log lines) is
// deleted in `finally`. Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY.
// BLOCKS.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !ANON || !SVC) { console.log('==== MCP CONNECTOR: FAILED — set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY ===='); process.exit(1); }
const MCP = URL_ + '/functions/v1/prism-mcp';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
const BROKER_ONLY_NAME = 'Jorge';   // a real contact of the broker's; a stranger must never see it
const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });

const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const email = `smoke_mcp_${Date.now()}@example.com`, password = 'Pw-' + crypto.randomBytes(9).toString('hex');
let uid = null, clientId = null;

const rpc = async (token, body) => {
  const r = await fetch(MCP, { method: 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}),
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' }, body: JSON.stringify(body) });
  const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not json */ }
  return { status: r.status, j, text, www: r.headers.get('www-authenticate') || '' };
};

try {
  const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cu.error) throw cu.error;
  uid = cu.user?.id || cu.data.user.id;

  // 1. Claude's sign-in, end to end.
  let r = await fetch(URL_ + '/auth/v1/oauth/clients/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Claude', redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }) });
  const reg = await r.json(); clientId = reg.client_id || null;
  expect(r.status === 201 && clientId, `dynamic registration failed (${r.status})`);
  const verifier = b64u(crypto.randomBytes(32)), challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  r = await fetch(URL_ + '/auth/v1/oauth/authorize?' + new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT,
    code_challenge: challenge, code_challenge_method: 'S256', state: 'gate', resource: MCP }), { redirect: 'manual' });
  const loc = r.headers.get('location') || '';
  expect(loc.startsWith('https://darasapp.com/oauth/consent?authorization_id='), `authorize did not send the person to the consent page (${loc.slice(0, 80)})`);
  const authId = new URL(loc).searchParams.get('authorization_id');
  const person = createClient(URL_, ANON, { auth: { persistSession: false } });
  const si = await person.auth.signInWithPassword({ email, password }); if (si.error) throw si.error;
  // The consent page reads the request before approving; the auth server needs that step.
  const det0 = await person.auth.oauth.getAuthorizationDetails(authId); if (det0.error) throw det0.error;
  expect(det0.data?.redirect_uri === REDIRECT, 'consent details do not show Claude\'s return address');
  const ap = await person.auth.oauth.approveAuthorization(authId, { skipBrowserRedirect: true }); if (ap.error) throw ap.error;
  const code = new URL(ap.data.redirect_url).searchParams.get('code');
  r = await fetch(URL_ + '/auth/v1/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier, resource: MCP }) });
  const tok = await r.json();
  expect(!!tok.access_token, `token exchange failed (${r.status})`);
  const token = tok.access_token;

  // 3a. Not on the list yet -> 403.
  let x = await rpc(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gate', version: '1' } } });
  expect(x.status === 403, `a person NOT on mcp_access got ${x.status}, expected 403`);
  // 5a. A person the connector is not on for cannot make a key either.
  { const k0 = await person.rpc('create_mcp_key', { p_name: 'gate' }); expect(!!k0.error && !k0.data, 'a person NOT on mcp_access was given a connector key'); }
  await admin.from('mcp_access').insert({ user_id: uid, note: 'smoke gate — deleted after' });

  x = await rpc(token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gate', version: '1' } } });
  expect(x.status === 200 && x.j?.result?.serverInfo?.name === 'prismos', `initialize failed (${x.status} ${x.text.slice(0, 120)})`);
  x = await rpc(token, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
  const names = (x.j?.result?.tools || []).map((t) => t.name);
  for (const n of ['whats_next', 'todays_calls', 'postpone_call', 'find_contacts', 'contact_details', 'my_leads', 'my_tasks', 'create_task', 'call_followups'])
    expect(names.includes(n), `tool missing from tools/list: ${n}`);
  // 4. Staff-only stays staff-only.
  expect(!names.includes('brokerage_snapshot'), 'brokerage_snapshot offered to a non-staff user');

  const call = async (name, args = {}) => {
    const y = await rpc(token, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } });
    const res = y.j?.result; if (!res || res.isError) return { error: res?.content?.[0]?.text || y.text.slice(0, 160) };
    try { return JSON.parse(res.content[0].text); } catch { return res.content[0].text; }
  };
  const { data: c } = await person.from('contacts').insert({ user_id: uid, name: 'ZZ Gate Buyer', type: 'lead' }).select('id').single();
  const found = await call('find_contacts', { query: 'ZZ Gate' });
  expect(Array.isArray(found) && found.some((f) => f.contact_id === c.id), 'find_contacts did not find the person\'s own contact');
  // 2. RLS.
  const leak = await call('find_contacts', { query: BROKER_ONLY_NAME });
  expect(Array.isArray(leak) && leak.length === 0, `RLS BROKEN: a stranger's Claude found ${Array.isArray(leak) ? leak.length : '?'} of the broker's contacts`);
  const task = await call('create_task', { title: 'ZZ gate task', due_date: '2026-12-31', contact_id: c.id });
  expect(task && task.task_id, `create_task failed: ${JSON.stringify(task).slice(0, 120)}`);
  const det = await call('contact_details', { contact_id: c.id });
  expect(det && det.open_tasks && det.open_tasks.some((t) => t.task_id === task.task_id), 'contact_details does not show the new task');
  for (const n of ['whats_next', 'todays_calls', 'my_leads', 'my_tasks', 'call_followups']) { const o = await call(n); expect(!(o && o.error), `${n} errored: ${o && o.error}`); }

  // 3b-d. Gates.
  x = await rpc(null, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  expect(x.status === 401 && /resource_metadata=/.test(x.www), `no token got ${x.status} without the sign-in pointer`);
  x = await rpc('eyJhbGciOiJub25lIn0.eyJyb2xlIjoiYXV0aGVudGljYXRlZCIsImNsaWVudF9pZCI6IngifQ.x', { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  expect(x.status === 401, `a forged token got ${x.status}`);
  x = await rpc(si.data.session.access_token, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  expect(x.status === 401, `an ordinary app session (not from the consent flow) got ${x.status}`);

  // 5. CONNECTOR KEYS (7 Oct 2026, for assistants that only take a pasted key).
  // A key is the same door with a different handle: same person, same RLS, same
  // tools. Only its fingerprint is stored, and a revoked key stops at once.
  const mk = await person.rpc('create_mcp_key', { p_name: 'gate key' });
  const key = mk.data;
  expect(!mk.error && /^prism_[0-9a-f]{64}$/.test(key || ''), `a connector key could not be made (${mk.error?.message || key})`);
  const { data: stored } = await admin.from('mcp_keys').select('*').eq('user_id', uid);
  expect((stored || []).length === 1 && !JSON.stringify(stored).includes(key) && stored[0].key_hash === crypto.createHash('sha256').update(key).digest('hex'), 'the connector key itself is stored, or its fingerprint is wrong — only a SHA-256 fingerprint may be kept');
  { const peek = await person.from('mcp_keys').select('key_hash'); expect(!!peek.error, 'a signed-in browser can read key fingerprints'); }
  { const mine = await person.from('mcp_keys').select('id, name, key_prefix, created_at, last_used_at, revoked_at'); expect(!mine.error && mine.data.length === 1, 'a person cannot see their own keys in Settings'); }
  x = await rpc(key, { jsonrpc: '2.0', id: 11, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'gate-key', version: '1' } } });
  expect(x.status === 200 && x.j?.result?.serverInfo?.name === 'prismos', `a valid connector key was refused (${x.status} ${x.text.slice(0, 120)})`);
  x = await rpc(key, { jsonrpc: '2.0', id: 12, method: 'tools/list' });
  const kNames = (x.j?.result?.tools || []).map((t) => t.name);
  expect(kNames.includes('find_contacts') && !kNames.includes('brokerage_snapshot'), 'a connector key sees a different tool list from the person it stands for');
  const viaKey = async (name, args = {}) => { const y = await rpc(key, { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name, arguments: args } }); const res = y.j?.result; if (!res || res.isError) return { error: res?.content?.[0]?.text || y.text.slice(0, 160) }; try { return JSON.parse(res.content[0].text); } catch { return res.content[0].text; } };
  { const own = await viaKey('find_contacts', { query: 'ZZ Gate' }); expect(Array.isArray(own) && own.some((f) => f.contact_id === c.id), 'a connector key cannot find its own person\'s contact'); }
  { const leak2 = await viaKey('find_contacts', { query: BROKER_ONLY_NAME }); expect(Array.isArray(leak2) && leak2.length === 0, `RLS BROKEN: a stranger's connector key found ${Array.isArray(leak2) ? leak2.length : '?'} of the broker's contacts`); }
  x = await rpc('prism_' + '0'.repeat(64), { jsonrpc: '2.0', id: 14, method: 'tools/list' });
  expect(x.status === 401, `an unknown connector key got ${x.status}`);
  { const rv = await person.rpc('revoke_mcp_key', { p_id: stored[0].id }); expect(!rv.error, `a key could not be switched off (${rv.error?.message})`); }
  x = await rpc(key, { jsonrpc: '2.0', id: 15, method: 'tools/list' });
  expect(x.status === 401, `a REVOKED connector key still works (${x.status})`);
} catch (e) {
  problems.push('crashed: ' + (e?.message || e));
} finally {
  try {
    if (uid) {
      await admin.from('mcp_access').delete().eq('user_id', uid);
      await admin.from('tasks').delete().eq('user_id', uid);
      await admin.from('contact_notes').delete().eq('user_id', uid);
      await admin.from('contacts').delete().eq('user_id', uid);
      await admin.from('mcp_calls').delete().eq('user_id', uid);
      await admin.auth.admin.deleteUser(uid);
    }
    if (clientId) await fetch(URL_ + '/auth/v1/admin/oauth/clients/' + clientId, { method: 'DELETE', headers: { apikey: SVC, Authorization: 'Bearer ' + SVC } });
  } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
}

if (!problems.length) {
  console.log('==== MCP CONNECTOR: clean — Claude sign-in works end to end; RLS holds; no-token, forged, app-session and not-listed callers all refused; connector keys work, obey RLS, and stop when revoked ====');
  process.exit(0);
}
console.log(`==== MCP CONNECTOR: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
