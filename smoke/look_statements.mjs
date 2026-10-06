// look_statements.mjs — screenshots of bringing a statement in and reviewing it
// (upload, column check, review, a possible duplicate, a split, Done for you,
// the rules, a scanned PDF), at phone width and at large type, so they can be
// LOOKED AT before a change to them ships.
//
// Usage (static server on :4173, SUPABASE_URL / _ANON_KEY / _SERVICE_KEY set):
//   node smoke/look_statements.mjs            # everything, including one real read of a PDF (about 1 cent)
//   node smoke/look_statements.mjs noscan     # skip the PDF
// Makes one throwaway person and one throwaway team book, and removes them and
// the files they uploaded. Not part of the gate; smoke/statements_guard.mjs is
// what blocks.
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY;
const OUT = process.env.LOOK_DIR || '/home/claude/shots'; fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'look-st-'));
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const svc = async (method, p, body) => { const r = await fetch(`${URL_}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p}: ${t.slice(0, 300)}`); return t ? JSON.parse(t) : null; };
const made = []; let bookId = null;
const scan = process.argv[2] !== 'noscan' && fs.existsSync(process.env.LOOK_PDF || '');

const csv1 = ['Date,Description,Amount,Running Bal.',
  '09/02/2026,"SQ *HOME DEPOT #6341 TAMPA FL",-50.25,12449.75', '09/03/2026,"BUILDIUM.COM 8885551212",-389.50,12060.25',
  '09/05/2026,"DEPOSIT SUNRISE VILLAS HOA",4200.00,16260.25', '09/09/2026,"THE HOME DEPOT 6341",-20.00,16240.25',
  '09/11/2026,"COSTCO WHSE #0333 BRANDON FL",-212.40,16027.85', '09/15/2026,"ONLINE TRANSFER TO TEAM VISA",-640.00,15387.85',
  '09/21/2026,"ZELLE PAYMENT TO TINA DANIELSON",-1200.00,14187.85', '09/28/2026,"DEPOSIT LEASING FEE 22 PALM CT",950.00,15137.85'].join('\n');
const csv2 = ['Date,Description,Amount,Running Bal.',
  '09/28/2026,"DEPOSIT LEASING FEE 22 PALM CT",950.00,15137.85', '10/02/2026,"SQ *HOME DEPOT #6341 TAMPA FL",-75.10,15062.75',
  '10/03/2026,"COSTCO WHSE #0333 BRANDON FL",-100.00,14962.75', '10/04/2026,"SQ *HOME DEPOT #6341 REFUND",20.00,14982.75',
  '10/05/2026,"PEST PATROL OF TAMPA 8135550101",-145.00,14837.75'].join('\n');
fs.writeFileSync(path.join(TMP, 'gulf-sept.csv'), csv1); fs.writeFileSync(path.join(TMP, 'gulf-oct.csv'), csv2);

