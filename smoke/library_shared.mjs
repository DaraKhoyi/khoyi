// library_shared.mjs — a "whole brokerage" library file opens for every agent; a private one does not.
//
// Dara, 30 Sep: Ricky Caruth's talk "available to everyone using the app".
// supabase/sql/2026-09-30_library_shared_talks.sql + knowledge-ingest. Proves,
// with two throwaway agents (A owns, B is someone else):
//
//   1. B can download A's file when A's library entry is scope 'brokerage'.
//   2. B cannot download A's file when the entry is private (or has none).
//   3. A plain agent cannot publish to the whole brokerage (403).
//   4. The transcription poll answers only the server (403 otherwise), and is scheduled.
//   5. The screen offers Listen / Open / Read.
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_PAT. BLOCKS.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_KEY;
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };

const ui = readFileSync('src/views/LibraryOpen.jsx', 'utf8') + readFileSync('src/views/KnowledgeView.jsx', 'utf8');
expect(/'Listen'/.test(ui) && /Open file/.test(ui) && /Read transcript/.test(ui) && /<LibraryOpen s=\{s\} \/>/.test(ui), 'the library no longer offers Listen / Open / Read');

if (!URL_ || !ANON || !SVC || !PAT) {
  if (!process.env.CI) problems.push('set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, SUPABASE_PAT');
} else {
  const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
  const q = async (sql) => {
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' }, body: JSON.stringify({ query: sql }) });
    const j = await r.json(); if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 200)); return j;
  };
  const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
  const tag = crypto.randomBytes(5).toString('hex');
  const users = [];
  const paths = [];
  const mk = async (n) => {
    const email = `smoke_lib_${n}_${Date.now()}@example.com`, password = 'Pw-' + crypto.randomBytes(9).toString('hex');
    const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true }); if (cu.error) throw cu.error;
    users.push(cu.data.user.id);
    const c = createClient(URL_, ANON, { auth: { persistSession: false } });
    const si = await c.auth.signInWithPassword({ email, password }); if (si.error) throw si.error;
    return { id: cu.data.user.id, c, token: si.data.session.access_token };
  };
  try {
    const A = await mk('a'), B = await mk('b');
    const put = async (name) => { const p = `${A.id}/zz-${tag}/${name}`; paths.push(p);
      const r = await admin.storage.from('knowledge').upload(p, new Blob(['hello ' + name], { type: 'text/plain' }), { contentType: 'text/plain', upsert: true });
      if (r.error) throw new Error('upload: ' + r.error.message); return p; };
    const shared = await put('shared.txt'), priv = await put('private.txt'), orphan = await put('orphan.txt');
    await admin.from('knowledge_sources').insert([
      { user_id: A.id, scope: 'brokerage', title: 'zz shared ' + tag, source_type: 'text', original_path: shared, status: 'ready' },
      { user_id: A.id, scope: 'private', title: 'zz private ' + tag, source_type: 'text', original_path: priv, status: 'ready' },
    ]);
    const can = async (p) => { const r = await B.c.storage.from('knowledge').download(p); return !r.error && !!r.data; };
    expect(await can(shared), "another agent cannot open a file shared with the whole brokerage");
    expect(!(await can(priv)), "another agent can open someone's PRIVATE library file");
    expect(!(await can(orphan)), 'another agent can open a library file that has no library entry');

    const pub = await fetch(`${URL_}/functions/v1/knowledge-ingest`, { method: 'POST', headers: { Authorization: `Bearer ${B.token}`, apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'text', text: 'zz', title: 'zz', scope: 'brokerage' }) });
    expect(pub.status === 403, `a plain agent could publish to the whole brokerage (${pub.status})`);
    const poll = await fetch(`${URL_}/functions/v1/knowledge-ingest`, { method: 'POST', headers: { Authorization: `Bearer ${B.token}`, apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ poll_transcripts: true }) });
    expect(poll.status === 403, `an agent could run the transcription poll (${poll.status})`);
    const [{ n }] = await q(`select count(*)::int n from cron.job where jobname = 'knowledge-transcribe-poll' and active`);
    expect(n === 1, 'the long-recording transcription poll is not scheduled');
  } catch (e) {
    problems.push('crashed: ' + (e?.message || e));
  } finally {
    try {
      for (const u of users) await admin.from('knowledge_sources').delete().eq('user_id', u);
      if (paths.length) await admin.storage.from('knowledge').remove(paths);
      for (const u of users) await admin.auth.admin.deleteUser(u);
    } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
  }
}

if (!problems.length) {
  console.log('==== LIBRARY SHARING: clean — brokerage files open for every agent, private ones only for their owner; publishing company-wide is staff-only ====');
  process.exit(0);
}
console.log(`==== LIBRARY SHARING: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
