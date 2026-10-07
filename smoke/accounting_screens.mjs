// accounting_screens.mjs — every accounting screen, on a Samsung and an iPhone,
// at ordinary type and at large type. BLOCKS.
//
// Dara, accounting build prompt part 6, the definition of done: "Every
// accounting screen passes the large-font and touch-target checks on a Samsung
// and an iPhone."
//
// The older suites cannot see these screens: largefont.mjs and
// touch_targets.mjs sign in as someone who is not in the accounting group, and
// most of accounting sits two or three taps inside Money. So this walks them
// one by one, as a throwaway person who keeps their own books, owns a team's
// books, and is shown a stand-in brokerage book (smoke/standin_brokerage.mjs;
// the real one is never touched).
//
// Per screen, per phone:
//   at ordinary type  every control inside an accounting screen is at least
//                     44px in both directions (a thumb can hit it)
//   at 135% type      nothing is cut off, pushed off the screen, painted over
//                     its neighbour, or scrolls sideways (smoke/layout_probe.mjs,
//                     the same measurement the rest of the app is held to)
// Unlike the older touch check this one has no allowance to grow into: these
// screens were built this month and start clean.
import { chromium } from 'playwright';
import { measure } from './layout_probe.mjs';
import { routeStandIn, standInOn } from './standin_brokerage.mjs';

const BASE = process.env.SMOKE_URL || 'http://localhost:4173/';
const URL_ = process.env.SUPABASE_URL, SVC = process.env.SUPABASE_SERVICE_KEY;
const MIN = 44, SCALE = 1.35;
if (!URL_ || !SVC) { console.log('accounting_screens: not run (SUPABASE_URL / SUPABASE_SERVICE_KEY missing)'); process.exit(process.env.CI ? 1 : 0); }
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const svc = async (method, p, body) => { const r = await fetch(`${URL_}/rest/v1/${p}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${p}: ${t.slice(0, 300)}`); return t ? JSON.parse(t) : null; };

