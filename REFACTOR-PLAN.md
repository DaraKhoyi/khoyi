# Strangle the monolith — remaining plan

*Written 12 Aug 2026, after step 24 (v1.06.50). Numbers measured, not guessed.*

Two monoliths remain:

| file | lines | top-level defs |
|---|---:|---:|
| `src/App.js` | 7,647 | 173 |
| `src/views/AccountingViews.jsx` | 8,431 | 89 |

`AccountingViews.jsx` is now **larger than App.js**. It was never part of the
strangle effort — it grew on its own.

---

## 0. Read this first

**A second Claude session works this repo concurrently, and the strangler is its
workstream.** Every strangler step edits App.js, which makes this the highest
collision-risk work in the codebase. Before starting: fresh-clone, `git log
--oneline -12`, and check whether a "Strangle the monolith — step N" commit landed
in the last hour. If one did, either coordinate or pick a cluster from a different
section of the file. Push each step immediately; do not batch steps.

**The gate is the authority, not your own analysis.** In step 24 a hand-rolled
dependency analyzer declared two blocks clean and was wrong twice: a component was
written with a *named* export while App.js imported it as *default* (renders
nothing, no build error), and a helper moved into a domain module without being
exported. `scope_check` caught both. Trust it over any ad-hoc script.

**Check gate coverage before you claim a screen is safe.** `smoke.mjs` and
`largefont.mjs` each carry a hard-coded view list. Step 24 moved two screens that
were in *neither* list — a green gate said nothing about them. Current coverage is
25 smoke / 22 large-font against ~45 view files. **When you extract a screen, add
its view key to both lists in the same commit.**

### The ritual for every step

1. Fresh-clone, verify PAT (`curl -s -o /dev/null -w "%{http_code}" https://api.github.com/user -H "Authorization: Bearer <PAT>"`).
2. Move the cluster into new files under `src/views/` (screens) and/or `src/<domain>.js` (pure logic).
3. Delete the block from App.js; add the imports.
4. Add the view key(s) to `smoke/smoke.mjs` and `smoke/largefont.mjs`.
5. Lower `APPJS_BUDGET` in `smoke/appjs_budget.mjs` to just above the new line count, and prune the moved names from `smoke/appjs_components.json`.
6. Bump `src/version.js` only. Build, run the full gate, **never push on red**.
7. Push. Verify live by SHA at `https://darasapp.com/sw.js`.

---

## 1. App.js — what must stay

The composition root is legitimately ~1,900–2,100 lines and should not be chased
below that:

- `AppMain` (1,094) — routing, session, layout. **Do not split.** Its size is
  inherent: it wires ~90 views.
- `App` (9), `lazyWithReload` (37), `ViewLoadingFallback` (28)
- `ViewErrorBoundary` (80) + `logClientError` (38) + `__isNoise` / `__shouldLogErr` / `__errThrottle`
- Chrome: `ToastHost` (94), `ConfirmHost` (21), `ConnectionBanner` (31),
  `ImpersonationBanner` (26), `UpdateBanner` (54), `InstallPwaPrompt` (87)
- `AuthScreen` (92), `ActAsPicker` (43)
- Menu: `MenuNode` (64) + `menuDescendantBuilt` / `menuContainsView` / `assignMenuKeys`
- Brand marks: `RogLogo` (69), `PrismMark` (7), `AiMark` (9)
- 42 lazy-import declarations + 84 static imports

**Realistic floor: ~2,000 lines. Extractable: ~5,600.**

## 2. App.js — the queue, in recommended order

Ordered by value-per-risk. Sizes are measured line counts; totals include each
cluster's constants and helpers.

