// look_yearend.mjs — builds a REAL year-end package in a real browser for a
// throwaway person, unpacks it, and lists what is inside; and screenshots the
// Setup tab's start-up checklist. Usage as look_books.mjs (static server on
// :4173, SUPABASE_*). Not part of the gate; smoke/yearend_guard.mjs blocks.
import { chromium } from 'playwright';
import fs from 'node:fs';
import JSZip from 'jszip';
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY;
const OUT = process.env.LOOK_DIR || '/home/claude/shots'; fs.mkdirSync(OUT, { recursive: true });
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const svc = async (method, p, body) => { const r = await fetch(`${URL_}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p}: ${t.slice(0, 300)}`); return t ? JSON.parse(t) : null; };
const made = []; let browser = null;
try {
  const email = `smoke_yearend_look_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
  const u = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error('no user'); made.push(u.id);
  await fetch(`${URL_}/rest/v1/user_settings`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: u.id, onboarding_complete: true, display_name: 'Avery Owner' }) });
  await svc('POST', 'accounting_access', { user_id: u.id, note: 'look test' });
  const own = await svc('POST', 'rpc/ensure_personal_book', { p_user: u.id });
  const cats = await svc('GET', `tax_categories?book_id=eq.${own}&select=id,name,kind`);
  const cat = (re) => (cats.find((c) => re.test(c.name)) || {}).id || null;
  const y = new Date().getUTCFullYear();
  // a receipt file under the book, attached to one entry
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  const rpath = `${own}/receipts/look.png`;
  const up = await fetch(`${URL_}/storage/v1/object/statements/${rpath}`, { method: 'POST', headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'image/png' }, body: png });
  if (!up.ok) throw new Error('receipt upload: ' + (await up.text()).slice(0, 200));
  await svc('POST', 'transactions', [
    { book_id: own, date: `${y}-02-10`, amount: 9500, scope: 'business', account: 'Checking', payee: 'Realty ONE Group Advantage', tax_category_id: cat(/commission/i), receipt_url: null, entered_by: u.id },
    { book_id: own, date: `${y}-02-14`, amount: -212.4, scope: 'business', account: 'Biz Visa', payee: 'Home Depot', tax_category_id: cat(/office|supplies/i), receipt_url: rpath, entered_by: u.id },
    { book_id: own, date: `${y}-03-01`, amount: -2400, scope: 'business', account: 'Checking', payee: 'Pat Helper', tax_category_id: cat(/contract/i), receipt_url: null, entered_by: u.id },
    { book_id: own, date: `${y - 1}-11-01`, amount: -99, scope: 'business', account: 'Checking', payee: 'Last year', tax_category_id: null, receipt_url: null, entered_by: u.id }]);
  await svc('PATCH', `money_accounts?book_id=eq.${own}&name=eq.Checking`, { starting_balance: 1250 });

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 2400 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password); await page.click('button:has-text("Sign In")');
  await page.waitForFunction(() => typeof window.__setView === 'function' && !document.querySelector('.auth-screen, .loading-screen'), { timeout: 40000 });
  for (const label of ['Skip for now', 'Not now', 'Got it']) { try { await page.click(`button:has-text("${label}")`, { timeout: 1500 }); await page.waitForTimeout(500); } catch (_) {} }
  const shot = async (name) => { await page.waitForTimeout(1200); await page.screenshot({ path: `${OUT}/ye_${name}.png`, fullPage: true }); };
  await page.evaluate(() => window.__setView('finance')); await page.waitForSelector('[data-testid="book-bar"]', { timeout: 20000 });
  await page.click('.seg-btn:has-text("Setup")'); await page.waitForSelector('[data-testid="book-start"]'); await page.click('[data-testid="book-start"] .py-h'); await shot('1_setup_start');
  await page.click('.seg-btn:has-text("Reports")'); await page.waitForTimeout(800);
  await page.click('button:has-text("The books")'); await page.waitForSelector('[data-testid="book-reports"]');
  await page.click('[data-testid="report-yearend"]'); await page.waitForSelector('[data-testid="year-end"]'); await shot('2_year_end');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 90000 }), page.click('[data-testid="year-end-build"]')]);
  const file = `${OUT}/${dl.suggestedFilename()}`; await dl.saveAs(file);
  await page.waitForSelector('[data-testid="year-end-done"]'); await shot('3_year_end_done');
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  console.log('BUNDLE', dl.suggestedFilename(), fs.statSync(file).size, 'bytes');
  for (const n of Object.keys(zip.files).sort()) console.log('  ', n);
  console.log('---- READ ME ----\n' + await zip.file('READ ME.txt').async('string'));
  console.log('---- Schedule C ----\n' + (await zip.file('reports/Schedule-C-mapping.csv').async('string')).slice(0, 600));
  console.log('---- Entries ----\n' + (await zip.file('Entries.csv').async('string')).slice(0, 500));
  console.log('overflowX', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'errors', JSON.stringify(errors.slice(0, 6)));
  await ctx.close();
} catch (e) { console.error('LOOK FAILED', e); process.exitCode = 1; }
finally {
  try { if (browser) await browser.close(); } catch (_) {}
  for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
}
