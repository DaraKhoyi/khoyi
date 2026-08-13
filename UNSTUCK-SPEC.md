# Unstuck. — build specification

*Locked 12 Aug 2026. The analysis engine's content lives in
`UNSTUCK-RESIDENTIAL-PROMPT.md`; this file is the build contract. Decisions
below are settled — do not re-litigate them mid-build.*

---

## What it is

An agent inputs a stalled listing. The app returns an expert diagnosis of **why
it isn't selling** — market, pricing, competition, features, and defects split
into correctable and uncorrectable — plus a seller-ready report. Once the agent
releases that report, the seller gets a private link that refreshes **weekly**.

Explicitly **not** a pricing tool. Price is one output among many, and the prompt
treats "it's priced too high" as a hypothesis under test rather than the answer.

## Locked decisions

| decision | ruling |
|---|---|
| Name | **Unstuck.** (with the period, matching room-header style) |
| Menu | Top level, **3rd position** — after Today and My World, above Investor Pipeline |
| "Live" | **NOT live at launch.** No real-time claim anywhere in the UI or the seller report. |
| Re-run cadence | **Weekly.** Cheaper in tokens and matches a realistic agent↔client rhythm. |
| Data sources | Consumer-visible sources now (Zillow, Redfin, public portals) + agent-entered comps. MLS/IDX added later when the feed exists — **as an addition, not a replacement.** |
| Seller sees uncorrectable defects | **Yes** — stated once, quantified, pivoting to price/terms. See below. |
| Seller portal visibility | **Nothing until the agent releases the report.** Weekly updates then flow to the same link. |
| AI cost | Every call attributes to the billing user via `logAiUsage` (standing rule). |
| File layout | New feature = new file. App.js gets **one line**. |

### On the seller seeing uncorrectable defects

Ruled **yes**, because a report listing only fixable things is a comfortable
report rather than a true one: the seller does the cheap fixes, skips the price
move, the house still doesn't sell, and the failure lands on the agent. The
uncorrectable defects are the *reason* the price has to move — omit them and
every price conversation is unanchored.

Three guardrails make it safe, and all three are requirements, not preferences:

1. It appears **only in the agent-released report**, never in an automated weekly
   update a seller encounters alone.
2. It is stated **once, with a number attached** ("homes on this road trade 6–8%
   under interior comps"), not re-listed every week. Weekly updates reference it
   by name at most; they never re-argue it.
3. It **pivots immediately to the lever the seller controls** — price or terms.

Fair housing is a hard constraint on this section. Location defects are described
in objective, physical terms only. Never characterise an area, its schools, or
its buyer pool by any protected class or by proxy language for one.

### On reconciling with what the seller can already see

**Standing report section: "What the public sources say — and where we differ."**

The seller is not weighing our analysis against nothing. They have been looking
at a Zestimate for six weeks. If we recommend $479K against a public estimate of
$520K and do not address the gap head-on, we lose the argument before the
evidence is read.

Capture and reconcile: Zestimate / Redfin estimate, portal-displayed DOM, any
"price cut" badge, and saves/views where the agent can see them. Note that
**portal DOM and MLS DOM frequently disagree** — portals often keep counting
through a withdrawal and relist, which matters directly to any relaunch advice.

## Data model

```
unstuck_listings      the subject property + intake answers + status
                      (draft | analyzed | released | archived)
                      portal_token uuid, released_at, released_by
unstuck_runs          one row per analysis run (initial + weekly re-runs)
                      model, tokens, cost, findings jsonb, diff_from_previous
unstuck_competitors   the comp set as of a run — agent-entered now, IDX later
                      source: 'agent' | 'zillow' | 'idx'
unstuck_findings      normalised findings so the portal can render a timeline
                      kind: correctable_cheap | correctable_costly | uncorrectable
                            | market | payment | insurability | exposure
                      severity, dollar_impact, status (open|done|dismissed)
```

RLS: owner agent + brokerage staff. Portal reads go through a `SECURITY DEFINER`
RPC keyed on `portal_token`, revoked from `anon`/`authenticated` and granted only
to `service_role` — the same shape as `investor_portal_*`.

## Surfaces

- `src/views/UnstuckView.jsx` — agent intake, findings, release control. New file;
  App.js gets one lazy import line and one menu entry.
- `supabase/functions/unstuck-analyze` — Claude + web search, builds its system
  prompt from `UNSTUCK-RESIDENTIAL-PROMPT.md`. Wired to `logAiUsage`.
- `supabase/functions/unstuck-portal` — the seller-facing signed-link page.
  **Reuse the `investor-portal` pattern**: signed token, no login, server-side
  redaction, step-up only if we later expose anything sensitive.
- `unstuck-weekly` via pg_cron — `verify_jwt: false` (service-role JWT is
  rejected at the gateway when `verify_jwt=true`).

## Phases

**Phase 1 — agent-only.** Intake form, analysis run, findings UI, agent report.
No portal, no cron. Useful standalone.

**Phase 2 — seller portal.** Release control + signed-link page + the public-
sources reconciliation section.

**Phase 3 — weekly re-runs.** pg_cron, change detection, diff-since-last-week,
agent notified first. Seller-facing copy stays "updated weekly," never "live."

**Phase 4 — IDX.** When the Stellar/MLS Grid feed lands, add it as a competitor
source alongside the consumer sources and re-examine whether the cadence should
tighten. Consumer sources are not removed — the seller can see them, so the
report must keep speaking to them.

## Gate requirements

Per the step-24 lesson: when `UnstuckView` ships, **add its view key to BOTH
`smoke/smoke.mjs` and `smoke/largefont.mjs` in the same commit.** A green gate
proves nothing about a screen that is in neither list.

Bump `src/version.js` only. Never push on red.

## Non-goals

- No real-time or "live" language anywhere until an MLS feed exists.
- No automated price recommendation without the supporting arithmetic shown.
- No fabricated comps, MLS numbers, carriers, or contacts — leave blank and say why.
- Not a CMA generator. Listing Presentation already exists and is a different job.
