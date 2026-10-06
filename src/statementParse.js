// statementParse — turning a bank's file into plain lines, on the person's own
// device. Nothing here touches the books or the network.
//
// Dara, 6 Oct 2026 (accounting build, part 4): "CSV from any bank or card. The
// first upload from a bank asks the user to confirm which column is which. The
// layout is remembered, so the second upload asks nothing. OFX and QFX."
//
// A line is { date: 'YYYY-MM-DD', amount, text, memo, external_id, balance }.
// amount is from the account holder's side: money in is positive, money out
// (a purchase, a withdrawal, a charge on a card) is negative.

// ── CSV ────────────────────────────────────────────────────────────────────
// Every row as an array of cells. Quotes, doubled quotes and commas inside
// quotes are handled; a BOM is dropped.
export function parseTable(text) {
  let s = String(text || '');
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  const rows = [];
  let row = [], cell = '', i = 0, quoted = false;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') { quoted = false; i++; continue; }
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === '') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => String(c).trim())).filter((r) => r.some((c) => c !== ''));
}

const DATEISH = /^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/;

// Some banks put a few summary rows above the real header. The header is the
// first row with at least three filled cells whose NEXT row has a date in it.
export function headerIndex(rows) {
  for (let i = 0; i < Math.min(rows.length - 1, 30); i++) {
    const filled = rows[i].filter((c) => c !== '').length;
    if (filled >= 3 && !rows[i].some((c) => DATEISH.test(c)) && rows[i + 1].some((c) => DATEISH.test(c))) return i;
  }
  return 0;
}

// The shape CsvImportModal has always used: { headers, rows: [{header: cell}] }.
export function parseCSV(text) {
  const all = parseTable(text);
  if (all.length === 0) return { headers: [], rows: [] };
  const at = headerIndex(all);
  const headers = all[at];
  const rows = all.slice(at + 1).map((r) => {
    const o = {};
    headers.forEach((h, idx) => { o[h] = r[idx] || ''; });
    return o;
  });
  return { headers, rows };
}

// A money string: $, commas, (parentheses) or a trailing minus for negative,
// CR / DR suffixes. Returns a Number, or 0 when it is not a number.
export function parseAmount(raw) {
  if (raw == null || raw === '') return 0;
  let s = String(raw).trim();
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) { negative = true; s = s.slice(1, -1); }
  if (/\bDR$/i.test(s)) { negative = !negative; s = s.replace(/\s*DR$/i, ''); }
  s = s.replace(/\s*CR$/i, '').replace(/[$,\s]/g, '');
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); }
  if (s.startsWith('-')) { negative = !negative; s = s.slice(1); }
  if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d*\.?\d+$/.test(s)) return 0;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

const pad = (v) => String(v).padStart(2, '0');
const realDay = (y, m, d) => {
  if (!(y >= 1990 && y <= 2200 && m >= 1 && m <= 12 && d >= 1)) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const fullYear = (y) => (String(y).length <= 2 ? (parseInt(y, 10) > 50 ? 1900 : 2000) + parseInt(y, 10) : parseInt(y, 10));

// A bank date as YYYY-MM-DD, or null. Month first unless told day first.
// Never falls back to the browser's own date reading: that guesses, and a
// guessed date is worse than none (the line is then flagged for a person).
export function parseFlexibleDate(raw, formatHint) {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return realDay(+m[1], +m[2], +m[3]) ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
  m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{6})?(\.\d+)?\s*(\[[^\]]*\])?$/);                      // OFX: 20260914...
  if (m) return realDay(+m[1], +m[2], +m[3]) ? `${m[1]}-${m[2]}-${m[3]}` : null;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
  if (m) {
    const y = fullYear(m[3]);
    const mo = formatHint === 'dmy' ? +m[2] : +m[1], d = formatHint === 'dmy' ? +m[1] : +m[2];
    return realDay(y, mo, d) ? `${y}-${pad(mo)}-${pad(d)}` : null;
  }
  m = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/);            // Sep 14, 2026
  if (m) {
    const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase()) + 1;
    return mo && realDay(+m[3], mo, +m[2]) ? `${m[3]}-${pad(mo)}-${pad(m[2])}` : null;
  }
  return null;
}

