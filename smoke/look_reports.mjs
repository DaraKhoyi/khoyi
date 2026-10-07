// look_reports.mjs — screenshots of the reports and of reconciling an account,
// at phone width and at large type, so they can be LOOKED AT before a change
// to them ships. Usage as look_books.mjs (static server on :4173, SUPABASE_*).
// Makes one throwaway person and one throwaway team book, and removes them.
// Not part of the gate; smoke/reports_guard.mjs is what blocks.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY;
const OUT = process.env.LOOK_DIR || '/home/claude/shots'; fs.mkdirSync(OUT, { recursive: true });
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const svc = async (method, p, body) => { const r = await fetch(`${URL_}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p}: ${t.slice(0, 300)}`); return t ? JSON.parse(t) : null; };
const made = []; let bookId = null, browser = null;
try {
  const email = `smoke_reports_look_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
  const u = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error('no user'); made.push(u.id);
  await fetch(`${URL_}/rest/v1/user_settings`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: u.id, onboarding_complete: true, display_name: 'Avery Owner' }) });
  await svc('POST', 'accounting_access', { user_id: u.id, note: 'look test' });
  const bk = (await svc('POST', 'books', { kind: 'team', template: 'property_management', name: 'Look Test Property Team', starts_on: '2026-01-01', principal_user_id: u.id }))[0]; bookId = bk.id;
  await svc('POST', 'rpc/book_seed_categories', { p_book: bk.id }); await svc('POST', 'rpc/ensure_personal_book', { p_user: u.id });
  await svc('POST', 'book_access', [{ book_id: bk.id, user_id: u.id, role: 'owner' }]);
  const cats = await svc('GET', `tax_categories?book_id=eq.${bk.id}&select=id,name`);
  const cat = (n) => (cats.find((c) => c.name === n) || {}).id || null;
  const rows = [
    ['2026-07-03', 4200, 'Sunrise Villas HOA', 'Management Fees', 'Operating Checking'], ['2026-07-12', -389.5, 'Buildium', 'Software & Subscriptions', 'Operating Checking'],
    ['2026-08-01', 4200, 'Sunrise Villas HOA', 'Management Fees', 'Operating Checking'], ['2026-08-09', -389.5, 'Buildium', 'Software & Subscriptions', 'Operating Checking'],
    ['2026-08-20', -1200, 'Tina Danielson', 'Team Splits & Commissions Paid', 'Operating Checking'], ['2026-09-01', 4350, 'Sunrise Villas HOA', 'Management Fees', 'Operating Checking'],
    ['2026-09-02', 2150, 'Rent - 1418 Oak Vine Dr', 'Rent Collected for Owners', 'Escrow'], ['2026-09-03', -1890, 'Owner payout - J. Suarez', 'Owner Payouts', 'Escrow'],
    ['2026-09-10', -389.5, 'Buildium', 'Software & Subscriptions', 'Operating Checking'], ['2026-09-18', 950, 'Leasing fee - 22 Palm Ct', 'Leasing Fees', 'Operating Checking'],
    ['2026-09-27', -212.4, 'Home Depot', 'Office Expense', 'Team Visa'], ['2026-09-29', -75, 'Check 1042', 'Other Expenses', 'Operating Checking'],
    ['2025-09-10', 3900, 'Sunrise Villas HOA', 'Management Fees', 'Operating Checking'], ['2025-09-12', -350, 'Buildium', 'Software & Subscriptions', 'Operating Checking'],
  ].map(([date, amount, payee, c, account]) => ({ book_id: bk.id, date, amount, payee, account, scope: 'business', tax_category_id: cat(c), entered_by: u.id }));
  await svc('POST', 'transactions', rows);
  await svc('POST', 'transactions', [{ book_id: bk.id, date: '2026-09-15', amount: -640, scope: 'business', account: 'Operating Checking', transfer_account: 'Team Visa', description: 'Card payment', entered_by: u.id }]);
  await svc('PATCH', `money_accounts?book_id=eq.${bk.id}&name=eq.Escrow`, { starting_balance: 48000, kind: 'escrow' });
  await svc('PATCH', `money_accounts?book_id=eq.${bk.id}&name=eq.Operating%20Checking`, { starting_balance: 12500 });

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  for (const pass of [{ tag: 'phone', zoom: 1 }, { tag: 'large', zoom: 1.35 }]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 2600 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
    await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password); await page.click('button:has-text("Sign In")');
    await page.waitForFunction(() => typeof window.__setView === 'function' && !document.querySelector('.auth-screen, .loading-screen'), { timeout: 40000 });
    for (const label of ['Skip for now', 'Not now', 'Got it']) { try { await page.click(`button:has-text("${label}")`, { timeout: 1500 }); await page.waitForTimeout(500); } catch (_) {} }
    if (pass.zoom !== 1) await page.evaluate((z) => { document.documentElement.style.fontSize = (16 * z) + 'px'; }, pass.zoom);
    const shot = async (name) => { await page.waitForTimeout(1300); await page.screenshot({ path: `${OUT}/rp_${pass.tag}_${name}.png`, fullPage: true }); };
    await page.evaluate(() => window.__setView('finance')); await page.waitForSelector('[data-testid="book-bar"]', { timeout: 20000 });
    await page.click('[data-testid="book-switch"]'); await page.click('[data-testid="book-pick"]:has-text("Look Test Property Team")');
    await page.waitForSelector('[data-testid="money-register"]', { timeout: 20000 });
    await page.click('.seg-btn:has-text("Reports")'); await page.waitForSelector('[data-testid="book-reports"]');
    await page.click('[data-testid="report-pnl"]'); await page.waitForSelector('[data-testid="report-table"]'); await shot('1_pnl');
    await page.click('.st-check input'); await page.waitForTimeout(800); await shot('2_pnl_beside_last_year');
    await page.selectOption('[data-testid="report-by"]', 'month'); await shot('3_pnl_by_month');
    await page.click('[data-testid="report-standing"]'); await shot('4_standing');
    await page.click('[data-testid="report-cash"]'); await shot('5_cash_flow');
    await page.click('[data-testid="report-held"]'); await shot('6_held_for_others');
    await page.click('[data-testid="report-trial"]'); await shot('7_trial_balance');
    await page.click('[data-testid="report-gl"]'); await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/rp_${pass.tag}_8_general_ledger.png`, clip: { x: 0, y: 0, width: 390, height: 1800 } });
    await page.click('[data-testid="report-reconcile"]'); await page.waitForSelector('[data-testid="reconcile-account"]'); await shot('9_reconcile_accounts');
    if (pass.tag === 'phone') {
      await page.click('[data-testid="reconcile-account"]:has-text("Operating Checking")'); await page.waitForSelector('[data-testid="reconcile-start"]');
      const tickAllBut = async () => {
        await page.click('text=/Tick all/'); await page.waitForTimeout(1800);
        await page.click('.mr-chips button:text-matches("^Ticked")'); await page.click('[data-testid="reconcile-item"]:has-text("Check 1042") input'); await page.waitForTimeout(1800);
      };
      const startWith = async (bal) => {
        await page.fill('[data-testid="reconcile-start"] input[type="date"]', '2026-09-30'); await page.fill('[data-testid="reconcile-start"] input.amt', bal);
      };
      // First pass only to learn what the bank would say: everything but the uncashed check.
      await startWith('1.00'); await page.click('[data-testid="reconcile-start"] button[type="submit"]'); await page.waitForSelector('[data-testid="reconcile-item"]');
      await tickAllBut();
      const bank = (await page.locator('[data-testid="reconcile-numbers"] div:nth-child(2) b').innerText()).replace(/[$,]/g, '');
      await page.click('.mr-go .clear'); await page.click('button:has-text("Discard it")'); await page.waitForSelector('[data-testid="reconcile-account"]');
      await page.click('[data-testid="reconcile-account"]:has-text("Operating Checking")'); await page.waitForSelector('[data-testid="reconcile-start"]');
      await startWith(bank); await shot('10_reconcile_start');
      await page.click('[data-testid="reconcile-start"] button[type="submit"]'); await page.waitForSelector('[data-testid="reconcile-item"]'); await shot('11_reconcile_ticking');
      await tickAllBut(); await shot('12_reconcile_agrees');
      await page.click('[data-testid="reconcile-finish"]'); await page.waitForSelector('[data-testid="report-table"]'); await shot('13_reconcile_finished');
    } else {
      await page.click('.rc-hist'); await page.waitForSelector('[data-testid="report-table"]'); await shot('13_reconcile_finished');
    }
    console.log(pass.tag, 'overflowX', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'errors', JSON.stringify(errors.slice(0, 6)));
    await ctx.close();
  }
  await browser.close();
} catch (e) { console.error('LOOK FAILED', e); process.exitCode = 1; }
finally {
  try { if (browser) await browser.close(); } catch (_) {}
  try { if (bookId) { await svc('DELETE', `book_reconciliations?book_id=eq.${bookId}`); await svc('DELETE', `transactions?book_id=eq.${bookId}`); await svc('DELETE', `books?id=eq.${bookId}`); } } catch (e) { console.error('cleanup book', String(e).slice(0, 200)); }
  for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
}
