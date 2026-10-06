// books.js — the thinking behind "whose books am I in", kept apart from the
// drawing so it can be checked without a browser (smoke/books_guard.mjs).
//
// Dara, 6 Oct 2026: Dara, Josh and Alexander keep the brokerage's books in
// PrismOS; each person keeps their own; a team's leader controls the team's,
// with an assistant who can be switched on and off. An agent's own books are
// the agent's: the brokerage sees only the brokerage books.
//
// A BOOK is one complete, separate set of accounts. Every money row belongs to
// exactly one. The database decides who may read or change a book (row-level
// security on every table, supabase/sql/2026-10-06b_books.sql); nothing in
// this file grants anything. It only says what to draw and what to ask for.
//
// ONE RULE, ONE PLACE: every Money screen that reads or writes rows goes
// through inBook() and stamp() below. A screen that filters by user_id on its
// own would show a person their OWN books while the bar says the brokerage's.

export const ROLES = ['owner', 'admin', 'assistant', 'read_only'];
export const ROLE_LABEL = { owner: 'Owner', admin: 'Admin', assistant: 'Assistant', read_only: 'Read-only' };
export const ROLE_MEANS = {
  owner: 'Everything, including who has access.',
  admin: 'Everything, except changing an owner.',
  assistant: 'Enter, import, categorize and run reports.',
  read_only: 'Look and export. Changes nothing.',
};

// What each role may do. The database enforces the same table; this copy only
// decides which buttons to draw.
const MAY = {
  read: ['owner', 'admin', 'assistant', 'read_only'],
  write: ['owner', 'admin', 'assistant'],
  accounts: ['owner', 'admin'],     // bank account settings: starting balance, kind of account
  people: ['owner', 'admin'],       // who has access
  close: ['owner', 'admin'],        // close or reopen a period
};
// `book` is null on a phone where the book list could not be read: Money then
// works exactly as it always has, on the person's own rows.
export function can(book, what) {
  if (!book) return what !== 'people' && what !== 'close';
  return (MAY[what] || []).includes(book.role);
}

export const isOwnBook = (book) => !book || !!book.is_mine;
export function bookTitle(book) {
  if (!book || book.is_mine) return 'My books';
  return book.kind === 'personal' ? `${book.label}’s books` : book.label;
}
export function bookKind(book) {
  if (!book || book.is_mine) return 'Yours';
  return book.kind === 'brokerage' ? 'Brokerage' : book.kind === 'team' ? 'Team' : 'Personal';
}

// What a new row carries, and which rows a screen asks for.
export const stamp = (book, userId) => (book ? { book_id: book.id } : { user_id: userId });
export const inBook = (query, book, userId) => (book ? query.eq('book_id', book.id) : query.eq('user_id', userId));

// Which book opens. `want` is a one-time request ("open the brokerage's");
// otherwise the one this person was last in on this phone, else their own.
export function chooseBook(books, { remembered = null, want = null } = {}) {
  if (!books || !books.length) return null;
  if (want) { const w = books.find((b) => b.kind === want); if (w) return w; }
  return books.find((b) => b.id === remembered) || books.find((b) => b.is_mine) || books[0];
}
// The bar is drawn for the people this is switched on for, and for anyone who
// has been put on someone else's books. Everyone else sees Money as it was.
export const showBookBar = (state) => !!state && (!!state.enabled || (state.books || []).length > 1);

const KEY = (uid) => `prism.books.current.${uid}`;
export function readRemembered(uid, store) {
  try { return (store || window.localStorage).getItem(KEY(uid)) || null; } catch (_) { return null; }
}
export function writeRemembered(uid, id, store) {
  try { const s = store || window.localStorage; if (id) s.setItem(KEY(uid), id); else s.removeItem(KEY(uid)); } catch (_) { /* no storage: the choice holds while the screen is open */ }
}

// The database refused because of who is asking, not because of what was sent.
export const isDenied = (error) => !!error && (error.code === '42501' || /row-level security|permission denied/i.test(String(error.message || '')));

