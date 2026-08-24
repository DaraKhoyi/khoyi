#!/usr/bin/env node
// ── File size ratchet ────────────────────────────────────────────────────────
// App.js reached 19,539 lines because NOTHING MEASURED IT. Discipline and written
// lessons both failed repeatedly here; a check that fails the build is what held.
// So this guard is no longer App.js-specific: every file large enough to become
// the next monolith gets a ceiling.
//
// When this was generalised, AccountingViews.jsx and InboxView.jsx were BOTH
// larger than the App.js we had just spent five steps shrinking, and neither was
// guarded. That is the same story starting over.
//
// Two rules, both fail the build:
//   1) BUDGET — each file below stays at or under its ceiling. Budgets are a
//      RATCHET: when a file legitimately shrinks, lower its number in the same
//      commit to lock the win in. They should only ever go DOWN.
//   2) NO NEW SCREENS INLINE (App.js only) — App.js must not gain top-level
//      components beyond the allow-list. A new screen belongs in its own file,
//      wired in with a one-line lazy import.
//
// Raising a budget should be rare and deliberate: edit it here in the same commit
// and say why in the message.

import { readFileSync, existsSync } from "node:fs";

// file -> ceiling. Seeded with every file over ~1,200 lines so none can grow while
// nobody is looking. Add an entry whenever a file crosses ~1,200.
const BUDGETS = {
  // Raised 2060 -> 2070 on 2026-08-19 for audit Block D. App.js gained two mount
  // lines and two comment lines: <GestureHint /> and <GlobalSearch />. Both are
  // COMPOSITION — mounting a component the shell owns — which is what App.js is
  // for; the components themselves are their own files. Comments were trimmed
  // twice first and 2060 was held for two commits before this.
  "src/App.js": 2070,
  "src/menuConfig.js": 200,
  // The accounting split is DONE: 6,745 -> ~650. These budgets are what keep it
  // that way — the file only reached 6,745 because nothing measured it, and the
  // pieces will drift back together the same way if nothing measures them either.
  "src/views/AccountingViews.jsx": 700,
  "src/views/FinanceLedger.jsx": 1150,
  "src/views/TaxReports.jsx": 1400,
  "src/views/BudgetForecast.jsx": 1550,
  "src/views/CsvImportModal.jsx": 1200,
  "src/views/FinanceReports.jsx": 750,
  "src/views/ProspectingView.jsx": 950,   // being split — drop hard as it shrinks
  "src/views/InboxView.jsx": 3450,
  // Raised 2050 -> 2075 on 2026-08-16, deliberately: the "Language on calls"
  // picker is a real new field on the contact form, and a form field belongs on
  // the form. The option list was moved to src/languages.js first — the budget
  // was only raised for what genuinely had to stay.
    // Raised 2075 -> 2080 on 2026-08-19. The row call/text actions (audit #24) were
  // extracted to ContactRowActions.jsx FIRST — that took the file from 2099 to
  // 2076 — and the single line that remains is the component call itself, which
  // has to live here. Extract before raising; this is what is left after.
  // 2080 -> 2090 on 2026-08-23: the oweOnly filter that makes the Morning Brief's
  // "owed replies" row work. Five lines of filter state and one predicate; the rule
  // itself (oweReplyFn) already existed. Comments trimmed twice before raising.
  "src/views/ContactsView.jsx": 2090,
  "src/views/ContactDetailModal.jsx": 2000,
  "src/views/TasksView.jsx": 1550,
  "src/views/CalendarView.jsx": 1450,
  // Crossed ~1,000 lines and were unguarded. Added BEFORE they become the next
  // AccountingViews — that file only reached 6,745 because nothing measured it.
  "src/views/AriBriefingView.jsx": 1150,
  "src/views/TransactionPipeline.jsx": 1120,
  // 1100 -> 1110 on 2026-08-23: splitting the Morning Brief payload so two dead
  // rows navigate. Five lines of handler replacing a one-line handler that was wrong.
  // 1110 -> 1115 on 2026-08-24: fixing two queries that referenced non-existent
  // columns inside empty catches. Error handling replaced the swallow, which costs
  // lines and is the entire point — these failed silently for months.
  "src/views/TodayView.jsx": 1115,
  "src/views/DealsView.jsx": 1040,
  // Crossed the ~1,000-line mark since the last sweep. Guarded now rather than
  // after they become the next thing that needs a five-step split — which is the
  // whole lesson of App.js and AccountingViews.
  "src/views/AriBriefingView.jsx": 1150,
  "src/views/TransactionPipeline.jsx": 1120,
  // 1100 -> 1110 on 2026-08-23: splitting the Morning Brief payload so two dead
  // rows navigate. Five lines of handler replacing a one-line handler that was wrong.
  // 1110 -> 1115 on 2026-08-24: fixing two queries that referenced non-existent
  // columns inside empty catches. Error handling replaced the swallow, which costs
  // lines and is the entire point — these failed silently for months.
  "src/views/TodayView.jsx": 1115,
  "src/views/DealsView.jsx": 1040,
};

const APPJS = "src/App.js";

const ALLOWED_INLINE = new Set([
  "AppMain",          // the root shell — wires routing, session, layout
  "App",              // the exported root
  "ErrorBoundary",    // top-level crash net (if/when added)
]);

const problems = [];
const report = [];

for (const [file, budget] of Object.entries(BUDGETS)) {
  if (!existsSync(file)) continue;               // a split may remove a file entirely
  const n = readFileSync(file, "utf8").split("\n").length;
  report.push({ file, n, budget });
  if (n > budget) {
    problems.push(
      `${file} is ${n} lines — over its ${budget}-line budget by ${n - budget}.\n` +
      `    New feature code belongs in its own module, not appended here. If the\n` +
      `    growth is genuinely structural, raise the budget in this same commit.`
    );
  }
}

if (existsSync(APPJS)) {
  const lines = readFileSync(APPJS, "utf8").split("\n");
  const declRe = /^(?:export\s+)?(?:function\s+([A-Z]\w+)\s*\(|const\s+([A-Z]\w+)\s*=\s*(?:React\.)?(?:memo\(|forwardRef\(|function\b|\([^)]*\)\s*=>|[A-Za-z]))/;
  const found = [];
  for (const line of lines) {
    // `const Foo = lazyWithReload(() => import('./views/Foo'))` is the WIRING we
    // want, not an inline component. Counting it would flag every correctly
    // extracted screen as a violation.
    if (/=\s*lazyWithReload\s*\(/.test(line)) continue;
    const m = declRe.exec(line);
    if (m) found.push(m[1] || m[2]);
  }
  let known = [];
  try { known = JSON.parse(readFileSync("smoke/appjs_components.json", "utf8")); } catch { known = []; }
  const allowed = new Set([...known, ...ALLOWED_INLINE]);
  const added = found.filter((n) => !allowed.has(n));
  if (added.length) {
    problems.push(
      `App.js gained ${added.length} new top-level component(s): ${added.join(", ")}\n` +
      `    A new screen, modal or panel belongs in its own file under src/views/,\n` +
      `    wired in with a one-line lazy import. If one genuinely belongs to the\n` +
      `    root shell, add it to smoke/appjs_components.json.`
    );
  }
}

if (problems.length) {
  console.error("\n==== FILE RATCHET: " + problems.length + " problem(s) ====");
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}

const summary = report.sort((a, b) => b.n - a.n)
  .map((r) => `${r.file.replace("src/views/", "").replace("src/", "")} ${r.n}/${r.budget}`)
  .join(" · ");
console.log(`FILE RATCHET: clean — ${summary}`);
