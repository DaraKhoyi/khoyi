// moneyRegister.js — the thinking behind the Money screen, kept apart from the
// drawing so it can be checked without a browser (smoke/money_register_guard.mjs).
//
// Dara, 5 Oct 2026: Money opens on a check register. Type a payee and Prism
// offers the match from past entries and fills the rest; the date stays where
// it was put until it is changed back; the journal reads newest first with a
// search that finds things the way a person remembers them; each account shows
// its balance.
//
// Dates here are 'YYYY-MM-DD' text and are never run through new Date(text):
// that reads the text as midnight in London and shows yesterday in Tampa.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const parts = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };

export const accountKey = (s) => String(s || '').trim().toLowerCase();
export const monthLabel = (iso) => { const p = parts(iso); return p ? `${MONTHS[p.m - 1]} ${p.y}` : 'No date'; };
export const shortDate = (iso) => { const p = parts(iso); return p ? `${MONTHS[p.m - 1].slice(0, 3)} ${p.d}` : ''; };
export function longDate(iso) {
  const p = parts(iso); if (!p) return '';
  const dow = new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
  return `${DAYS[dow]}, ${MONTHS[p.m - 1].slice(0, 3)} ${p.d}, ${p.y}`;
}
// "1,250.50", "$89", "89.5" -> a positive number, or null when it is not an amount.
export function parseAmount(text) {
  const s = String(text ?? '').replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d{0,2}$/.test(s) || s === '' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Newest first; two entries on one day keep the order they were written in.
export function sortNewest(list) {
  return [...list].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

// The payees already in the book that fit what has been typed so far.
// One row per payee, carrying that payee's most recent entry.
export function payeeMatches(transactions, typed, limit = 4) {
  const q = String(typed || '').trim().toLowerCase();
  if (q.length < 2) return [];
  const latest = new Map();
  for (const t of transactions) {
    const name = String(t.payee || '').trim();
    if (!name || t.is_archived) continue;
    const k = name.toLowerCase(), cur = latest.get(k);
    if (!cur || String(t.date || '') > String(cur.date || '') || (t.date === cur.date && String(t.created_at || '') > String(cur.created_at || ''))) latest.set(k, t);
  }
  const out = [];
  for (const [k, last] of latest) {
    const starts = k.startsWith(q), word = !starts && k.split(/[^a-z0-9]+/).some((w) => w.startsWith(q)), inside = !starts && !word && q.length >= 3 && k.includes(q);
    if (starts || word || inside) out.push({ payee: String(last.payee).trim(), last, rank: starts ? 0 : word ? 1 : 2 });
  }
  out.sort((a, b) => a.rank - b.rank || String(b.last.date || '').localeCompare(String(a.last.date || '')) || a.payee.localeCompare(b.payee));
  return out.slice(0, limit).map(({ payee, last }) => ({ payee, last }));
}

// What a past entry fills in. The date is NOT taken: the date box is the
// person's own and stays where they put it.
export function fillFrom(tx) {
  return {
    direction: Number(tx.amount) > 0 ? 'in' : 'out',
    amount: Math.abs(Number(tx.amount) || 0).toFixed(2),
    payee: String(tx.payee || '').trim(),
    scope: tx.scope === 'personal' ? 'personal' : 'business',
    taxCategoryId: tx.tax_category_id || '',
    personalBudgetLineId: tx.personal_budget_line_id || '',
    systemId: tx.lead_gen_system_id || '',
    description: tx.description || '',
    account: tx.account || '',
  };
}

// Search the way a person remembers: "stellar july", "visa 89", "marketing 2026".
// Every word typed must be found somewhere in the entry.
export function matchesSearch(t, query, names = {}) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const p = parts(t.date);
  const abs = Math.abs(Number(t.amount) || 0), fixed = abs.toFixed(2), whole = String(Math.trunc(abs));
  const text = [t.payee, t.description, t.account, names.category, names.system, names.personal, t.scope,
    Number(t.amount) > 0 ? 'income in deposit' : 'expense out',
    p ? `${MONTHS[p.m - 1]} ${p.y} ${t.date} ${p.m}/${p.d} ${p.m}/${p.d}/${p.y}` : ''].filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => {
    const n = w.replace(/[$,]/g, '');
    if (/^\d+(\.\d{0,2})?$/.test(n) && (n.includes('.') ? fixed.startsWith(n) : whole === n)) return true;
    return text.includes(w);
  });
}

// For ONE account's entries, newest first: what the account held after each.
// Worked backwards from today's balance, so it is right even when older
// entries are not loaded.
export function runningBalances(rowsNewestFirst, balanceNow) {
  const out = new Map(); let bal = Number(balanceNow) || 0;
  for (const t of rowsNewestFirst) { out.set(t.id, Math.round(bal * 100) / 100); bal -= Number(t.amount) || 0; }
  return out;
}

export function groupByMonth(rows) {
  const groups = [];
  for (const t of rows) {
    const key = String(t.date || '').slice(0, 7);
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.rows.push(t); else groups.push({ key, label: monthLabel(t.date), rows: [t] });
  }
  return groups;
}

// The date box remembers where it was left, for as long as it is still the same
// day. Tomorrow it is today again: yesterday's catch-up date is not carried into
// a new day without anyone choosing it.
const KEY = 'prism.money.entryDate';
export function readStickyDate(today, store) {
  try { const v = JSON.parse((store || window.sessionStorage).getItem(KEY) || 'null'); if (v && v.day === today && parts(v.date)) return v.date; } catch (_) { /* no storage: start at today */ }
  return today;
}
export function writeStickyDate(today, date, store) {
  try { const s = store || window.sessionStorage; if (date === today) s.removeItem(KEY); else s.setItem(KEY, JSON.stringify({ day: today, date })); } catch (_) { /* no storage: the date still holds while the screen is open */ }
}