// Which header most likely means what.
export function guessColumn(headers, kind) {
  const lc = headers.map((h) => String(h).toLowerCase());
  const patterns = {
    date: [/^date$/, /trans.*date/, /posting.*date/, /^post.*date/, /eff.*date/, /trade.*date/, /date/],
    payee: [/^description$/, /^payee$/, /^merchant$/, /^name$/, /^detail/, /^memo$/, /transaction/, /description/],
    amount: [/^amount$/, /^total$/, /^debit.*credit/, /^transaction.*amount/, /^amount \(/, /amount/],
    debit: [/^debit$/, /^withdraw/, /^charges$/, /^outflow/, /^paid out/, /^payments$/, /debit/],
    credit: [/^credit$/, /^deposit/, /^inflow/, /^paid in/, /^payments rec/, /credit/],
    description: [/^memo$/, /^note$/, /^category$/, /^description$/],
    external_id: [/^reference/, /^transaction.*id$/, /^txn.*id$/, /^id$/, /^check.*number/, /^fitid$/],
    balance: [/^balance$/, /running bal/, /^available/, /balance/],
  };
  for (const re of (patterns[kind] || [])) {
    for (let i = 0; i < lc.length; i++) if (re.test(lc[i])) return headers[i];
  }
  return '';
}

// A file's layout is known by its header row.
export const headerSignature = (headers) => (headers || []).map((h) => String(h).toLowerCase().replace(/\s+/g, ' ').trim()).join('|');

// A first guess at which column is which. The person confirms it once.
export function autoMap(headers) {
  const debit = guessColumn(headers, 'debit'), credit = guessColumn(headers, 'credit');
  const amount = guessColumn(headers.filter((h) => h !== debit && h !== credit), 'amount');
  const payee = guessColumn(headers, 'payee');
  const memo = guessColumn(headers.filter((h) => h !== payee), 'description');
  return {
    date: guessColumn(headers, 'date'), payee, memo,
    mode: !amount && debit && credit ? 'split' : 'single',
    amount, debit, credit, flip: false, dmy: false,
    balance: guessColumn(headers, 'balance'),
    external_id: guessColumn(headers, 'external_id'),
  };
}

export const mapIsComplete = (map) => !!map && !!map.date && !!map.payee && (map.mode === 'split' ? !!(map.debit || map.credit) : !!map.amount);

const cents = (n) => Math.round(n * 100) / 100;

// Rows of the file as lines. A row with no date AND no amount is not a
// transaction (a blank or a footer) and is counted in `left`, not sent.
export function mapLines(rows, map) {
  const lines = [];
  let left = 0;
  for (const r of rows) {
    const rawDate = r[map.date], date = parseFlexibleDate(rawDate, map.dmy ? 'dmy' : null);
    let amount;
    if (map.mode === 'split') {
      const out = Math.abs(parseAmount(r[map.debit])), inn = Math.abs(parseAmount(r[map.credit]));
      amount = inn - out;
    } else {
      amount = parseAmount(r[map.amount]);
    }
    if (map.flip) amount = -amount;
    amount = cents(amount);
    const text = String(r[map.payee] || '').replace(/\s+/g, ' ').trim();
    if (!date && !amount) { left++; continue; }
    const memo = map.memo && map.memo !== map.payee ? String(r[map.memo] || '').trim() : '';
    const balRaw = map.balance ? String(r[map.balance] || '').trim() : '';
    lines.push({
      date, amount, text, memo: memo || null,
      external_id: map.external_id ? (String(r[map.external_id] || '').trim() || null) : null,
      balance: balRaw === '' ? null : cents(parseAmount(balRaw)),
    });
  }
  return { lines, left };
}

// Most lines on any statement are money going out. If most of a file's amounts
// are positive, it is very likely a card file that shows charges as positive.
export function looksFlipped(lines) {
  const real = lines.filter((l) => l.amount);
  if (real.length < 4) return false;
  return real.filter((l) => l.amount > 0).length / real.length > 0.65;
}

export function dateRange(lines) {
  let from = null, to = null;
  for (const l of lines) if (l.date) { if (!from || l.date < from) from = l.date; if (!to || l.date > to) to = l.date; }
  return { from, to };
}

// The balance before the first line and after the last, worked out from a
// running-balance column when the file has one and it is consistent with the
// amounts. Files come oldest-first or newest-first; both are tried.
export function balancesFromColumn(lines) {
  if (lines.length < 1 || lines.some((l) => l.balance == null)) return null;
  const check = (seq) => {
    let ok = 0;
    for (let i = 1; i < seq.length; i++) if (Math.abs(cents(seq[i - 1].balance + seq[i].amount) - seq[i].balance) < 0.005) ok++;
    return seq.length === 1 ? 1 : ok / (seq.length - 1);
  };
  const fwd = lines, back = [...lines].reverse();
  const f = check(fwd), b = check(back);
  const seq = f >= b ? fwd : back;
  if (Math.max(f, b) < 0.98) return null;
  return { opening: cents(seq[0].balance - seq[0].amount), closing: seq[seq.length - 1].balance };
}

// Does opening + lines = closing?
export function tieOf(lines, opening, closing) {
  const total = cents(lines.reduce((s, l) => s + (l.amount || 0), 0));
  if (opening == null || closing == null || opening === '' || closing === '') return { total, proven: false, offBy: null };
  const offBy = cents(Number(opening) + total - Number(closing));
  return { total, proven: offBy === 0, offBy };
}

// ── OFX / QFX / QBO ────────────────────────────────────────────────────────
const tag = (block, name) => {
  const m = new RegExp('<' + name + '>([^<\\r\\n]*)', 'i').exec(block);
  return m ? m[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;/g, "'").replace(/&quot;/g, '"') : '';
};

export const looksLikeOFX = (text) => /<OFX>/i.test(String(text || '').slice(0, 4000)) || /OFXHEADER/i.test(String(text || '').slice(0, 400));

// Money-in is positive and a card's balance owed is negative in OFX already,
// which is how the books count them.
export function parseOFX(text) {
  const s = String(text || '');
  const lines = [];
  const re = /<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>|$)/gi;
  let m;
  while ((m = re.exec(s))) {
    const b = m[1];
    const amount = cents(parseAmount(tag(b, 'TRNAMT')));
    const name = tag(b, 'NAME') || tag(b, 'PAYEE'), memo = tag(b, 'MEMO'), check = tag(b, 'CHECKNUM');
    const text = (name || memo || (check ? 'CHECK ' + check : '')).replace(/\s+/g, ' ').trim();
    lines.push({
      date: parseFlexibleDate(tag(b, 'DTPOSTED')), amount,
      text: !name && check && memo ? `CHECK ${check}` : text,
      memo: memo && memo !== name ? memo : null,
      external_id: tag(b, 'FITID') || null, balance: null,
    });
  }
  const bal = /<LEDGERBAL>([\s\S]*?)(?=<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>|<\/CCSTMTRS>|$)/i.exec(s);
  const closing = bal && tag(bal[1], 'BALAMT') !== '' ? cents(parseAmount(tag(bal[1], 'BALAMT'))) : null;
  return {
    lines, closing,
    closingAsOf: bal ? parseFlexibleDate(tag(bal[1], 'DTASOF')) : null,
    from: parseFlexibleDate(tag(s, 'DTSTART')), to: parseFlexibleDate(tag(s, 'DTEND')),
    isCard: /<CCSTMTRS>|<CREDITCARDMSGSRSV1>/i.test(s),
  };
}

// ── The file itself ────────────────────────────────────────────────────────
export async function sha256Hex(buffer) {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  const d = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// What kind of upload a file is, by its name (and, for text, its start).
export function fileKind(name, head = '') {
  const ext = (String(name || '').split('.').pop() || '').toLowerCase();
  if (['ofx', 'qfx', 'qbo'].includes(ext) || looksLikeOFX(head)) return 'ofx';
  if (['csv', 'txt', 'tsv'].includes(ext)) return 'csv';
  if (ext === 'pdf' || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif'].includes(ext)) return 'scan';
  return null;
}

export const safeFileName = (name) => String(name || 'file').replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80) || 'file';