// ── the access list ────────────────────────────────────────────────────────
// Roles the signed-in person may hand out. Mirrors book_seat_check() in SQL.
export const rolesICanGive = (myRole) => (myRole === 'owner' ? ROLES : myRole === 'admin' ? ['admin', 'assistant', 'read_only'] : []);
// May I change this seat at all (its role, its switch, remove it)?
export function canChangeSeat(myRole, seat) {
  if (!seat || seat.is_book_owner) return false;            // a person's own books: they always stay the owner
  if (myRole === 'owner') return true;
  return myRole === 'admin' && seat.role !== 'owner';
}
export function seatStatus(seat) {
  if (seat.waiting_for === 'email') return 'Needs an email address';
  if (seat.waiting_for === 'sign_in') return 'Waiting for their first sign-in';
  if (!seat.is_active && seat.awaiting_ok) return 'Signed in. Switch on to give access';
  return seat.is_active ? 'On' : 'Switched off';
}
// One plain sentence per line of the access record.
export function historyLine(h) {
  const who = h.who || 'someone', by = h.by || 'Someone', role = ROLE_LABEL[h.detail && (h.detail.role || h.detail.to)] || '';
  switch (h.action) {
    case 'book_created': return `${who}: books opened`;
    case 'access_granted': return `${by} added ${who}${role ? ' as ' + role : ''}`;
    case 'access_claimed': return `${who} signed in and took their seat${role ? ' as ' + role : ''}`;
    case 'access_on': return `${by} switched ${who} on`;
    case 'access_off': return `${by} switched ${who} off`;
    case 'access_role': return `${by} changed ${who} to ${role}`;
    case 'access_removed': return `${by} removed ${who}`;
    case 'closed': return `${by} closed the books through ${longDay(h.detail && h.detail.to)}`;
    case 'reopened': return h.detail && h.detail.to ? `${by} reopened the books back to ${longDay(h.detail.to)}` : `${by} reopened the books`;
    default: return `${by}: ${h.action}`;
  }
}

// ── dates and periods ──────────────────────────────────────────────────────
// 'YYYY-MM-DD' text is never run through new Date(text): that is midnight in
// London and shows the day before in Tampa.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ymdParts = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
export function longDay(iso) { const p = ymdParts(iso); return p ? `${MONTHS[p.m - 1]} ${p.d}, ${p.y}` : ''; }
const pad = (n) => String(n).padStart(2, '0');
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const PERIODS = [['month', 'This month'], ['last', 'Last month'], ['year', 'This year'], ['lastyear', 'Last year'], ['all', 'All time']];
export function periodRange(id, today) {
  const p = ymdParts(today); if (!p) return { from: null, to: null };
  if (id === 'month') return { from: `${p.y}-${pad(p.m)}-01`, to: `${p.y}-${pad(p.m)}-${pad(lastDay(p.y, p.m))}` };
  if (id === 'last') { const y = p.m === 1 ? p.y - 1 : p.y, m = p.m === 1 ? 12 : p.m - 1; return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDay(y, m))}` }; }
  if (id === 'year') return { from: `${p.y}-01-01`, to: `${p.y}-12-31` };
  if (id === 'lastyear') return { from: `${p.y - 1}-01-01`, to: `${p.y - 1}-12-31` };
  return { from: null, to: null };
}

// ── the summary ────────────────────────────────────────────────────────────
// book_summary() hands back money in and money out per category. This sorts
// it into what a person reads: what came in, what went out, what is left;
// and, kept apart so it is never mistaken for income, money held for others.
const cents = (n) => Math.round((Number(n) || 0) * 100) / 100;
export function summarize(lines) {
  const out = { income: [], expense: [], held: [], other: [], uncategorized: { entries: 0, money_in: 0, money_out: 0 } };
  for (const l of lines || []) {
    const row = { id: l.category_id, name: l.name, entries: l.entries, money_in: cents(l.money_in), money_out: cents(l.money_out) };
    if (l.kind === 'income') out.income.push({ ...row, amount: cents(row.money_in - row.money_out) });
    else if (l.kind === 'expense') out.expense.push({ ...row, amount: cents(row.money_out - row.money_in) });
    else if (l.kind === 'held') out.held.push(row);
    else if (l.kind === 'other') out.other.push(row);
    else { out.uncategorized.entries += l.entries; out.uncategorized.money_in = cents(out.uncategorized.money_in + row.money_in); out.uncategorized.money_out = cents(out.uncategorized.money_out + row.money_out); }
  }
  const sum = (rows, k) => cents(rows.reduce((s, r) => s + r[k], 0));
  out.totalIncome = sum(out.income, 'amount');
  out.totalExpense = sum(out.expense, 'amount');
  // Entries nobody has sorted yet still count: money in as income, money out as spending.
  out.net = cents(out.totalIncome - out.totalExpense + out.uncategorized.money_in - out.uncategorized.money_out);
  out.heldIn = sum(out.held, 'money_in'); out.heldOut = sum(out.held, 'money_out');
  out.heldNow = cents(out.heldIn - out.heldOut);
  out.empty = !(lines || []).length;
  return out;
}

// "Did I already enter this?" — the sentence shown before a second copy is saved.
export function duplicateSentence(d, fmt) {
  const p = ymdParts(d.date);
  const day = p ? `${MONTHS[p.m - 1].slice(0, 3)} ${p.d}` : '';
  return [day, d.payee || 'no payee', fmt(Math.abs(Number(d.amount) || 0)), d.account].filter(Boolean).join(' · ');
}

export const CATEGORY_KINDS = [['income', 'Money in'], ['expense', 'Money out'], ['held', 'Held for others'], ['other', 'Neither (transfers, draws, tax)']];
export const ACCOUNT_KINDS = [['bank', 'Bank account'], ['card', 'Credit card'], ['escrow', 'Escrow (held for others)'], ['cash', 'Cash'], ['other', 'Other']];
