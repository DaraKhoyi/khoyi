// look_books.mjs — screenshots of the book screens (the bar, the switcher, a
// shared book's register, reports and setup, the access list), at phone width
// and at large type, so they can be LOOKED AT before a change to them ships.
// smoke/look.mjs cannot reach these: they need two people and a shared book.
//
// Usage (static server on :4173, SUPABASE_URL / _ANON_KEY / _SERVICE_KEY set):
//   node smoke/look_books.mjs manager     # as the book's owner
//   node smoke/look_books.mjs helper      # as an assistant on it
// Makes two throwaway people and one throwaway team book, and removes them.
// Not part of the gate; smoke/books_guard.mjs is what blocks.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY, ANON = process.env.SUPABASE_ANON_KEY;
const OUT = process.env.LOOK_DIR || '/home/claude/shots'; fs.mkdirSync(OUT, { recursive: true });
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const svc = async (method, path, body) => { const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path}: ${t.slice(0, 300)}`); return t ? JSON.parse(t) : null; };
const made = []; let bookId = null;
const person = async (tag, name) => {
  const email = `smoke_books_${tag}_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
  const u = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error('no user ' + JSON.stringify(u).slice(0, 200));
  made.push(u.id);
  await fetch(`${URL_}/rest/v1/user_settings`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: u.id, onboarding_complete: true, display_name: name }) });
  return { id: u.id, email, password };
};
const mode = process.argv[2] || 'manager';
try {
  const a = await person('look_a', 'Avery Owner'), b = await person('look_b', 'Blake Helper');
  await svc('POST', 'accounting_access', { user_id: a.id, note: 'look test' });
  const bk = (await svc('POST', 'books', { kind: 'team', template: 'property_management', name: 'Look Test Property Team', starts_on: '2026-01-01', principal_user_id: a.id }))[0]; bookId = bk.id;
  await svc('POST', 'rpc/book_seed_categories', { p_book: bk.id }); await svc('POST', 'rpc/ensure_personal_book', { p_user: a.id });
  await svc('POST', 'book_access', [{ book_id: bk.id, user_id: a.id, role: 'owner' }]);
  await svc('POST', 'book_access', [{ book_id: bk.id, user_id: b.id, role: 'assistant' }]);
  await svc('POST', 'book_access', [{ book_id: bk.id, invite_email: 'tina.waiting@example.com', invite_name: 'Tina Danielson', role: 'owner' }]);
  await svc('POST', 'book_access', [{ book_id: bk.id, invite_name: 'Myra Torres', role: 'assistant' }]);
  const cats = await svc('GET', `tax_categories?book_id=eq.${bk.id}&select=id,name`);
  const cat = (n) => (cats.find((c) => c.name === n) || {}).id || null;
  const rows = [
    ['2026-10-01', 4200, 'Sunrise Villas HOA', 'Management Fees', 'Operating Checking'], ['2026-10-02', -389.5, 'Buildium', 'Software & Subscriptions', 'Operating Checking'],
    ['2026-10-02', 2150, 'Rent - 1418 Oak Vine Dr', 'Rent Collected for Owners', 'Escrow'], ['2026-10-03', -1890, 'Owner payout - J. Suarez', 'Owner Payouts', 'Escrow'],
    ['2026-10-03', -212.4, 'Home Depot', null, 'Team Visa'], ['2026-09-28', 950, 'Leasing fee - 22 Palm Ct', 'Leasing Fees', 'Operating Checking'],
    ['2026-09-21', -1200, 'Tina Danielson', 'Team Splits & Commissions Paid', 'Operating Checking'],
  ].map(([date, amount, payee, c, account], i) => ({ book_id: bk.id, date, amount, payee, account, scope: 'business', tax_category_id: cat(c), entered_by: i % 2 ? b.id : a.id }));
  await svc('POST', 'transactions', rows);
  await svc('POST', 'transactions', [{ book_id: bk.id, date: '2026-09-15', amount: -640, scope: 'business', account: 'Operating Checking', transfer_account: 'Team Visa', description: 'Card payment', entered_by: a.id }]);
  // The accounts opened themselves when the entries named them; give two a starting balance.
  await svc('PATCH', `money_accounts?book_id=eq.${bk.id}&name=eq.Escrow`, { starting_balance: 48000, kind: 'escrow' });
  await svc('PATCH', `money_accounts?book_id=eq.${bk.id}&name=eq.Operating%20Checking`, { starting_balance: 12500 });
  await svc('POST', 'transactions', [{ user_id: a.id, date: '2026-10-02', amount: -42.18, payee: 'Shell', scope: 'business', account: 'Biz Visa' }]);

  const who = mode === 'helper' ? b : a;
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const pass of [{ tag: 'phone', zoom: 1 }, { tag: 'large', zoom: 1.35 }]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
    await page.fill('input[type="email"]', who.email); await page.fill('input[type="password"]', who.password); await page.click('button:has-text("Sign In")');
    await page.waitForFunction(() => typeof window.__setView === 'function' && !document.querySelector('.auth-screen, .loading-screen'), { timeout: 40000 });
    for (const label of ['Skip for now', 'Not now', 'Got it']) { try { await page.click(`button:has-text("${label}")`, { timeout: 1500 }); await page.waitForTimeout(500); } catch (_) {} }
    if (pass.zoom !== 1) await page.evaluate((z) => { document.documentElement.style.fontSize = (16 * z) + 'px'; }, pass.zoom);
    const shot = async (name, full = true) => { await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/${mode}_${pass.tag}_${name}.png`, fullPage: full }); };
    await page.evaluate(() => window.__setView('finance')); await page.waitForSelector('[data-testid="book-bar"]', { timeout: 20000 });
    await shot('1_own');
    await page.click('[data-testid="book-switch"]'); await shot('2_picker', false);
    await page.click('[data-testid="book-pick"]:has-text("Look Test Property Team")');
    await page.waitForSelector('[data-testid="money-register"]', { timeout: 20000 }); await shot('3_shared_register');
    await page.evaluate(() => window.scrollTo(0, 900)); const sc = await page.evaluate(() => { const el = document.querySelector('.main-content') || document.scrollingElement; el.scrollTop = 900; return el.className + ':' + el.scrollTop; });
    await shot('3b_scrolled_bar_still_there', false); console.log(pass.tag, 'scroller', sc, 'bar top', await page.evaluate(() => Math.round(document.querySelector('[data-testid="book-bar"]').getBoundingClientRect().top)));
    if (mode === 'manager') {
      await page.evaluate(() => { const el = document.querySelector('.main-content'); el.scrollTop = 0; });
      await page.click('[data-testid="money-transfer"]'); await shot('3c_transfer_form', false);
      await page.click('[data-testid="money-row"]:has-text("Buildium")'); await page.waitForSelector('[data-testid="entry-more"]');
      await page.click('[data-testid="entry-more"]'); await page.click('[data-testid="entry-history-open"]'); await page.waitForSelector('[data-testid="entry-history"]');
      await page.evaluate(() => { const m = document.querySelector('.modal'); m.scrollTop = m.scrollHeight; }); await shot('3d_entry_more_history', false);
      await page.click('.modal button:has-text("Cancel")');
    }
    await page.click('.seg-btn:has-text("Reports")'); await page.waitForSelector('[data-testid="book-summary"]'); await page.waitForTimeout(1500); await shot('4_reports');
    await page.evaluate(() => { const el = document.querySelector('.main-content'); el.scrollTop = el.scrollHeight; }); await shot('4b_reports_where_things_stand', false);
    await page.click('.seg-btn:has-text("Setup")'); await page.waitForSelector('[data-testid="book-setup"]'); await page.waitForTimeout(1200); await shot('5_setup');
    if (mode === 'manager') {
      await page.click('[data-testid="book-people"]'); await page.waitForSelector('[data-testid="book-seat"]'); await shot('6_people', false);
      await page.click('text=Show the record of changes'); await page.waitForTimeout(1200);
      await page.evaluate(() => { const m = document.querySelector('[data-testid="book-access"]'); m.scrollTop = m.scrollHeight; }); await shot('7_people_bottom', false);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(pass.tag, 'overflowX', overflow, 'errors', JSON.stringify(errors.slice(0, 6)));
    await ctx.close();
  }
  await browser.close();
} catch (e) { console.error('LOOK FAILED', e); process.exitCode = 1; }
finally {
  try { if (bookId) { await svc('DELETE', `transactions?book_id=eq.${bookId}`); await svc('DELETE', `books?id=eq.${bookId}`); } } catch (e) { console.error('cleanup book', String(e).slice(0, 200)); }
  for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
}
