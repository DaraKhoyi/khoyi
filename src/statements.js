// statements — the words and small decisions behind statement review.
//
// Dara, 6 Oct 2026 (accounting build, part 4): "Nothing imported touches the
// ledger directly. Every line lands in a holding area first." What may post,
// and when, is decided in the database (statement_post_line and the functions
// around it); this file only says it in plain words and asks the two
// follow-up questions a correction can raise.
import { supabase } from './dataService';
import { confirmDialog, notify, notifyError } from './notify';
import { fmtUSDCents } from './financeUtils';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// A date as text, never through new Date(): that shows the day before in Tampa.
export function shortDay(iso, withYear = false) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  return `${MONTHS[+m[2] - 1]} ${+m[3]}${withYear ? ', ' + m[1] : ''}`;
}
export const periodText = (from, to) => (from && to ? `${shortDay(from)} to ${shortDay(to, true)}` : from || to ? shortDay(from || to, true) : '');

// Why a waiting line needs a person, in the order a person should deal with it.
export const NEED_TEXT = {
  check: 'Look at this one: the reader was not sure',
  twin: 'May already be in your books',
  closed: 'Its date is in a closed period',
  ask: 'You asked to be asked about this payee',
  direction: 'The money went the other way last time',
  held: 'You undid this one earlier',
  new: 'Nobody has said what this is yet',
};
const NEED_ORDER = ['check', 'twin', 'closed', 'ask', 'direction', 'held', 'new'];
export const needsOf = (line) => NEED_ORDER.filter((n) => (line.needs || []).includes(n));
export const isReady = (line) => !line.result && (line.needs || []).length === 0;
// One tap is enough for these; 'check' and 'twin' have to be answered first.
export const canApprove = (line) => !line.result && !(line.needs || []).some((n) => n === 'check' || n === 'twin' || n === 'closed');

const UNSURE = { date: 'the date', amount: 'the amount', payee: 'the description', reader: 'part of the line' };
export function unsureText(line) {
  const u = (line.unsure || []).map((k) => UNSURE[k]).filter(Boolean);
  if (!line.line_date) u.unshift('the date (none could be read)');
  if (!Number(line.amount)) u.unshift('the amount (none could be read)');
  const what = [...new Set(u)];
  const base = what.length ? `Check ${what.join(' and ')} against the statement.` : 'Check it against the statement.';
  return line.unsure_note ? `${base} The reader said: ${line.unsure_note}` : base;
}

// What a line (or a rule) will be filed as, in a few words.
export function filedAs(x, categories, { amount = null } = {}) {
  const name = (id) => (categories.find((c) => c.id === id) || {}).name || 'a category that is gone';
  if (x.transfer_account) return `Transfer ${amount != null && Number(amount) > 0 ? 'from' : 'to'} ${x.transfer_account}`;
  if (x.is_personal) return 'Personal, not business';
  if (Array.isArray(x.parts) && x.parts.length) {
    return 'Split: ' + x.parts.map((p) => `${name(p.category_id)} ${p.amount != null ? fmtUSDCents(Math.abs(p.amount)) : Math.round(Number(p.pct) * 100) + '%'}`).join(', ');
  }
  if (x.tax_category_id) return name(x.tax_category_id);
  return '';
}

export const SOURCE_TEXT = { rule: 'as last time', ai: 'suggested', person: 'your choice', account: 'a personal account' };

// One rule, in a plain sentence.
export function ruleSentence(rule, categories) {
  const what = filedAs(rule, categories) || 'nothing remembered yet';
  const only = [rule.amount != null ? `only when the amount is ${fmtUSDCents(Math.abs(rule.amount))}` : '', rule.account_key ? `only from ${rule.account_key}` : ''].filter(Boolean).join(', ');
  const how = rule.always_ask ? 'Always asks you.' : rule.trusted ? 'Files it without asking.' : 'Proposes it and waits for your OK.';
  return { what: only ? `${what} (${only})` : what, how };
}

