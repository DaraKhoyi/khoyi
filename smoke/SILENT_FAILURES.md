# Silent-failure cleanup — progress ledger

`smoke/silent_failures.mjs` finds mutating Supabase calls whose result is
discarded. supabase-js **resolves** with `{ error }` rather than throwing, so
`try { await ...insert() } catch (_) {}` never fires and the failure is invisible
— usually behind an optimistic UI update that already told the user it worked.

Dara's plan: **10 per day until all of them are processed.** "Processed" means
either fixed, or consciously accepted as best-effort with a reason written down.
A finding that is neither is not done.

Run the tool:

```bash
node smoke/silent_failures.mjs          # human-readable
SF_JSON=1 node smoke/silent_failures.mjs   # machine-readable, for triage
```

## Triage order

Work highest-impact first, not file order. The question that sorts them:

> If this write fails, does the user believe something happened that didn't?

1. **User actions** — a button was pressed. Silence means the action was lost
   while the UI said it succeeded. **Always fix.**
2. **State the user set** — snooze, dismiss, mark-read. Fix; these come back
   later and look like bugs in something else.
3. **Telemetry / usage logging** — losing one is tolerable. Accept, with a note.
4. **Best-effort cleanup** — a delete that will be retried or is cosmetic.
   Accept, with a note.

## The fix shape

```js
const { error } = await supabase.from('x').update(...).eq('id', id);
if (error) { if (window.__notify) window.__notify('Could not …: ' + (error.message || error), 'error'); return; }
// optimistic update goes AFTER the check, or gets rolled back on failure
```

Two rules learned the hard way:

- **Never leave the optimistic update outside the check.** The whole failure
  mode is a UI that says success while the row never changed.
- **Check whether the same handler exists twice.** `Mark done`, `markReplied`
  and `markNoReplyNeeded` each existed in BOTH hero cards; fixing one leaves the
  screen the user actually looks at still broken.

---

## Day 1 — 24 July 2026 (v1.04.64)

**Baseline: 261 findings, 103 inside an empty catch.**

Fixed — every one a "user pressed a button and the app said nothing":

| # | where | what it silently lost |
|---|---|---|
| 1 | `TodayView` runCta `task_done` | **Mark done** — the most-pressed button in the app. `.then(() => {})` discarded the result and the card cleared regardless, so the task un-completed on the next reload. |
| 2 | `App.js` NextBestAction `task_done` | The same action in the second hero card. Also moved the optimistic update and the "Done — nice work" toast INSIDE the success path — they were firing unconditionally. |
| 3 | `App.js` NextBestAction `markReplied` | Second copy of the handler fixed in v1.04.62. |
| 4 | `App.js` Plan-my-day complete toggle | Ticking an item off the day's plan. |
| 5 | `ChiefOfStaffView` approve → `create_task` | Approving a suggestion and getting no task is indistinguishable from the approval never happening. |
| 6 | `ChiefOfStaffView` approve → reply task | Same. |
| 7 | `SomedayView` drop | Archiving a Someday item — losing this write means it returns. |
| 8 | `AgentRunsView` playbook step → task | A playbook that reports it ran and creates nothing. |

Also added `SF_JSON=1` mode to the analyzer so the full list is machine-readable
— its human output truncates at 12 per file, which hid 59 of the 103 from the
first triage pass.

**After day 1: 256 findings, 98 empty-catch.**

The count drops slower than the number of fixes, because several of these sat
inside one larger `try` block covering multiple calls — fixing the call that
mattered leaves the others in the same block still counted. That is honest
arithmetic, not a stall.

---

## Accepted as best-effort

*(none yet — day 1 was all fixes)*

When accepting one, record it here with the reason. "It's just telemetry" is a
fine reason. "It looked hard" is not.

---

## Day 2 — 29 July 2026 (v1.05.20)

Fixed — 10 user-action writes where a silent failure left the UI claiming success:

| # | where | what it silently lost |
|---|---|---|
| 1 | `App.js` renameTeam | Renaming a team — RPC result discarded; list reloaded regardless. |
| 2 | `App.js` deleteTeam | Deleting a team (and its team-only announcements). |
| 3 | `App.js` addEval (knowledge) | Adding a knowledge eval question. |
| 4 | `App.js` delEval | Deleting an eval. |
| 5 | `App.js` confirmLink | Confirming a knowledge link. |
| 6 | `App.js` removeLink | Removing a knowledge link. |
| 7 | `App.js` resolveConflict | Resolving a knowledge conflict. |
| 8 | `StaleDecide` doToday | "Move to today" on a stale task — optimistic patch ran even if the write failed; also collapsed a needless double-update into one. |
| 9 | `StaleDecide` schedule | Rescheduling a stale task. |
| 10 | `StaleDecide` drop | Dropping (decided-against) a stale task — losing this write means it returns as stale. |

All now follow the fix shape: check `{ error }`, notify on failure, and apply the
optimistic UI patch only on success.

---

## Day 3 — 29 July 2026 (v1.05.21)

Fixed — 7 user-action writes where a silent failure left the UI claiming success
(TodayView is the home screen, so those are the highest-traffic of the batch):

| # | where | what it silently lost |
|---|---|---|
| 1 | `TodayView` saveLevel | Changing the automation dial — reverted silently on reload. |
| 2 | `TodayView` bumpApprovals | The approvals counter behind the automation level. |
| 3 | `TodayView` markBounceHandled | Marking an email bounce handled — the "Marked handled" toast fired even on failure (false success). |
| 4 | `TodayView` undoGroom | Undo of a stale-task archive — silently did nothing on failure; user thinks tasks were restored. |
| 5 | `AriBriefingView` applySnooze | Snoozing a person from reach-outs — the "Snoozed…" toast fired even if the write failed, and they reappear. |
| 6 | `DocumentsView` markHandled | Marking a document's action_needed off — now rolls the optimistic flip back on failure. |
| 7 | `AgentRunsView` dismiss | Dismissing an AI agent run — silent failure means it reappears. |

## Accepted as best-effort (Day 3)

Consciously NOT force-fixed — each is a derived/log write that happens AFTER the
real user action already succeeded, so a lost write is tolerable and does not
produce a false "it worked":

- `AriBriefingView` logTouch / logOutreach (655/656/666) — logging an outreach
  that already went out. Losing the interaction/telemetry record doesn't undo the
  send.
- `AriBriefingView` loadScore ari_attribute_outcomes (671) — a read/attribution
  refresh, not a user mutation.
- `AriBriefingView` set_task_contacts (458/471/743) — best-effort contact link
  after the task itself is created-and-checked; a missing link is minor and
  re-linkable.
- `InboxView` post-send comms-timestamp update (2194) — derived last_outbound_at
  bookkeeping after the email already sent.
- `QuoView` logCallIntent (473) — an early "owe a reply" signal logged after the
  call is already placed; the webhook backfills the real record.
