// talk_to_prism.mjs — the voice screen's brain answers, and never changes anything without a yes.
//
// talk-to-prism (supabase/functions/talk-to-prism) is what the home-screen
// "Talk to Prism" shortcut speaks to. It uses the same tools as the Claude
// connector, under the person's own sign-in. Every gate run proves:
//
//   1. THE GATES CLOSE. No token -> 401; a person not on mcp_access -> 403.
//   2. IT ANSWERS. A real spoken-style question gets a short spoken reply that
//      reflects the person's own data (their one task).
//   3. NOTHING CHANGES WITHOUT A YES. "Add a task…" comes back as a pending
//      action and NO task exists yet; "cancel" leaves it that way; changing the
//      subject drops it; a confirm with nothing pending is refused.
//
// Costs about five cents of AI per run (a handful of short model calls). Everything it
// creates is deleted in `finally`. Needs SUPABASE_URL, SUPABASE_ANON_KEY,
// SUPABASE_SERVICE_KEY. BLOCKS.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_KEY;
if (!URL_ || !ANON || !SVC) { console.log('==== TALK TO PRISM: FAILED — set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY ===='); process.exit(1); }
const FN = URL_ + '/functions/v1/talk-to-prism';
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const email = `smoke_talk_${Date.now()}@example.com`, password = 'Pw-' + crypto.randomBytes(9).toString('hex');
let uid = null;

const talk = async (token, body) => {
  const r = await fetch(FN, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* not json */ }
  return { status: r.status, j: j || {} };
};

try {
  const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cu.error) throw cu.error;
  uid = cu.data.user.id;
  const person = createClient(URL_, ANON, { auth: { persistSession: false } });
  const si = await person.auth.signInWithPassword({ email, password }); if (si.error) throw si.error;
  const token = si.data.session.access_token;

  // 1. Gates.
  let x = await talk(null, { text: 'hello' });
  expect(x.status === 401, `no sign-in got ${x.status}, expected 401`);
  x = await talk(token, { text: 'hello' });
  expect(x.status === 403, `a person NOT on mcp_access got ${x.status}, expected 403`);
  await admin.from('mcp_access').insert({ user_id: uid, note: 'smoke gate — deleted after' });

  // 3a. Confirm with nothing pending is refused.
  x = await talk(token, { decision: 'confirm', messages: [] });
  expect(x.status === 400, `confirm with nothing pending got ${x.status}, expected 400`);

  // 2. A real question about the person's own data.
  await person.from('tasks').insert({ user_id: uid, title: 'Call the plumber about the kitchen sink', due_date: new Date().toISOString().slice(0, 10), status: 'open' });
  x = await talk(token, { text: 'What tasks do I have?', messages: [] });
  expect(x.status === 200 && typeof x.j.reply === 'string', `question failed (${x.status} ${JSON.stringify(x.j).slice(0, 160)})`);
  expect(/plumber|sink/i.test(x.j.reply || ''), `the reply did not mention the person's task: "${(x.j.reply || '').slice(0, 160)}"`);
  expect(!/[*#`]|\]\(/.test(x.j.reply || ''), `the spoken reply contains markdown: "${(x.j.reply || '').slice(0, 120)}"`);

  // 3b. A change comes back as a question, and nothing happens yet.
  x = await talk(token, { text: 'Add a task: ZZ gate talk task, due December 31st 2026.', messages: x.j.messages || [] });
  expect(x.status === 200 && x.j.pending && x.j.pending.tool === 'create_task', `adding a task did not come back for a yes (${x.status} ${JSON.stringify(x.j.pending || x.j.error || x.j.reply).slice(0, 160)})`);
  let { data: made } = await admin.from('tasks').select('id').eq('user_id', uid).ilike('title', '%ZZ gate talk%');
  expect((made || []).length === 0, 'NO-YES BROKEN: the task was created before the person said yes');

  // 3c. "No" leaves it undone.
  if (x.j.pending) {
    const y = await talk(token, { decision: 'cancel', messages: x.j.messages });
    expect(y.status === 200 && !y.j.pending, `cancel failed (${y.status})`);
    ({ data: made } = await admin.from('tasks').select('id').eq('user_id', uid).ilike('title', '%ZZ gate talk%'));
    expect((made || []).length === 0, 'NO-YES BROKEN: the task was created after the person said no');

    // 3d. Talking about something else instead of answering drops the action
    // (and the conversation carries on rather than erroring).
    const z = await talk(token, { text: 'Add a task: ZZ gate talk task, due December 31st 2026.', messages: y.j.messages || [] });
    expect(z.j.pending && z.j.pending.tool === 'create_task', `asking again did not come back for a yes (${z.status})`);
    if (z.j.pending) {
      const w = await talk(token, { text: 'Actually, never mind. How many tasks do I have?', messages: z.j.messages });
      expect(w.status === 200 && typeof w.j.reply === 'string', `changing the subject while a yes was pending failed (${w.status} ${JSON.stringify(w.j).slice(0, 160)})`);
      ({ data: made } = await admin.from('tasks').select('id').eq('user_id', uid).ilike('title', '%ZZ gate talk%'));
      expect((made || []).length === 0, 'NO-YES BROKEN: the task was created after the person changed the subject');
    }
  }
} catch (e) {
  problems.push('crashed: ' + (e?.message || e));
} finally {
  try {
    if (uid) {
      await admin.from('mcp_access').delete().eq('user_id', uid);
      await admin.from('tasks').delete().eq('user_id', uid);
      await admin.from('mcp_calls').delete().eq('user_id', uid);
      await admin.from('ai_usage_log').delete().eq('user_id', uid);
      await admin.auth.admin.deleteUser(uid);
    }
  } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
}

if (!problems.length) {
  console.log('==== TALK TO PRISM: clean — answers from the person\'s own data; no-sign-in and not-listed refused; nothing changes without a yes ====');
  process.exit(0);
}
console.log(`==== TALK TO PRISM: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
