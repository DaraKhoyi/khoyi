// deleted_email.mjs — an email deleted in Gmail (or in PrismOS) stops asking for a reply.
//
// Josh, 29 Sep: "The app is telling me to answer emails I deleted in Gmail."
// supabase/sql/2026-09-29_deleted_email_is_gone.sql made email_messages a view
// that hides TRASH and SPAM, and a trigger that sets the conversation, the
// contact and any open lead card right when a message moves in or out of Trash.
// Each gate run plants one inbound email for a throwaway person and proves:
//
//   1. While it is live, they are in "replies you owe" and their thread is in Inbox.
//   2. Moved to Trash: gone from email_messages, from "replies you owe", from
//      the contact's "waiting on you", the thread leaves Inbox, and the open lead
//      card from that sender is archived.
//   3. Restored (Undo): all of it comes back.
//   4. The daily Trash/Spam reconcile is scheduled.
//
// Needs SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY. BLOCKS.

import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';

const URL_ = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, SVC = process.env.SUPABASE_SERVICE_KEY;
const PAT = process.env.SUPABASE_PAT || process.env.SUPABASE_ACCESS_TOKEN;
if (!URL_ || !ANON || !SVC) { console.log('==== DELETED EMAIL: FAILED — set SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY ===='); process.exit(1); }
const admin = createClient(URL_, SVC, { auth: { persistSession: false } });
const problems = [];
const expect = (ok, what) => { if (!ok) problems.push(what); };
const must = (r, what) => { if (r.error) throw new Error(what + ': ' + r.error.message); return r.data; };
const tag = crypto.randomBytes(4).toString('hex');
const email = `smoke_delmail_${Date.now()}@example.com`, password = 'Pw-' + crypto.randomBytes(9).toString('hex');
const sender = `zz.sender.${tag}@example.org`;
let uid = null, acct = null;

try {
  const cu = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (cu.error) throw cu.error;
  uid = cu.data.user.id;
  const person = createClient(URL_, ANON, { auth: { persistSession: false } });
  const si = await person.auth.signInWithPassword({ email, password }); if (si.error) throw si.error;

  acct = must(await admin.from('email_accounts').insert({ user_id: uid, provider: 'google', email_address: email, is_active: false }).select('id').single(), 'account').id;
  const contact = must(await admin.from('contacts').insert({ user_id: uid, name: `ZZ Deleted Mail ${tag}`, emails: [{ value: sender, is_default: true }], type: 'lead' }).select('id').single(), 'contact');
  const thread = must(await admin.from('email_threads').insert({ user_id: uid, account_id: acct, provider_thread_id: 'zzt' + tag, labels: ['INBOX'], subject: 'Question about the house' }).select('id').single(), 'thread');
  const when = new Date(Date.now() - 3 * 3600e3).toISOString();
  must(await admin.from('email_messages_all').insert({ user_id: uid, account_id: acct, thread_id: thread.id, provider_message_id: 'zzm' + tag,
    provider_thread_id: 'zzt' + tag, from_address: sender, direction: 'inbound', subject: 'Question about the house', labels: ['INBOX', 'UNREAD'], internal_date: when }), 'message');
  await admin.rpc('recompute_contact_comms_one', { p_contact_id: contact.id });
  must(await admin.from('lead_concierge').insert({ user_id: uid, kind: 'lead', status: 'pending', lead_email: sender, lead_name: 'ZZ Deleted Mail', first_seen_at: when }), 'lead card');

  const owes = async () => { const r = await person.rpc('my_owe_reply'); return (r.data || []).some((x) => x.contact_id === contact.id); };
  const visible = async () => (await person.from('email_messages').select('id').eq('provider_message_id', 'zzm' + tag)).data?.length || 0;
  const threadLabels = async () => (await admin.from('email_threads').select('labels').eq('id', thread.id).single()).data?.labels || [];
  const direction = async () => (await admin.from('contacts').select('last_communication_direction').eq('id', contact.id).single()).data?.last_communication_direction;
  const card = async () => (await admin.from('lead_concierge').select('status').eq('user_id', uid).eq('lead_email', sender).single()).data?.status;

  // 1. Live.
  expect(await visible() === 1, 'a live email is not visible');
  expect(await owes(), 'a live unanswered email does not show in "replies you owe"');
  expect(await direction() === 'inbound', 'the contact is not marked waiting on you');

  // 2. Deleted in Gmail (the sync writes Gmail's labels).
  must(await admin.from('email_messages_all').update({ labels: ['TRASH'] }).eq('provider_message_id', 'zzm' + tag), 'trash');
  expect(await visible() === 0, 'a deleted email is still visible in email_messages');
  expect(!(await owes()), 'a DELETED email still shows in "replies you owe"');
  expect(await direction() !== 'inbound', 'the contact is still "waiting on you" after the email was deleted');
  expect(!(await threadLabels()).includes('INBOX'), 'the deleted conversation is still in the Inbox');
  expect(await card() === 'archived', `the open lead card was not closed (${await card()})`);

  // 3. Undo.
  must(await admin.from('email_messages_all').update({ labels: ['INBOX'] }).eq('provider_message_id', 'zzm' + tag), 'untrash');
  expect(await visible() === 1 && await owes(), 'a restored email did not come back into "replies you owe"');
  expect((await threadLabels()).includes('INBOX'), 'a restored conversation did not come back to the Inbox');

  // 4. The daily reconcile is scheduled.
  if (PAT) {
    const REF = URL_.replace(/^https:\/\/([^.]+)\..*$/, '$1');
    const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, { method: 'POST',
      headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json', 'User-Agent': 'KhoyiApp/1.0' },
      body: JSON.stringify({ query: "select count(*)::int n from cron.job where jobname = 'gmail-reconcile-gone-daily' and active" }) });
    const j = await r.json();
    expect(Array.isArray(j) && j[0].n === 1, 'the daily Gmail Trash/Spam reconcile is not scheduled');
  }
} catch (e) {
  problems.push('crashed: ' + (e?.message || e));
} finally {
  try {
    if (uid) {
      await admin.from('lead_concierge').delete().eq('user_id', uid);
      await admin.from('email_messages_all').delete().eq('user_id', uid);
      await admin.from('email_threads').delete().eq('user_id', uid);
      await admin.from('contacts').delete().eq('user_id', uid);
      if (acct) await admin.from('email_accounts').delete().eq('id', acct);
      await admin.auth.admin.deleteUser(uid);
    }
  } catch (e) { problems.push('cleanup failed: ' + (e?.message || e)); }
}

if (!problems.length) {
  console.log('==== DELETED EMAIL: clean — a deleted email leaves replies-owed, the contact, the Inbox and its lead card; Undo brings it all back ====');
  process.exit(0);
}
console.log(`==== DELETED EMAIL: ${problems.length} problem(s) ====`);
for (const p of problems) console.log('  ✗ ' + p);
process.exit(1);
