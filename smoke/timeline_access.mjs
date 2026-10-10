// timeline_access.mjs — CRM Phase 1 (10 Oct 2026): the client timeline and the
// voice-note Save must never widen who sees what.
// STATIC (always): contact_timeline + save_voice_note are SECURITY INVOKER,
//   closed to anon, Save only writes onto the caller's own contact, the screens
//   call only those, and the voice note never sends (no gmail-send / quo send).
// LIVE (full lane): with the anon key, the timeline RPC refuses.
// ROLES (full lane + SUPABASE_PAT, once the function is live): inside a
//   transaction that always rolls back — the owner reads their busiest client,
//   another agent reads 0 rows of it and cannot Save onto it, a support (act-as)
//   session reads 0 rows of a private client. BLOCKS.
import fs from 'node:fs';
let bad = 0;
const fail = (m) => { console.error('✗ ' + m); bad++; };
const ok = (m) => console.log('✓ ' + m);
const expect = (c, m) => (c ? ok(m) : fail(m));
const sql = fs.readFileSync('supabase/sql/2026-10-10d_client_timeline_and_voice_save.sql', 'utf8');
const fnBlock = (name) => sql.slice(sql.indexOf('function public.' + name), sql.indexOf('$$;', sql.indexOf('function public.' + name)));
for (const f of ['contact_timeline', 'save_voice_note']) {
  const b = fnBlock(f);
  expect(/security invoker/i.test(b) && !/security definer/i.test(b), `${f}: SECURITY INVOKER (RLS decides)`);
  expect(new RegExp(`revoke all on function public\\.${f}\\([^)]*\\) from public, anon`).test(sql), `${f}: closed to signed-out callers`);
}
expect(/not exists \(select 1 from contacts where id = p_contact and user_id = v_uid\)/.test(fnBlock('save_voice_note')), 'save_voice_note: only onto your own contact');
expect(/select ct\.id[\s\S]*from contacts ct where ct\.id = p_contact;\s*if not found then return;/.test(fnBlock('contact_timeline')), 'contact_timeline: no readable contact, no feed');
expect(/m\.user_id = v_uid/.test(sql) && /em\.user_id = v_uid/.test(sql), 'contact_timeline: texts and emails come only from the caller\u2019s own line/mailbox');
const tl = fs.readFileSync('src/views/ClientTimeline.jsx', 'utf8');
const vc = fs.readFileSync('src/views/VoiceCapture.jsx', 'utf8');
expect(/rpc\('contact_timeline'/.test(tl), 'ClientTimeline reads through contact_timeline');
expect(/rpc\('save_voice_note'/.test(vc) && /onClick=\{\(\) => onSave\(/.test(vc), 'VoiceCapture saves only from the Save tap');
expect(!/gmail-send|quo-proxy|send_message|sendText/.test(vc), 'VoiceCapture never sends anything');
const vn = fs.readFileSync('supabase/functions/voice-note/index.ts', 'utf8');
expect(/MONTHLY_CAP_USD = 3/.test(vn) && /if \(overCap\)/.test(vn), 'voice-note: $3/agent/month AI guardrail');
expect(/\.eq\("id", hintId\)\.eq\("user_id", uid\)/.test(vn), 'voice-note: a contact hint must be the caller\u2019s own');

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY;
if (URL_ && ANON) {
  const r = await fetch(`${URL_}/rest/v1/rpc/contact_timeline?p_contact=00000000-0000-0000-0000-000000000000`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } });
  expect(r.status === 401 || r.status === 403 || r.status === 404, `anon: contact_timeline refused (HTTP ${r.status})`);
}
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (PAT && URL_) {
  const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
  const q = async (query) => { const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query }) }); return { status: r.status, text: await r.text() }; };
  const live = await q(`select to_regprocedure('public.contact_timeline(uuid,timestamptz,int,text[])') is not null as live`);
  if (!/"live":true/.test(live.text)) console.log('· contact_timeline not live yet; role checks run after apply-sql');
  else {
    const res = await q(fs.readFileSync('smoke/timeline_roles.sql', 'utf8'));
    const m = res.text.match(/ROLES (\{[^}]*\})/);
    if (!m) fail('role check did not report: ' + res.text.slice(0, 200));
    else {
      const v = JSON.parse(m[1].replace(/\\"/g, '"'));
      expect(v.owner > 0, `owner reads own client (${v.owner} rows)`);
      expect(v.other_agent === 0, `another agent reads 0 rows of a private client (${v.other_agent})`);
      expect(v.other_save === 'blocked', 'another agent cannot Save onto it');
      expect(v.act_as === 0, `act-as reads 0 rows of a private client (${v.act_as})`);
      expect(v.anon === false, 'anon has no execute');
    }
  }
}
if (bad) { console.error(`TIMELINE ACCESS: ${bad} failure(s)`); process.exit(1); }
console.log('TIMELINE ACCESS: clean');
