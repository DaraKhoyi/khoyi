// look_closings.mjs — screenshots of the Closings tab and of a commission
// arriving in an agent's own books, at phone width, so they can be LOOKED AT.
// Usage as look_books.mjs (static server on :4173, SUPABASE_*).
//
// The Closings tab belongs to the one real brokerage book, which a look must
// never touch. So the browser is shown a STAND-IN brokerage book: every request
// that names it is answered here, from canned data shaped like the real thing.
// The arrivals half is real: one throwaway person, two staged arrivals, removed.
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY;
const OUT = process.env.LOOK_DIR || '/home/claude/shots'; fs.mkdirSync(OUT, { recursive: true });
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const svc = async (method, p, body) => { const r = await fetch(`${URL_}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p}: ${t.slice(0, 300)}`); return t ? JSON.parse(t) : null; };
import { routeStandIn } from './standin_brokerage.mjs';
const made = []; let browser = null;
try {
  const email = `smoke_closings_look_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
  const u = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error('no user'); made.push(u.id);
  await fetch(`${URL_}/rest/v1/user_settings`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: u.id, onboarding_complete: true, display_name: 'Avery Owner' }) });
  await svc('POST', 'accounting_access', { user_id: u.id, note: 'look test' });
  const own = await svc('POST', 'rpc/ensure_personal_book', { p_user: u.id });
  await svc('POST', 'transactions', [{ book_id: own, date: '2026-09-12', amount: 4321.09, scope: 'business', account: 'Checking', payee: 'ROG commission', entered_by: u.id }]);
  await svc('POST', 'book_arrivals', [{ book_id: own, closing_key: 'look-1', entry_date: '2026-09-10', amount: 4321.09, payee: 'Realty ONE Group Advantage', memo: '12 Harbor View Ln' },
    { book_id: own, closing_key: 'look-2', entry_date: '2026-09-20', amount: 6150, payee: 'Realty ONE Group Advantage', memo: '34 Palmetto Ct' }]);

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 2600 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  await routeStandIn(page);
  await page.goto('http://localhost:4173/', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(2500);
  await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password); await page.click('button:has-text("Sign In")');
  await page.waitForFunction(() => typeof window.__setView === 'function' && !document.querySelector('.auth-screen, .loading-screen'), { timeout: 40000 });
  for (const label of ['Skip for now', 'Not now', 'Got it']) { try { await page.click(`button:has-text("${label}")`, { timeout: 1500 }); await page.waitForTimeout(500); } catch (_) {} }
  const shot = async (name) => { await page.waitForTimeout(1300); await page.screenshot({ path: `${OUT}/cl_${name}.png`, fullPage: true }); };
  await page.evaluate(() => window.__setView('finance')); await page.waitForSelector('[data-testid="book-bar"]', { timeout: 20000 });
  // the agent's side, in their own books
  await page.waitForSelector('[data-testid="arrivals-waiting"]', { timeout: 20000 }); await shot('1_arrival_banner');
  await page.click('[data-testid="arrivals-waiting"] button'); await page.waitForSelector('[data-testid="arrival"]'); await shot('2_arrivals_open');
  await page.click('[data-testid="arrival"]:has-text("34 Palmetto") [data-testid="arrival-accept"]'); await shot('3_arrival_added');
  // the brokerage's side, on the stand-in
  await page.click('[data-testid="book-switch"]'); await page.click('[data-testid="book-pick"]:has-text("Stand-in Brokerage")');
  await page.waitForSelector('[data-testid="recurring-notice"]'); await shot('3b_recurring_notices');
  await page.click('.seg-btn:has-text("Closings")'); await page.waitForSelector('[data-testid="closings-settings"]'); await shot('4_closings_off');
  await page.selectOption('[data-testid="closings-deposit"]', 'Operating Checking 4411'); await shot('5_closings_choose');
  await page.click('[data-testid="closings-turn-on"]'); await page.waitForTimeout(600); await shot('6_closings_confirm');
  await page.click('button:text-is("Start")'); await page.waitForSelector('[data-testid="closing-held"]'); await shot('7_closings_held');
  await page.click('[data-testid="closings-changed"]'); await page.waitForSelector('[data-testid="closing-row"]'); await shot('8_closings_changed');
  await page.click('[data-testid="closings-posted"]'); await shot('9_closings_posted');
  await page.click('.seg-btn:has-text("Reports")'); await page.click('[data-testid="report-closings"]'); await page.waitForSelector('[data-testid="report-table"]'); await shot('10_closings_report');
  await page.click('[data-testid="report-agents"]'); await page.waitForSelector('[data-testid="agent-row"]'); await shot('11_agents');
  await page.click('[data-testid="agent-row"]:has-text("Jordan Avery")'); await page.waitForSelector('[data-testid="agent-statement"] [data-testid="report-table"]'); await shot('12_agent_statement');
  await page.click('[data-testid="report-payees"]'); await page.waitForSelector('[data-testid="payee"]'); await page.click('[data-testid="payee"]:has-text("Priya Raman") .py-h'); await shot('13_payees');
  console.log('overflowX', await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 'errors', JSON.stringify(errors.slice(0, 6)));
  await ctx.close();
} catch (e) { console.error('LOOK FAILED', e); process.exitCode = 1; }
finally {
  try { if (browser) await browser.close(); } catch (_) {}
  for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
}
