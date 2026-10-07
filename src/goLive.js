// goLive — "can these books be relied on yet?", as a short list a person can
// act on. Pure, so a guard can import it under plain node.
//
// Dara, accounting build prompt part 6: the definition of done. Each line here
// is one of its tests, answered from what is actually in the books
// (book_go_live() in the database). A line is done only when the books show
// it; nothing is marked done because someone said so.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ''; };
const list = (names) => (names.length <= 2 ? names.join(' and ') : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1]);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// today: YYYY-MM-DD. An account counts as reconciled when it is finished through a day in the last 45.
export function goLiveItems(d, today) {
  if (!d) return [];
  const out = [];
  const people = d.people || [], accounts = d.accounts || [], w = d.waiting || {};
  const on = people.filter((p) => p.on);
  const notIn = on.filter((p) => !p.signed_in);
  const noEmail = notIn.filter((p) => !p.has_email);
  out.push({ key: 'people', ok: notIn.length === 0, title: 'Everyone on the list can get in',
    detail: notIn.length === 0 ? (on.length === 1 ? 'One person is on these books and has signed in.' : `${on.length} people are on these books and each has signed in.`)
      : `${list(notIn.map((p) => p.who))} ${notIn.length === 1 ? 'has' : 'have'} a seat but ${notIn.length === 1 ? 'has' : 'have'} not signed in.${noEmail.length ? ` ${list(noEmail.map((p) => p.who))} ${noEmail.length === 1 ? 'has' : 'have'} no email on the seat, so it cannot open: add it under People.` : ''}` });

  const banks = accounts.filter((a) => a.kind !== 'card');
  out.push({ key: 'accounts', ok: banks.length > 0, title: 'The bank accounts are here',
    detail: banks.length ? `${list(accounts.map((a) => a.account))}.` : accounts.length ? `Only ${list(accounts.map((a) => a.account))} so far. Add each bank account under Accounts below, with what it held on ${day(d.book && d.book.starts_on) || 'the first day'}.` : 'No accounts yet. Add each bank account and card under Accounts below.' });

  const noSt = accounts.filter((a) => !Number(a.statements));
  out.push({ key: 'statements', ok: accounts.length > 0 && noSt.length === 0, title: 'Statements are in for every account',
    detail: !accounts.length ? 'Nothing to bring in until the accounts are here.' : noSt.length ? `None yet for ${list(noSt.map((a) => a.account))}. Bring them in on the Add tab, from ${day(d.book && d.book.starts_on) || 'the start'} to now.` : 'Every account has statements in.' });

  const bw = d.both_ways || [];
  const proved = bw.find((x) => Number(x.caught) > 0 && Number(x.added_twice) === 0);
  const doubled = bw.find((x) => Number(x.added_twice) > 0);
  out.push({ key: 'both_ways', ok: !!proved && !doubled, title: 'One month brought in twice, with nothing doubled',
    detail: doubled ? `${doubled.account}, ${day(doubled.from)} to ${day(doubled.to)}: the scan added ${plural(doubled.added_twice, 'line', 'lines')} the file had already brought in. Look at that statement on the Add tab.`
      : proved ? `${proved.account}, ${day(proved.from)} to ${day(proved.to)}: brought in as a file and again as a scan. The second time ${plural(proved.caught, 'line was', 'lines were')} recognized as already there and nothing was added twice.`
        : 'Not done yet. Take one month of one account, bring it in as a file from the bank (CSV or OFX), then photograph or scan the same statement and bring that in too. The second time should add nothing.' });

  const r = d.rules || {};
  out.push({ key: 'rules', ok: Number(r.filed_for_you) > 0, title: 'A payee you filed once was filed for you the next time',
    detail: Number(r.filed_for_you) > 0 ? `${plural(r.filed_for_you, 'statement line has', 'statement lines have')} been filed by ${plural(r.confirmed, 'rule', 'rules')} you confirmed. They are listed under Rules on the Add tab.`
      : Number(r.confirmed) > 0 ? `${plural(r.confirmed, 'rule is', 'rules are')} confirmed. The next statement with one of those payees will show it working.` : 'Not yet. Approve a statement, then bring in the next one: the payees you filed should be filed for you.' });

  const cut = (() => { const t = new Date(String(today) + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 45); return t.toISOString().slice(0, 10); })();
  const stale = accounts.filter((a) => !a.reconciled_through || a.reconciled_through < cut);
  out.push({ key: 'reconciled', ok: accounts.length > 0 && stale.length === 0, title: 'Every account reconciles to the cent',
    detail: !accounts.length ? 'Nothing to reconcile until the accounts are here.' : stale.length ? stale.map((a) => (a.reconciled_through ? `${a.account} is reconciled only through ${day(a.reconciled_through)}` : `${a.account} has never been reconciled`)).join('. ') + '. Reports, Reconcile.'
      : `All ${accounts.length} reconciled, the oldest through ${day(accounts.map((a) => a.reconciled_through).sort()[0])}.` });

  const waits = [Number(w.statement_lines) ? plural(w.statement_lines, 'statement line', 'statement lines') + ' to review' : '', Number(w.no_category) ? plural(w.no_category, 'entry', 'entries') + ' with no category' : '', Number(w.closings) ? plural(w.closings, 'closing part', 'closing parts') + ' that need a person' : ''].filter(Boolean);
  out.push({ key: 'waiting', ok: waits.length === 0 && Number(d.entries) > 0, title: 'Nothing is waiting for a person',
    detail: waits.length ? list(waits) + '.' : Number(d.entries) > 0 ? 'Nothing is waiting.' : 'Nothing is in these books yet.' });

  if (d.book && d.book.kind === 'brokerage') {
    out.push({ key: 'closings', ok: d.closings_on === true, title: 'Closings are being entered from the Gold Report',
      detail: d.closings_on === true ? 'On. Each closing that adds up is entered; the rest wait on the Closings tab.' : 'Off. Once the operating account is here, switch it on in the Closings tab.' });
  }
  out.push({ key: 'balanced', ok: Number(d.ledger_faults) === 0, title: 'The books balance',
    detail: Number(d.ledger_faults) === 0 ? 'Every entry balances and the accounts add up.' : `${plural(d.ledger_faults, 'fault', 'faults')} found underneath. Tell Dara before relying on any report.` });
  const cpa = on.some((p) => p.role === 'read_only');
  out.push({ key: 'cpa', ok: cpa, title: 'Your CPA can look',
    detail: cpa ? 'A read-only seat is on the list. Have your CPA review the categories and the first month-end before a tax return relies on these books.' : 'No read-only seat yet. Add your CPA under People as Read-only, and have them review the categories and the first month-end before a tax return relies on these books.' });
  return out;
}
export const goLiveCount = (items) => ({ done: items.filter((i) => i.ok).length, of: items.length });
