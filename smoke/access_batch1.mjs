// access_batch1.mjs — the 8 Oct 2026 security batch must not come undone.
//
// Dara approved Batch 1 at 9:21 PM ET on 8 Oct: anyone could sign up, make
// themselves "owner" and then "Act as" anyone; any agent could build a team and
// act as its members; task-dedupe handed out anyone's tasks signed out; the
// fake-lead-alert, scoreboard and log-wipe functions were callable by anyone.
//
// STATIC half (always): the code shapes that closed those holes are still there.
// LIVE half (full lane, needs SUPABASE_URL + SUPABASE_ANON_KEY + the service
// key present): as a signed-out caller with only the public anon key —
//   * sign-up is refused,
//   * the closed functions refuse,
//   * task-dedupe / push-send / impersonate refuse.
// Every live probe is harmless even if a hole reopened: random ids, example.com
// addresses, a 10-year prune window. BLOCKS.
import fs from 'node:fs';

let bad = 0;
const fail = (m) => { console.error('✗ ' + m); bad++; };
const ok = (m) => console.log('✓ ' + m);
const read = (p) => fs.readFileSync(p, 'utf8');
const expect = (cond, msg) => (cond ? ok(msg) : fail(msg));

// ── static ────────────────────────────────────────────────────────────────
const dedupe = read('supabase/functions/task-dedupe/index.ts');
expect(!/user\?\.id\s*\|\|\s*body\.user_id/.test(dedupe) && /isServiceCaller\(req\)/.test(dedupe), 'task-dedupe uses body.user_id only for a service caller');
const push = read('supabase/functions/push-send/index.ts');
expect(!/\.in\("role",\s*\["owner",\s*"broker_admin"\]\)/.test(push) && /your own devices/.test(push), 'push-send: a signed-in caller pushes only to their own devices');
const imp = read('supabase/functions/impersonate/index.ts');
expect(/actor_user_id !== caller\.id/.test(imp), 'impersonate: only the supervisor who started a session can end it');
expect(/ACT_AS_MINUTES\s*=\s*30/.test(imp) && /expires_at/.test(imp) && /session_id: sessionId/.test(imp), 'impersonate: sessions are recorded and expire after 30 minutes');
expect(/eq\("role", "leader"\)/.test(imp) && /\["owner", "broker_admin"\]\.includes\(targetRole\)/.test(imp), 'impersonate: team leaders only reach plain members; admins never reach the owner or admins');
expect(/action === "return"/.test(imp), 'impersonate: return mints the supervisor a session server-side');
const app = read('src/App.js');
expect(!/auth\.signUp\(/.test(app), 'login screen has no public sign-up');
expect(!/setItem\('__realSession'/.test(app), "the supervisor's tokens are not stored in localStorage during act-as");
const acu = read('supabase/functions/admin-create-user/index.ts');
expect(/Only the owner can manage the login of an owner or brokerage admin/.test(acu) && /Only the owner can change an agent's role/.test(acu), 'admin-create-user: owner-only powers enforced');
const cfg = JSON.parse(read('supabase/auth-config.json'));
expect(cfg.disable_signup === true, 'supabase/auth-config.json keeps public sign-up off');
const sqlDir = 'supabase/sql';
const sql = fs.readdirSync(sqlDir).filter((f) => /^2026-10-08[e-h]_batch1_/.test(f)).map((f) => read(`${sqlDir}/${f}`)).join('\n');
expect(/agents_auth_user_id_uniq/.test(sql) && /create trigger agents_guard/.test(sql) && /drop policy if exists agents_own/.test(sql), 'SQL: one login per agent, owner-only agents writes, guard trigger');
expect(/drop policy if exists teams_manage/.test(sql) && /drop policy if exists tm_manage/.test(sql), 'SQL: teams and memberships are admin-managed');
expect(/revoke all on function public\.notify_lead_escalation/.test(sql) && /revoke all on function public\.prune_cron_history/.test(sql), 'SQL: open push / log-wipe functions revoked');

// ── live ──────────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_KEY;
if (URL_ && ANON && SVC) {
  const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };
  const rnd = () => crypto.randomUUID();
  const email = `smoke_signup_${Date.now()}@example.com`;
  const su = await fetch(`${URL_}/auth/v1/signup`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'Pw-' + rnd() }) });
  const suBody = await su.text();
  expect(!su.ok && /signup|not allowed|disabled/i.test(suBody), `public sign-up is refused (HTTP ${su.status})`);
  if (su.ok) {
    // It reopened: remove the account it just made.
    try { const id = JSON.parse(suBody)?.id || JSON.parse(suBody)?.user?.id; if (id) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }); } catch (_) {}
  }
  const rpc = (fn, args) => fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  for (const [fn, args] of [
    ['notify_lead_escalation', { p_lead: rnd(), p_agent: rnd(), p_kind: 'new' }],
    ['brokerage_scoreboard', { p_owner: rnd() }],
    ['prune_cron_history', { p_keep_days: 3650 }],
  ]) {
    const r = await rpc(fn, args); await r.text();
    expect(!r.ok, `signed-out ${fn} is refused (HTTP ${r.status})`);
  }
  const fn = (name, body) => fetch(`${URL_}/functions/v1/${name}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  for (const [name, body] of [
    ['task-dedupe', { user_id: rnd(), proposed: { title: 'smoke probe' } }],
    ['push-send', { user_id: rnd(), title: 'smoke probe' }],
    ['impersonate', { target_user_id: rnd() }],
  ]) {
    const r = await fn(name, body); await r.text();
    expect(r.status === 401 || r.status === 403, `signed-out ${name} is refused (HTTP ${r.status})`);
  }
} else {
  console.log('· live half skipped (no service key in this lane)');
}

if (bad) { console.error(`✗ access_batch1: ${bad} check(s) failed`); process.exit(1); }
console.log('✓ access_batch1 clean');
