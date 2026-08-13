# Strangle the monolith — plan

*Refreshed 13 Aug 2026 after step 28 (v1.06.63). All numbers measured, not estimated.*

## Where things stand

**App.js is done.** 7,647 -> **2,112 lines** across steps 24-28, a 72% cut.
`AppMain` is 1,096 of those, and the rest is chrome: `ToastHost`, `AuthScreen`,
`InstallPwaPrompt`, `ViewErrorBoundary`, `MenuNode`, `UpdateBanner`,
`ActAsPicker`, the brand marks and the lazy-import table. **That is what a
composition root should contain — stop here.** Splitting `AppMain` would scatter
routing without reducing real complexity.

**The dependency graph is a tree again.** App.js carried a 52-name barrel
re-export and sixteen views did `import { X } from '../App'`, making the graph a
cycle. The barrel is deleted and **views importing App.js: 16 -> 0.** Shared code
lives in `src/views/SharedUi.jsx`, `src/uiPrimitives.jsx`, `src/helpers.js`,
`src/coachDomain.js`, `src/fileDomain.js`, `src/systemHealth.js`,
`src/financeUtils.js`.

Guard: `smoke/appjs_budget.mjs`, budget **2150**, plus an allow-list of components
permitted to remain inline. It fails the build on growth or on a new inline screen.

## The current top of the file-size table

| file | lines | guarded? |
|---|---:|---|
| `src/views/AccountingViews.jsx` | **6,744** | no |
| `src/views/InboxView.jsx` | **3,395** | no |
| `src/App.js` | 2,112 | **yes** |
| `src/views/ContactsView.jsx` | 2,000 | no |
| `src/views/ContactDetailModal.jsx` | 1,952 | no |
| `src/views/TasksView.jsx` | 1,506 | no |
| `src/views/CalendarView.jsx` | 1,397 | no |

Two files are now larger than the monolith we spent five steps shrinking, and
neither has a ratchet. **This is the lesson of the whole effort: App.js only grew
to 19k lines because nothing measured it.** The same thing is happening again.

---

## 1. AccountingViews.jsx — the priority

6,744 lines, 69 top-level definitions, one file, six unrelated domains.

| domain | ~lines |
|---|---:|
| Tax reports | 1,685 |
| Budget + forecast | 1,466 |
| CSV import | 1,114 |
| Ledger | 1,075 |
| Reports shell | 674 |
| Dashboard + shell | 513 |

Largest single components: `CsvImportModal` **870**, `CashFlowForecast` 506,
`ScheduleCReport` 417, `FinanceBlueprint` 402, `Form1099Report` 355.

### Why it matters beyond tidiness

The chunk is **~250 KB**, and it is pulled in by things that are not the finance
screen. `QuarterlyTaxBanner` renders inside **SettingsView** — so opening Settings
downloads the entire tax engine, CSV importer and cash-flow forecaster to show one
banner. This is the same failure already fixed once for Prospecting, which used to
drag the whole 327 KB accounting bundle to render a daily activity screen.

**A single small import from a large module costs the whole module.** That is the
argument for splitting this file, and it matters more than the line count.

### Order of work

1. **`QuarterlyTaxBanner` out first.** Smallest change, immediate payoff: Settings
   stops pulling the accounting bundle. Worth doing even if nothing else follows.
2. **CSV import -> its own lazy chunk** (~1,114). `CsvImportModal` alone is 870
   lines and importing a CSV is a rare act; it has no business in the default
   finance bundle.
3. **Tax reports** (~1,685) — `ScheduleCReport`, `QuarterlyTaxReport`,
   `Form1099Report`, `TaxSettingsModal` + the tax math. **Verify the reported
   `ScheduleCReport` <-> `FinanceView` cycle before splitting** — comment-stripped
   analysis showed the earlier "cycles" in this file were section-divider
   comments, so check it is real; if it is, the shared piece belongs in a third
   module.
4. **Budget + forecast** (~1,466) — `CashFlowForecast`, `FinanceBlueprint`,
   `BudgetReport`, `BudgetSection`.
5. **Ledger** (~1,075) — `FinanceLedger`, `TransactionModal`,
   `BulkCategorizeModal`, recurring templates.
6. **Reports shell + ROI** (~674).
7. What remains — `FinanceView`, `FinanceDashboard`, hero strip, KPI tiles —
   becomes a **~500-line composition root**, mirroring what App.js now is.
8. **Add `smoke/accounting_budget.mjs`**, cloned from the App.js ratchet, the
   moment it is under ~1,000 lines. Without it this file grows back.

## 2. InboxView.jsx — next after that

3,395 lines and unexamined. Larger than App.js. Same treatment: inventory the
top-level definitions, group by subject, extract, ratchet.

## 3. The systemic fix, worth more than any single extraction

- **Generalise the ratchet.** One script taking a `{file: budget}` map beats
  copy-pasting `appjs_budget.mjs` per file. Seed it with every file over ~1,200
  lines so none of them can grow while nobody is looking.
- **Add a menu-reachability check.** `Unstuck.` shipped mounting fine in a green
  26/26 gate while being completely unreachable — greyed as "SOON" because the
  view key was missing from `builtSet`. A static assertion that every `MENU` leaf
  with a `view` appears in `builtSet` is cheap and would have caught it, along
  with three other screens (`my_prism`, `production`, `transactions`) found greyed
  the same way.
- **Close the gate-coverage gap.** `smoke.mjs` and `largefont.mjs` carry
  hard-coded view lists covering 26 and 23 of ~50 view files. A screen in neither
  list can be extracted broken and ship green. Extracting a screen must add its
  key to both lists in the same commit.

---

## How to run a step

1. Fresh-clone; `git log --oneline -12`. A second Claude session works this repo,
   and every extraction touches shared files.
2. Move the cluster to new modules; **strip comments before computing
   dependencies** — a `// --- FinanceSystems ---` divider reads as a dependency
   and produces false cycles.
3. Point consumers at the real module. **Never re-export from the parent for
   compatibility** — that recreates the barrel this effort just removed.
4. Add any new view key to `smoke/smoke.mjs` and `smoke/largefont.mjs`.
5. Lower the budget, prune the allow-list, bump `src/version.js` only.
6. Build, run the full gate, **never push on red**, verify live by SHA.

### Where mechanical extraction breaks

Extraction is safe for code and fragile at the **module boundary**. All three
failures in steps 25-28 were boundary problems, and each was caught by a
*different* check — which is the argument for keeping all of them:

- an `import` statement sitting *between* two definitions gets swallowed into the
  new module and deleted from the parent -> caught by `scope_check`;
- named vs default export mismatch -> renders nothing, **no build error**;
- relative path depth (`../supabase/...` needs another `../` from `src/views/`)
  -> caught by the build.

**esbuild does not resolve scopes.** A green build proves nothing about
identifier resolution; `scope_check` is the authority. And a green gate proves a
screen *mounts*, never that a user can reach it or that the feature works.