try {
  const email = `smoke_statements_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
  const u = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error('no user ' + JSON.stringify(u).slice(0, 200));
  made.push(u.id);
  await fetch(`${URL_}/rest/v1/user_settings`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: u.id, onboarding_complete: true, display_name: 'Avery Owner' }) });
  await svc('POST', 'accounting_access', { user_id: u.id, note: 'look test' });
  const bk = (await svc('POST', 'books', { kind: 'team', template: 'property_management', name: 'Look Test Property Team', starts_on: '2026-01-01', principal_user_id: u.id }))[0]; bookId = bk.id;
  await svc('POST', 'rpc/book_seed_categories', { p_book: bk.id }); await svc('POST', 'rpc/ensure_personal_book', { p_user: u.id });
  await svc('POST', 'book_access', [{ book_id: bk.id, user_id: u.id, role: 'owner' }]);
  const cats = await svc('GET', `tax_categories?book_id=eq.${bk.id}&select=id,name`);
  const cat = (n) => (cats.find((c) => c.name === n) || {}).id || null;
  // One entry typed by hand that the September statement will also carry.
  await svc('POST', 'transactions', [{ book_id: bk.id, date: '2026-09-04', amount: -389.5, payee: 'Buildium', account: 'Operating Checking', scope: 'business', tax_category_id: cat('Software & Subscriptions'), entered_by: u.id }]);
  await svc('PATCH', `money_accounts?book_id=eq.${bk.id}&name=eq.Operating%20Checking`, { starting_balance: 12889.5 });

  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const open = async (zoom) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
    await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
    await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password); await page.click('button:has-text("Sign In")');
    await page.waitForFunction(() => typeof window.__setView === 'function' && !document.querySelector('.auth-screen, .loading-screen'), { timeout: 40000 });
    for (const label of ['Skip for now', 'Not now', 'Got it']) { try { await page.click(`button:has-text("${label}")`, { timeout: 1500 }); await page.waitForTimeout(500); } catch (_) {} }
    if (zoom !== 1) await page.evaluate((z) => { document.documentElement.style.fontSize = (16 * z) + 'px'; }, zoom);
    await page.evaluate(() => window.__setView('finance')); await page.waitForSelector('[data-testid="book-bar"]', { timeout: 20000 });
    await page.click('[data-testid="book-switch"]'); await page.click('[data-testid="book-pick"]:has-text("Look Test Property Team")');
    await page.waitForSelector('[data-testid="money-register"]', { timeout: 20000 });
    return { ctx, page, errors };
  };
  const hub = '[data-testid="statements-hub"]';
  const top = (page) => page.evaluate(() => { const el = document.querySelector('[data-testid="statements-hub"]'); if (el) el.scrollTop = 0; });

  { // ── the whole flow at phone size ──
    const { ctx, page, errors } = await open(1);
    let n = 0;
    const shot = async (name) => { await page.waitForTimeout(800); n += 1; const el = await page.$(hub); const file = `${OUT}/st_${String(n).padStart(2, '0')}_${name}.png`;
      if (el) { const h = await el.evaluate((e) => e.scrollHeight); await page.setViewportSize({ width: 390, height: Math.min(Math.max(h, 844), 5200) }); await page.waitForTimeout(250); await page.screenshot({ path: file }); await page.setViewportSize({ width: 390, height: 844 }); }
      else await page.screenshot({ path: file, fullPage: true }); };
    await page.click('button:has-text("Import a statement")'); await page.waitForSelector(hub); await shot('hub_empty');
    await page.click('[data-testid="statements-new"]'); await page.waitForSelector('[data-testid="statement-import"]'); await shot('import_start');
    await page.click('.st-import .mr-chips button:has-text("Operating Checking")');
    await page.setInputFiles('[data-testid="statement-file"]', path.join(TMP, 'gulf-sept.csv'));
    await page.waitForSelector('[data-testid="statement-columns"]'); await shot('import_columns_first_time');
    await page.click('[data-testid="statement-go"]'); await page.waitForSelector('[data-testid="statement-review"]', { timeout: 30000 });
    await page.waitForSelector('[data-testid="statement-line"]'); await page.waitForTimeout(9000); await top(page); await shot('review_first_upload');
    await page.click('[data-testid="statement-twin-same"]'); await page.waitForTimeout(1500);
    await page.click('[data-testid="statement-line"]:has-text("Home Depot") [data-testid="statement-line-change"]'); await page.waitForSelector('[data-testid="statement-line-editor"]');
    await page.selectOption('[data-testid="statement-line-category"]', { label: 'Office Expense' }); await shot('line_editor');
    await page.click('[data-testid="statement-line-save-approve"]'); await page.waitForTimeout(2500);
    await page.click('[data-testid="statement-line"]:has-text("Costco") [data-testid="statement-line-change"]'); await page.waitForSelector('[data-testid="statement-line-editor"]');
    await page.click('[data-testid="statement-line-editor"] .mr-dir button:has-text("Split")'); await page.waitForSelector('[data-testid="split-editor"]');
    const sel = await page.$$('[data-testid="split-editor"] select'), inp = await page.$$('[data-testid="split-editor"] input');
    await sel[0].selectOption({ label: 'Office Expense' }); await inp[0].fill('150.00'); await sel[1].selectOption({ label: 'Other Expenses' }); await inp[1].fill('62.40');
    await shot('line_editor_split');
    await page.click('[data-testid="statement-line-save-approve"]'); await page.waitForTimeout(2500);
    await page.click('[data-testid="statement-line"]:has-text("Online Transfer") [data-testid="statement-line-change"]'); await page.waitForSelector('[data-testid="statement-line-editor"]');
    await page.click('[data-testid="statement-line-editor"] .mr-dir button:has-text("Transfer")'); await page.fill('[data-testid="statement-line-editor"] input[list="st-accounts"]', 'Team Visa');
    await page.click('[data-testid="statement-line-save-approve"]'); await page.waitForTimeout(2500); await top(page); await shot('review_after_three_decisions');
    if (await page.$('[data-testid="statement-approve-all"]')) { await page.click('[data-testid="statement-approve-all"]'); await page.waitForTimeout(2500); }
    await top(page); await shot('review_after_approve_all');
    await page.click('[data-testid="statement-tab-out"]'); await shot('review_left_out_tab');
    await page.click('text=Back to all statements'); await page.waitForSelector('[data-testid="statements-new"]');
    await page.click('[data-testid="statements-new"]'); await page.click('.st-import .mr-chips button:has-text("Operating Checking")');
    await page.setInputFiles('[data-testid="statement-file"]', path.join(TMP, 'gulf-oct.csv'));
    await page.waitForSelector('[data-testid="statement-layout-known"]'); await shot('import_second_time_asks_nothing');
    await page.click('[data-testid="statement-go"]'); await page.waitForSelector('[data-testid="statement-review"]', { timeout: 30000 });
    await page.waitForSelector('[data-testid="statement-line"]'); await page.waitForTimeout(9000); await top(page); await shot('review_second_upload');
    await page.click('[data-testid="statement-tab-auto"]'); await shot('done_for_you');
    await page.click('text=Back to all statements'); await page.waitForSelector('[data-testid="statement-upload"]'); await shot('hub_two_uploads');
    await page.click('[data-testid="statements-rules"]'); await page.waitForSelector('[data-testid="payee-rule"]'); await shot('rules');
    await page.click('[data-testid="payee-rule-change"]'); await page.waitForSelector('[data-testid="rule-editor"]'); await shot('rule_editor');
    await page.click('text=Back to all statements'); await page.waitForSelector('[data-testid="statements-new"]');
    if (scan) {
      await page.click('[data-testid="statements-new"]'); await page.click('.st-import .mr-chips button:has-text("A new account")');
      await page.fill('[data-testid="statement-account-name"]', 'Gulf Business Checking');
      await page.setInputFiles('[data-testid="statement-file"]', process.env.LOOK_PDF); await shot('import_scan_notice');
      await page.click('[data-testid="statement-go"]'); await page.waitForSelector('[data-testid="statement-review"]', { timeout: 30000 }); await shot('scan_being_read');
      await page.waitForSelector('[data-testid="statement-proof"], [data-testid="statement-read-error"]', { timeout: 180000 });
      await page.waitForTimeout(32000); await top(page); await shot('scan_read_with_suggestions');
      await page.click('text=Back to all statements'); await page.waitForSelector('[data-testid="statements-new"]');
    }
    await page.click('[data-testid="statements-close"]'); await page.waitForSelector('[data-testid="money-register"]'); await page.waitForTimeout(2500); await shot('register_afterwards');
    console.log('phone overflowX', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'errors', JSON.stringify(errors.slice(0, 8)));
    await ctx.close();
  }
  { // ── the two densest screens at large type ──
    const { ctx, page, errors } = await open(1.35);
    await page.click('button:has-text("Import a statement"), [data-testid="statements-waiting"] button'); await page.waitForSelector('[data-testid="statement-upload"]');
    await page.screenshot({ path: `${OUT}/st_large_1_hub.png` });
    await page.click('[data-testid="statement-upload"]:has-text("gulf-oct.csv")'); await page.waitForSelector('[data-testid="statement-line"]'); await page.waitForTimeout(2500);
    const h = await page.$eval(hub, (e) => e.scrollHeight); await page.setViewportSize({ width: 390, height: Math.min(h, 5200) }); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/st_large_2_review.png` });
    if (await page.$('[data-testid="statement-line-change"]')) {
      await page.click('[data-testid="statement-line-change"]'); await page.waitForSelector('[data-testid="statement-line-editor"]'); await page.waitForTimeout(600);
      const h2 = await page.$eval(hub, (e) => e.scrollHeight); await page.setViewportSize({ width: 390, height: Math.min(h2, 5200) }); await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/st_large_3_editor.png` });
    }
    const wide = await page.$eval(hub, (e) => e.scrollWidth - e.clientWidth);
    console.log('large overflowX', wide, 'errors', JSON.stringify(errors.slice(0, 8)));
    await ctx.close();
  }
  await browser.close();
} catch (e) { console.error('LOOK FAILED', e); process.exitCode = 1; }
finally {
  try {
    if (bookId) {
      const list = async (prefix) => (await (await fetch(`${URL_}/storage/v1/object/list/statements`, { method: 'POST', headers: H, body: JSON.stringify({ prefix, limit: 200 }) })).json()) || [];
      const files = [];
      for (const d of await list(bookId)) for (const f of await list(`${bookId}/${d.name}`)) files.push(`${bookId}/${d.name}/${f.name}`);
      if (files.length) await fetch(`${URL_}/storage/v1/object/statements`, { method: 'DELETE', headers: H, body: JSON.stringify({ prefixes: files }) });
      await svc('DELETE', `transactions?book_id=eq.${bookId}`); await svc('DELETE', `books?id=eq.${bookId}`);
    }
  } catch (e) { console.error('cleanup book', String(e).slice(0, 200)); }
  for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
  fs.rmSync(TMP, { recursive: true, force: true });
}