// How the statement adds up, in a sentence.
export function tieSentence(tie, via) {
  if (!tie) return { tone: 'plain', text: '' };
  const m = (n) => fmtUSDCents(Number(n));
  if (tie.proven) return { tone: 'good', text: `Adds up: ${m(tie.opening)} at the start, ${m(tie.lines_total)} of lines, ${m(tie.closing)} at the end.` };
  if (tie.has_balances) {
    const off = `Off by ${m(Math.abs(tie.off_by))}: the lines come to ${m(tie.lines_total)}, but the balances say ${m(Number(tie.closing) - Number(tie.opening))}.`;
    return tie.accepted ? { tone: 'warn', text: off + ' An owner let it through as it is.' } : { tone: 'bad', text: off + ' Nothing from this statement is in the books yet.' };
  }
  if (via === 'scan') return tie.accepted ? { tone: 'warn', text: 'No balances could be read, so this statement is not proven. An owner let it through.' }
    : { tone: 'bad', text: 'The starting and ending balances could not be read, so nothing can be proven yet. Type them in from the statement.' };
  return { tone: 'warn', text: 'Not checked against the bank\'s balances. Add the starting and ending balance to prove nothing is missing or doubled.' };
}

// Post everything a confirmed rule covers, a batch at a time (a signed-in
// request may run for eight seconds, so a long statement takes a few).
export async function settleAll(importId) {
  let total = 0;
  for (let i = 0; i < 40; i++) {
    const { data, error } = await supabase.rpc('statement_settle_next', { p_import: importId });
    if (error) return { total, error };
    total += (data && data.posted) || 0;
    if (!data || !data.more) break;
  }
  return { total, error: null };
}

// After a correction: the two questions it can raise. Returns true when
// earlier entries were changed (the screen should read them again).
//   rule = { rule_id, payee, past, suggest_always_ask }
export async function followUp(rule) {
  if (!rule || !rule.rule_id) return false;
  let changed = false;
  if (rule.past > 0) {
    const yes = await confirmDialog(
      `${rule.payee} is now filed a new way. ${rule.past === 1 ? 'One earlier entry was' : rule.past + ' earlier entries were'} filed the old way. Change ${rule.past === 1 ? 'it' : 'them'} too?`,
      { confirmLabel: rule.past === 1 ? 'Change it too' : 'Change them too', cancelLabel: 'Leave as they are', danger: false });
    const { data, error } = await supabase.rpc('rule_fix_past', { p_rule: rule.rule_id, p_do: yes });
    if (error) notifyError('The earlier entries were not changed: ' + error.message);
    else if (yes) { changed = true; notify(`${data} earlier ${data === 1 ? 'entry' : 'entries'} changed`, 'success'); }
  }
  if (rule.suggest_always_ask) {
    const yes = await confirmDialog(`${rule.payee} has now been filed more than one way. Should PrismOS always ask you about ${rule.payee}, instead of filing it on its own?`,
      { confirmLabel: 'Always ask me', cancelLabel: 'No, keep filing it', danger: false });
    const { error } = await supabase.rpc('rule_save', { p_rule: rule.rule_id, p_patch: yes ? { always_ask: true } : { dismiss_suggestion: true } });
    if (error) notifyError('That did not save: ' + error.message);
  }
  return changed;
}

// After an entry is corrected in the checkbook. Returns the entries the rule
// re-filed (so the register can show them), or an empty list.
export async function askAboutRule(txId) {
  const { data, error } = await supabase.rpc('rule_offer', { p_tx: txId });
  if (error || !data) return [];
  const changed = await followUp(data);
  if (!changed) return [];
  const { data: rows } = await supabase.from('transactions').select('*').eq('rule_id', data.rule_id).eq('is_archived', false);
  return rows || [];
}

// The originals are private: a link that works for an hour.
export async function openOriginal(path) {
  const { data, error } = await supabase.storage.from('statements').createSignedUrl(path, 3600);
  if (error || !data || !data.signedUrl) { notifyError('The original could not be opened' + (error ? ': ' + error.message : '')); return; }
  window.open(data.signedUrl, '_blank', 'noopener');
}

// Category choices grouped the way a person thinks of them. `shared` books
// have no "personal": money an owner took goes under an owners' category.
export function categoryGroups(categories) {
  const kinds = [['income', 'Money in'], ['expense', 'Money out'], ['held', 'Held for others'], ['equity', 'Owners'], ['asset', 'Owned, or owed to us'], ['liability', 'Owed'], ['other', 'Other']];
  return kinds.map(([kind, label]) => ({ kind, label, rows: categories.filter((c) => (c.kind || 'expense') === kind) })).filter((g) => g.rows.length);
}