// The two phones in the definition of done. Widths are what matter to layout.
const PHONES = [
  { name: 'samsung', viewport: { width: 412, height: 915 }, deviceScaleFactor: 3.5, userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938U) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36' },
  { name: 'iphone', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' },
];

// Controls inside an accounting screen that are smaller than a thumb.
const SMALL = `((min) => {
  const out = [];
  const roots = document.querySelectorAll('.mr, .st-hub, [data-testid="book-bar"], [data-testid="book-reports"], [data-testid="arrivals"], [data-testid="book-setup"]');
  const seen = new Set();
  for (const root of roots) for (const el of root.querySelectorAll('button, a[href], [role="button"], input, select, summary')) {
    if (seen.has(el)) continue; seen.add(el);
    if (el.type === 'hidden' || el.type === 'file') continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    let r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.right <= 0 || r.left >= innerWidth) continue;
    // A checkbox or radio is hit through its label: the label is the target.
    if ((el.type === 'checkbox' || el.type === 'radio') && el.closest('label')) r = el.closest('label').getBoundingClientRect();
    if (r.width < min - 0.5 || r.height < min - 0.5) out.push({ text: (el.innerText || el.getAttribute('aria-label') || el.placeholder || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 36), w: Math.round(r.width), h: Math.round(r.height), cls: String(el.className || '').slice(0, 30) });
  }
  return out;
})(${MIN})`;

const made = []; let bookId = null, browser = null; const problems = []; let steps = 0, examined = 0;
try {
  // ── someone who keeps books ──────────────────────────────────────────────
  const email = `smoke_acct_screens_${Date.now()}@example.com`, password = 'Smoke!' + Date.now();
  const u = await (await fetch(`${URL_}/auth/v1/admin/users`, { method: 'POST', headers: H, body: JSON.stringify({ email, password, email_confirm: true }) })).json();
  if (!u.id) throw new Error('no throwaway user'); made.push(u.id);
  await fetch(`${URL_}/rest/v1/user_settings`, { method: 'POST', headers: { ...H, Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: u.id, onboarding_complete: true, display_name: 'Avery Bartholomew-Castellanos' }) });
  await svc('POST', 'accounting_access', { user_id: u.id, note: 'gate: accounting screens' });
  const own = await svc('POST', 'rpc/ensure_personal_book', { p_user: u.id });
  const oc = await svc('GET', `tax_categories?book_id=eq.${own}&select=id,name`);
  const ocat = (re) => (oc.find((c) => re.test(c.name)) || {}).id || null;
  const now = new Date(), y = now.getUTCFullYear(), ym = (back) => new Date(Date.UTC(y, now.getUTCMonth() - back, 1)).toISOString().slice(0, 8);
  const row = (o) => ({ book_id: own, scope: 'business', account: 'Checking', tax_category_id: null, entered_by: u.id, ...o });
  await svc('POST', 'transactions', [
    row({ date: ym(1) + '12', amount: 4321.09, payee: 'ROG commission', tax_category_id: ocat(/commission/i) }),
    row({ date: ym(1) + '14', amount: -212.4, payee: 'Home Depot Store 6341 Wesley Chapel', account: 'Business Platinum Visa', tax_category_id: ocat(/office/i) }),
    row({ date: ym(1) + '20', amount: -2400, payee: 'Patricia Hernandez-Villanueva Consulting', tax_category_id: ocat(/contract/i) }),
    ...[3, 2, 1].map((k) => row({ date: ym(k) + '02', amount: -1800, payee: 'Bay Office Park Holdings', tax_category_id: ocat(/rent/i) })),
  ]);
  await svc('PATCH', `money_accounts?book_id=eq.${own}&name=eq.Checking`, { starting_balance: 1250 });
  await svc('POST', 'book_arrivals', [{ book_id: own, closing_key: 'gate-1', entry_date: ym(1) + '10', amount: 4321.09, payee: 'Realty ONE Group Advantage', memo: '18430 Coats Street, Spring Hill' },
    { book_id: own, closing_key: 'gate-2', entry_date: ym(0) + '01', amount: 6150, payee: 'Realty ONE Group Advantage', memo: '34 Palmetto Ct' }]);
  await svc('POST', 'book_payees', { book_id: own, name: 'Patricia Hernandez-Villanueva Consulting', payee_key: 'patricia hernandez-villanueva consulting', tax_status: 'unknown', created_by: u.id });
  // ── a team's books they own ──────────────────────────────────────────────
  const bk = (await svc('POST', 'books', { kind: 'team', template: 'property_management', name: 'Gate Screens Property Team', starts_on: `${y}-01-01`, principal_user_id: u.id }))[0]; bookId = bk.id;
  await svc('POST', 'rpc/book_seed_categories', { p_book: bk.id });
  await svc('POST', 'book_access', [{ book_id: bk.id, user_id: u.id, role: 'owner' }]);
  const tc = await svc('GET', `tax_categories?book_id=eq.${bk.id}&select=id,name`);
  const tcat = (n) => (tc.find((c) => c.name === n) || {}).id || null;
  const trow = (o) => ({ book_id: bk.id, scope: 'business', account: 'Operating Checking', entered_by: u.id, ...o });
  await svc('POST', 'transactions', [
    trow({ date: ym(2) + '03', amount: 4200, payee: 'Sunrise Villas Homeowners Association', tax_category_id: tcat('Management Fees') }),
    trow({ date: ym(1) + '03', amount: 4200, payee: 'Sunrise Villas Homeowners Association', tax_category_id: tcat('Management Fees') }),
    trow({ date: ym(1) + '09', amount: -389.5, payee: 'Buildium', tax_category_id: tcat('Software & Subscriptions') }),
    trow({ date: ym(1) + '02', amount: 2150, payee: 'Rent - 1418 Oak Vine Dr', account: 'Escrow', tax_category_id: tcat('Rent Collected for Owners') }),
    trow({ date: ym(1) + '28', amount: -75, payee: 'Check 1042', tax_category_id: tcat('Other Expenses') }),
  ]);
  await svc('PATCH', `money_accounts?book_id=eq.${bk.id}&name=eq.Escrow`, { starting_balance: 48000, kind: 'escrow' });
  await svc('PATCH', `money_accounts?book_id=eq.${bk.id}&name=eq.Operating%20Checking`, { starting_balance: 12500 });

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  let selfTested = false;
  for (const phone of PHONES) {
    standInOn(false);
    const ctx = await browser.newContext({ viewport: phone.viewport, deviceScaleFactor: phone.deviceScaleFactor, userAgent: phone.userAgent, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(); page.setDefaultTimeout(9000);
    const errors = []; page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    await routeStandIn(page);
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('input[type="email"]', { timeout: 20000 });
    await page.fill('input[type="email"]', email); await page.fill('input[type="password"]', password); await page.click('button:has-text("Sign In")');
    await page.waitForFunction(() => typeof window.__setView === 'function' && !document.querySelector('.auth-screen, .loading-screen'), { timeout: 40000 });
    for (const label of ['Skip for now', 'Not now', 'Got it']) { try { await page.click(`button:has-text("${label}")`, { timeout: 1200 }); await page.waitForTimeout(300); } catch (_) {} }
    const tag = phone.name;
    // Large type the way a phone's accessibility setting does it: the root size, so everything in rem grows.
    const large = (on) => page.evaluate(([on, px]) => { let el = document.getElementById('gate-large-type'); if (on && !el) { el = document.createElement('style'); el.id = 'gate-large-type'; el.textContent = `html { font-size: ${px}px !important; }`; document.head.appendChild(el); } else if (!on && el) el.remove(); }, [on, Math.round(16 * SCALE)]);

    // One screen: get there, then measure.
    const at = async (name, go) => {
      steps++;
      try {
        await go();
        // 1. ordinary type: can a thumb hit every control?
        await page.waitForTimeout(600);
        if (!selfTested) {
          // Known answer first: a check that cannot see a 20px button is not a check.
          selfTested = true;
          await page.evaluate(() => { const b = document.createElement('button'); b.id = 'gate-tiny'; b.textContent = 'gate tiny'; b.style.cssText = 'width:20px;height:20px;padding:0;min-height:0'; document.querySelector('.mr').appendChild(b); });
          if (!(await page.evaluate(SMALL)).some((x) => x.text === 'gate tiny')) problems.push('the touch check did not notice a 20px button planted in an accounting screen');
          await page.evaluate(() => { const b = document.getElementById('gate-tiny'); if (b) b.remove(); });
        }
        const small = await page.evaluate(SMALL);
        examined += await page.evaluate(`document.querySelectorAll('.mr button, .mr input, .mr select, .st-hub button, [data-testid="book-bar"] button').length`);
        const uniq = new Map(); for (const x of small) uniq.set(`${x.text}|${x.w}x${x.h}`, x);
        for (const x of uniq.values()) problems.push(`[${tag}] ${name}: too small to tap (${x.w}x${x.h}): "${x.text}" .${x.cls}`);
        // 2. large type: is anything cut off, pushed off the screen or painted over?
        await large(true);
        const { r } = await measure(page);
        await large(false);
        const bad = [];
        if (r.docOverflow > 2) bad.push(`scrolls sideways by ${r.docOverflow}px`);
        for (const c of r.clipped) bad.push(`cut off: "${c.text}" <${c.tag}.${c.cls}>`);
        for (const c of r.collisions) bad.push(`painted over each other: "${c.a}" and "${c.b}" (${c.overlap})`);
        for (const c of r.escaped) bad.push(`off the screen by ${c.over}px: "${c.text}" <${c.tag}.${c.cls}>`);
        for (const x of bad) problems.push(`[${tag}, 135% type] ${name}: ${x}`);
      } catch (e) { problems.push(`[${tag}] ${name}: could not be opened: ${String(e.message || e).split('\n')[0].slice(0, 160)}`); }
    };
    const tab = (label) => page.click(`.seg-btn:has-text("${label}")`);
    const chip = (id) => page.click(`[data-testid="report-${id}"]`);
    const see = (sel) => page.waitForSelector(sel, { timeout: 15000 });

    // ── a person's own books ───────────────────────────────────────────────
    await at('own · Add', async () => { await page.evaluate(() => window.__setView('finance')); await see('[data-testid="book-bar"]'); await see('[data-testid="money-register"]'); await see('[data-testid="arrivals-waiting"]'); });
    await at('own · commissions waiting', async () => { await page.click('[data-testid="arrivals-waiting"] button'); await see('[data-testid="arrival-set-aside"]'); });
    await at('own · statements', async () => { await page.click('button:has-text("Import a statement")'); await see('[data-testid="statements-hub"]'); });
    await at('own · bring in a statement', async () => { await page.click('[data-testid="statements-new"]'); await page.waitForTimeout(900); });
    await at('own · rules', async () => { await page.keyboard.press('Escape').catch(() => {}); await page.goBack().catch(() => {}); await see('[data-testid="statements-rules"]'); await page.click('[data-testid="statements-rules"]'); await page.waitForTimeout(900); });
    await at('own · Setup', async () => { await page.click('[data-testid="statements-close"]').catch(() => {}); await page.evaluate(() => window.__setView('finance')); await tab('Setup'); await see('[data-testid="book-start"]'); await page.click('[data-testid="book-start"] .py-h'); });
    await at('own · Reports', async () => { await tab('Reports'); await page.click('button:has-text("The books")'); await see('[data-testid="book-reports"]'); await chip('pnl'); await see('[data-testid="report-table"]'); });
    await at('own · profit and loss by month', async () => { await page.selectOption('[data-testid="report-by"]', 'month'); await see('[data-testid="report-table"]'); });
    for (const [id, name] of [['standing', 'where things stand'], ['cash', 'cash flow'], ['trial', 'trial balance'], ['gl', 'general ledger']]) await at('own · ' + name, async () => { await chip(id); await see('[data-testid="report-table"]'); });
    await at('own · held for others', async () => { await chip('held'); await page.waitForTimeout(900); });
    await at('own · reconcile', async () => { await chip('reconcile'); await see('[data-testid="reconcile-account"]'); });
    await at('own · reconcile, starting', async () => { await page.click('[data-testid="reconcile-account"]:has-text("Checking")'); await see('[data-testid="reconcile-start"]'); await page.fill('[data-testid="reconcile-start"] input[type="date"]', ym(0) + '01'); await page.fill('[data-testid="reconcile-start"] input.amt', '100.00'); });
    await at('own · reconcile, ticking', async () => { await page.click('[data-testid="reconcile-start"] button[type="submit"]'); await see('[data-testid="reconcile-item"]'); });
    // Put it away, so the next phone starts the same way (not a screen; not measured).
    try { await page.click('[data-testid="reconcile-working"] .mr-go .clear'); await page.click('button:text-is("Discard it")'); await see('[data-testid="reconcile-account"]'); } catch (_) {}
    await at('own · 1099s', async () => { await chip('payees'); await see('[data-testid="payee"]'); await page.click('[data-testid="payee"] .py-h'); await see('[data-testid="payee-tin"]'); });
    await at('own · from the brokerage', async () => { await chip('brokerage'); await page.waitForTimeout(1200); });
    await at('own · year-end', async () => { await chip('yearend'); await see('[data-testid="year-end"]'); });

    // ── a team's books ─────────────────────────────────────────────────────
    const pick = async (label) => { await page.click('[data-testid="book-switch"]'); await page.click(`[data-testid="book-pick"]:has-text("${label}")`); };
    await at('books · switching', async () => { await page.click('[data-testid="book-switch"]'); await see('[data-testid="book-pick"]'); });
    await at('team · Add', async () => { await page.click('[data-testid="book-pick"]:has-text("Gate Screens Property Team")'); await see('[data-testid="money-register"]'); });
    await at('team · Reports summary', async () => { await tab('Reports'); await see('[data-testid="book-summary"]'); });
    await at('team · held for others', async () => { await chip('held'); await see('[data-testid="report-table"]'); });
    await at('team · Setup', async () => { await tab('Setup'); await see('[data-testid="book-setup"]'); await see('[data-testid="go-live"]'); await page.click('[data-testid="go-live"] .py-h'); await see('[data-testid="go-live-item"]'); });
    await at('team · People', async () => { await page.click('[data-testid="book-bar"] button:has-text("People")'); await page.waitForTimeout(1200); });

    // ── the brokerage's screens, on the stand-in ───────────────────────────
    await at('brokerage · Closings, off', async () => { await page.click('.modal-overlay button:text-is("Done")').catch(() => {}); await page.evaluate(() => window.__setView('finance')); await see('[data-testid="book-bar"]'); await pick('Stand-in Brokerage'); await tab('Closings'); await see('[data-testid="closings-settings"]'); });
    await at('brokerage · Closings, waiting', async () => { await page.selectOption('[data-testid="closings-deposit"]', 'Operating Checking 4411'); await page.click('[data-testid="closings-turn-on"]'); await page.click('button:text-is("Start")'); await see('[data-testid="closing-held"]'); });
    await at('brokerage · Closings, sheet changed', async () => { await page.click('[data-testid="closings-changed"]'); await see('[data-testid="closing-row"]'); });
    await at('brokerage · Closings, entered', async () => { await page.click('[data-testid="closings-posted"]'); await see('[data-testid="closing-row"]'); });
    await at('brokerage · closings report', async () => { await tab('Reports'); await chip('closings'); await see('[data-testid="report-table"]'); });
    await at('brokerage · agents', async () => { await chip('agents'); await see('[data-testid="agent-row"]'); });
    await at('brokerage · an agent statement', async () => { await page.click('[data-testid="agent-row"]'); await see('[data-testid="agent-statement"] [data-testid="report-table"]'); });
    await at('brokerage · a standing charge', async () => { await page.click('text=Back to all agents'); await page.click('[data-testid="agent-schedule-new"]'); await see('[data-testid="agent-schedule-form"]'); });
    await at('brokerage · 1099s', async () => { await chip('payees'); await see('[data-testid="payee"]'); });
    for (const e of errors.slice(0, 3)) problems.push(`[${tag}] the page threw: ${e}`);
    await ctx.close();
  }
} catch (e) { problems.push('the walk could not run: ' + String(e && e.stack || e).slice(0, 400)); }
finally {
  try { if (browser) await browser.close(); } catch (_) {}
  try { if (bookId) { await svc('DELETE', `book_reconciliations?book_id=eq.${bookId}`); await svc('DELETE', `transactions?book_id=eq.${bookId}`); await svc('DELETE', `books?id=eq.${bookId}`); } } catch (e) { console.error('cleanup', String(e).slice(0, 160)); }
  for (const id of made) await fetch(`${URL_}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: H }).catch(() => {});
}

if (examined < 300) problems.push(`the touch check looked at only ${examined} controls: it is not seeing the screens`);
const uniq = [...new Set(problems)];
if (uniq.length) { console.error(`\n==== ACCOUNTING SCREENS: ${uniq.length} problem(s) over ${steps} screen visits ====`); for (const p of uniq) console.error('  ✗ ' + p); process.exit(1); }
console.log(`==== ACCOUNTING SCREENS: clean — ${steps} screen visits on a Samsung and an iPhone; ${examined} controls a thumb can hit, nothing cut off at large type ====`);
