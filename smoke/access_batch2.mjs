// access_batch2.mjs — the 8 Oct 2026 security batch 2 must not come undone.
//
// Dara approved Batch 2 at 10:26 PM ET on 8 Oct. Sixteen edge functions ran
// with the service role for any caller (sheets-sync read the commission sheet
// with the owner's Google token; call-enrich read call summaries across agents;
// AI-spend, email, push and recording-purge jobs could be triggered by anyone),
// and ~30 internal database functions answered signed-out callers.
//
// STATIC half (always): every one of those functions passes through
// _shared/guard.ts before it does any work; the SQL that closed the database
// functions is still in place.
// LIVE half (full lane, needs SUPABASE_URL + SUPABASE_ANON_KEY + service key):
// with only the public anon key —
//   * closed database functions refuse (called with GET: PostgREST runs a GET
//     in a READ ONLY transaction, so nothing can be written even if one reopened),
//   * recording-identify and google-contacts-sync refuse (random ids — harmless
//     even if the guard were gone).
// The cron-only functions are NOT called live here: if a guard were missing,
// a probe would run the job (a monthly email, a purge). Their guard is proven
// statically here and live, with the x-guard-probe header, at deploy time. BLOCKS.
import fs from 'node:fs';

let bad = 0;
const fail = (m) => { console.error('✗ ' + m); bad++; };
const ok = (m) => console.log('✓ ' + m);
const read = (p) => fs.readFileSync(p, 'utf8');
const expect = (cond, msg) => (cond ? ok(msg) : fail(msg));
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// ── static ────────────────────────────────────────────────────────────────
const guard = read('supabase/functions/_shared/guard.ts');
expect(/export async function requireService\(/.test(guard) && /isServiceCaller\(req\)/.test(guard), '_shared/guard.ts: requireService checks isServiceCaller');
expect(/bodyUserId && opts\.bodyUserId !== uid/.test(guard) && /\["owner", "broker_admin"\]/.test(guard), '_shared/guard.ts: a user acts only for themselves; staff means owner/broker_admin');

const SERVICE_ONLY = ['call-commitments', 'disc-batch-nightly', 'email-snooze-restore', 'geocode-transactions', 'investor-notify',
  'recording-purge', 'task-email-ingest', 'unstuck-weekly', 'usage-report-monthly', 'booking-reminders', 'call-enrich', 'gmail-watch'];
for (const f of SERVICE_ONLY) {
  const src = code(`supabase/functions/${f}/index.ts`);
  const g = src.indexOf('await requireService(req');
  const serveAt = src.search(/(?:Deno\.)?serve\(async/);
  // the guard must be the first statement after OPTIONS, before any body read or database client
  const firstWork = Math.min(...['req.json(', 'createClient(', '.from(', 'fetch('].map((k) => { const i = src.indexOf(k, serveAt); return i < 0 ? Infinity : i; }));
  expect(g > serveAt && g < firstWork, `${f}: service-only guard runs before any work`);
}
for (const [f, needle] of [['sheets-sync', /requireServiceOr\(req, cors, \{ staff: true \}\)/],
  ['google-contacts-sync', /requireServiceOr\(req, corsHeaders, \{ bodyUserId: user_id \}\)/],
  ['recording-identify', /requireServiceOr\(req, cors, \{ bodyUserId: user_id \}\)/],
  ['property-research', /requireServiceOr\(req, corsHeaders, \{ bodyUserId: body\?\.user_id \|\| null \}\)/]]) {
  expect(needle.test(code(`supabase/functions/${f}/index.ts`)), `${f}: service, or a signed-in caller acting for themselves${f === 'sheets-sync' ? ' (staff)' : ''}`);
}
expect(!/billUserId: string \| null = body\?\.user_id/.test(read('supabase/functions/property-research/index.ts')), 'property-research: never bills AI to an id named in the body');

const sqlDir = 'supabase/sql';
const sql = fs.readdirSync(sqlDir).filter((f) => /^2026-10-08[i-k]_batch2_/.test(f)).map((f) => read(`${sqlDir}/${f}`)).join('\n');
expect(/'public\.inbound_kind\(uuid, text, text, text\)'/.test(sql) && /revoke all on function %s from public, anon, authenticated/.test(sql), 'SQL: internal worker functions closed to anon and signed-in users');
expect(/alter default privileges for role postgres in schema public revoke execute on functions from anon/.test(sql), 'SQL: new functions start closed to anon');
expect(/public\.txn_can_edit\(p_id\)/.test(sql) && /lead_attribution_all/.test(sql) && /p_user = auth\.uid\(\) or public\.is_brokerage_staff\(\)/.test(sql), 'SQL: transaction_state, lead_attribution, unstuck_agent_credentials are gated');
expect(/k\.user_id::text = \(storage\.foldername\(objects\.name\)\)\[1\]/.test(sql), 'SQL: shared knowledge files open only through their owner\'s row');
expect((sql.match(/vault\.decrypted_secrets where name = 'service_role_key'/g) || []).length >= 2, 'SQL: sheets-sync and usage-report crons send the Vault service key');

// ── live ──────────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SVC = process.env.SUPABASE_SERVICE_KEY;
if (URL_ && ANON && SVC) {
  const H = { apikey: ANON, Authorization: `Bearer ${ANON}` };
  const rnd = () => crypto.randomUUID();
  const qs = (o) => new URLSearchParams(o).toString();
  // The database migration and the function deploy run beside this gate on the
  // same push. A probe that still sees the old behaviour is retried for up to
  // eight minutes before it counts as a failure.
  const probes = [
    ...[['agent_avg_sale_price', { p_agent: rnd() }], ['transaction_state', { p_id: rnd() }], ['lead_queue_count', { p_user: rnd() }],
      ['user_has_feature', { p_user: rnd(), p_feature: 'x' }], ['is_producing_user', { p_user: rnd() }],
      ['investor_engagement_stats', { p_buyer: rnd() }], ['local_market_stats', { p_address: '1 Main St', p_price: 1 }]]
      .map(([fn, args]) => [`signed-out ${fn}`, () => fetch(`${URL_}/rest/v1/rpc/${fn}?${qs(args)}`, { headers: H })]),
    ...[['recording-identify', { recording_id: rnd(), user_id: rnd() }], ['google-contacts-sync', { user_id: rnd() }]]
      .map(([name, body]) => [`signed-out ${name}`, () => fetch(`${URL_}/functions/v1/${name}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })]),
  ];
  const deadline = Date.now() + 8 * 60 * 1000;
  for (const [label, call] of probes) {
    let status = 0;
    for (;;) {
      const r = await call(); await r.text(); status = r.status;
      if (status === 401 || status === 403 || Date.now() > deadline) break;
      console.log(`· ${label}: HTTP ${status}, waiting for the deploy to land…`);
      await new Promise((res) => setTimeout(res, 30000));
    }
    expect(status === 401 || status === 403, `${label} is refused (HTTP ${status})`);
  }
} else {
  console.log('· live half skipped (no service key in this lane)');
}

if (bad) { console.error(`✗ access_batch2: ${bad} check(s) failed`); process.exit(1); }
console.log('✓ access_batch2 clean');