| # | cluster | ~lines | members | risk |
|---|---|---:|---|---|
| 25 | **Dashboard** | ~630 | `DashboardView` 389, `NextBestAction` 122, `DashboardAnnouncements` 63, `WeekSparkline` 33, `CountUp` 22 | med — `DashboardView` needs 7 names incl. `TasksView`, `MultiValueField` |
| 26 | **Review + recordings** | ~590 | `CallFollowupsPanel` 265, `ShareRecordingModal` 95, `PendingRecordings` 83, `PendingCard` 56, `EmailRepliesPanel` 35, `ReviewView` 31, `PendingAudio` 28 | low — tight internal graph |
| 27 | **Agents / brokerage admin** | ~570 | `AccountingView` 182, `AgentsView` 141, `AgentEditor` 87, `PayPlanEditor` 82, `AiUsageReportsPanel` 61, `PayPlanReadOnly`, `PlanField`, `PlanLabel`, `BLANK_PLAN`, `AGENT_ROLES`, `ROLE_LABEL` | low |
| 28 | **Leads / recruiting** | ~500 | `LeadsBoard` 200, `ConversionDashboard` 152, `LeadDetail` 109, `LEAD_STAGES` 13, `CADENCES` 10, `LEAD_TYPES`/`LEAD_SOURCES`/`LEAD_PIPELINE`/`APPT_TYPES`/`ACT_TYPES`/`ACT_OUTCOMES`, `cadenceDue`, `cadenceSteps`, `leadInitials`, `stageMeta`, `Avatar`, `StagePill` | med — many small constants, easy to miss one |
| 29 | **My Numbers / metrics** | ~460 | `DashboardROI` 161, `MetricTiles` 71, `GciGauge` 70, `DashboardPipelinePanel` 47, `MyNumbersView` 36, `SphereDonut` 33, `PipelineFunnel` 28, `RecruitingKpiTile` 14 | low |
| 30 | **Tracker / projects** | ~400 | `TrackerTaskModal` 189, `ProjectTasksPanel` 154, `QUAD_TO_PRIO` 33, `PriorityField` 24, `PRIO_TO_QUAD` | low — `TrackerTaskModal` needs nothing |
| 31 | **Onboarding + announcements** | ~344 | `OnboardingModal` 197, `AnnouncementsAdmin` 91, `AnnouncementModal` 56 | very low — `OnboardingModal` needs nothing |
| 32 | **Files** | ~324 | `FilesView` 212, `FileModal` 68, `IntakeCard` 44 | very low |
| 33 | **Learn / teaching** | ~294 | `TeachingStudio` 103, `LESSONS` 87, `LearnView` 81, `MILESTONES` 13, `TRIGGER_META`, `CAT_OPTIONS`, `VIEW_OPTIONS` | very low |
| 34 | **System health** | ~275 | `SYSTEMS` 34, all `sysCheck*` (~200), `sysFmtAgo`/`sysFmtUntil`, `SYS_RANK`, `DEADLINE_DEFS` | very low — pure functions, ideal domain module |
| 35 | **Admin panels** | ~240 | `TeamsAdmin` 110, `ContactTypesAdmin` 95, `TeamView` 35 | very low |
| 36 | **Quick log / dictation** | ~217 | `QuickLog` 131, `useDictation` 59, `LockedPage` 27 | low — `useDictation` is a hook, put it in `src/hooks/` |
| 37 | **Leftover screens + pickers** | ~410 | `MultiValueField` 116, `ContactPicker` 72, `ScoreboardView` 68, `PipelineView` 68, `HeaderSearchInput` 57, `emailAssignTask` 56, `HeaderSearchIcon` 29 | med — `MultiValueField`/`ContactPicker` are shared; keep them as shared components, not view files |

**Cumulative: ~5,250 lines → App.js lands near 2,400.** Steps 31–35 are the
easiest wins if you want fast progress; 25 and 28 are the highest-value but need
care.

### Delete, don't move — verify these first

Four definitions have **exactly one repo-wide reference (their own declaration)**:

- `NeedsAttention` (109), `BusinessKPIs` (63), `DashboardBriefing` (77), `sysCheckGmail` (36)

That's **285 lines of apparently dead code**. Confirm with `grep -rn` across
`src/` before deleting — if genuinely unreferenced, removing them is cheaper and
better than extracting them. Do this as its own commit so it's easy to revert.

---

## 3. AccountingViews.jsx — the bigger problem

8,431 lines, 89 defs. Domain breakdown:

| domain | ~lines |
|---|---:|
| Ledger + CSV import | 2,189 |
| Tax reports | 1,685 |
| Budget + forecast | 1,466 |
| Systems + ROI | 934 |
| **Prospecting** | **940** |
| Dashboard + shell | 513 |
| Reports shell | 460 |
| shared utils | 235 |

### The headline finding: Prospecting is in the wrong file

`ProspectingView`, `ProspectingToday` (416 lines), `ProspectingROI`,
`TimeLogModal`, `Sparkline`, `rankForXp`, `pConfettiBurst`, `pVibrate` — roughly
**940 lines of the prospecting/lead-gen domain — live inside AccountingViews.jsx**
and are re-exported through it:

```js
const ProspectingView = lazyWithReload(() =>
  import('./views/AccountingViews').then(m => ({ default: m.ProspectingView })));
```

**Consequence:** opening Prospecting downloads the entire accounting bundle —
`AccountingViews.chunk.js` is **327 KB (76 KB gzipped)**, the largest app chunk
after vendor. An agent tapping Prospecting pays for the whole tax engine, CSV
importer, and cash-flow forecaster to render a daily activity screen.

**This should be step 1 of the accounting work, and arguably jump the queue** —
it's the only item on this page that is both a structural fix *and* a measurable
performance win for every agent. Extract to `src/views/ProspectingView.jsx` with
its own chunk.

### Then, in order

1. **Prospecting out** (~940) — see above.
2. **`src/financeUtils.js`** (~235) — `fmtUSD`, `fmtUSDCents`, `fmtPct`,
   `fmtHours`, `parseCSV`, `parseAmount`, `parseFlexibleDate`, `guessColumn`,
   `normalizePayee`, `monthNet`, `getProrata`. Pure, shared by everything else —
   do this before the big splits so each subsequent step imports rather than
   duplicates.
3. **CSV import** (~1,300) — `CsvImportModal` alone is **870 lines**, the single
   largest component in either file. Own file, lazy-loaded: importing a CSV is
   rare, so it should not be in the default finance chunk.
4. **Tax reports** (~1,685) — `ScheduleCReport`, `QuarterlyTaxReport`,
   `Form1099Report`, `TaxSettingsModal`, `QuarterlyTaxBanner` + the tax math.
   **Watch for a cycle:** `ScheduleCReport` references `FinanceView` and
   `FinanceView` references `ScheduleCReport`. Verify whether that's real or a
   string-match artifact before splitting; if real, the shared piece belongs in a
   third module.
5. **Budget + forecast** (~1,466) — `CashFlowForecast` 506, `FinanceBlueprint` 402,
   `BudgetReport` 271, `BudgetSection` 108.
6. **Ledger** (~890 after CSV leaves) — `FinanceLedger`, `TransactionModal`,
   `BulkCategorizeModal`, `RecurringList`, `RecurringTemplateModal`.
7. **Systems + ROI** (~934) — `FinanceSystems`, `SystemModal`, template modals,
   `ROIReport`.
8. **Reports shell + dashboard** (~970) — what remains becomes the thin
   `FinanceView` composition root, mirroring `AppMain`.

**Target: AccountingViews.jsx → a ~600-line shell**, with tax, budget, ledger,
CSV, systems, and prospecting as independently lazy-loaded chunks.

### Add an AccountingViews ratchet

Once it is under ~1,000 lines, copy `smoke/appjs_budget.mjs` to guard it the same
way. The App.js ratchet is what makes the App.js win permanent; nothing currently
protects this file, which is exactly how it grew to 8,431 lines unnoticed.

---

## 4. Suggested sequence

1. Delete the ~285 lines of dead code (own commit, easy revert).
2. **Prospecting out of AccountingViews** — jumps the queue; performance win for
   every agent.
3. App.js steps 31–35 (the easy ~1,350 lines) to build momentum and drop the
   ratchet fast.
4. App.js steps 25–30 (the ~3,150-line core).
5. AccountingViews steps 2–8.
6. Add the AccountingViews ratchet.
7. Audit gate coverage: ~20 view files are in neither the smoke nor large-font
   list. Closing that gap is worth more than any single extraction, because it is
   what makes every future extraction verifiable.
