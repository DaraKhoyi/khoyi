# PrismOS — The Build Process

**The one reliable path from "I want to change something" to "it's live and it works."**

This is the exact sequence used to ship every fix in the app. Follow it in order, every time, no skipping. Each step exists because skipping it once shipped a real bug to real agents. The whole point is that **a change can never reach your beta broken.**

There are two kinds of change. Most steps are the same; the differences are called out.
- **A) App change** (a screen, a button, logic in `src/`) → needs a full build + gate + deploy.
- **B) Data or backend-only change** (fixing records, a database trigger, an edge function) → no app deploy; different verification.

---

## THE GOLDEN RULES (read once, never forget)

1. **Fresh-clone every time.** Another process edits this same repo. Never reuse an old clone, even your own from five minutes ago. A stale clone silently overwrites someone else's work.
2. **The gate is not optional.** "It looks fine" has shipped bugs three times. If the gate is red, nothing ships. Ever.
3. **Verify live by SHA, not by version string.** The version number can match while the actual code hasn't deployed yet. Compare the 7-character commit hash.
4. **One change at a time.** Small, shippable steps. A 200-line change you can't gate is worse than four 50-line changes you can.
5. **Check your own work before declaring done.** Every test written for this app was wrong on its first run. A green result from an unverified check is worse than no check.

---

## STEP 0 — Know the truth of "now"

Before anything involving dates, deadlines, or "today": get the real current time. Don't infer it from context — it drifts.

Before touching the repo, confirm the live version so you know what you're changing from:
```bash
curl -s "https://darasapp.com/sw.js?cb=$RANDOM" | grep -o 'prismos-[a-z0-9]*'
```

---

## STEP 1 — Fresh clone + verify the token

```bash
cd /home/claude && rm -rf khoyi
git clone -q https://<PAT>@github.com/DaraKhoyi/khoyi.git
cd khoyi
git config user.email "dara@brokerdara.com"
git config user.name  "Dara Khoyi"
npm install --no-audit --no-fund
git log --oneline -3      # confirm you're on the real latest
```
The repo is public, so a **dead token still clones fine** and only fails at the final push — after all your work. If you're unsure the token is alive, check it now, not at the end.

---

## STEP 2 — Make the change

- Keep it focused. One feature or one fix.
- **Look before you delete.** If something works in one place and not another, find the second copy before assuming a bug — the #1 recurring problem here is the same logic written twice and drifting (owe-reply, settled-badge, mark-done all bit us this way). Shared rules belong in ONE place.
- **Check `{ error }` on every database write.** Supabase does NOT throw on a failed write — it returns `{ error }`. An optimistic UI in front of an unchecked write shows fake success. Read the error, roll back on failure, tell the user.
- **After a feature ships, add a Tip** (`src/tips.js`) and, if it's user-facing, a Field Guide lesson (the `LESSONS` array, `cat:'Using Prism'`).

---

## STEP 3 — Scope check (catches undefined variables esbuild won't)

```bash
node smoke/scope_check.mjs
```
Must say **"clean — no NEW undefined identifiers."** esbuild does not resolve scopes, so a typo'd variable builds fine and crashes live. This catches it. Run it after **every** edit.

---

## STEP 4 — Bump the version (app changes only)

Edit **only** `src/version.js`:
```js
export const BUILD_VERSION = 'v1.05.05';   // was v1.05.04
```
Format `vMAJOR.MINOR.PATCH`, two digits each. PATCH +1 per deploy; at 99 roll the MINOR and reset PATCH to 00 (…v1.04.99 → v1.05.00). **Do not hand-edit `public/sw.js`** — CI rewrites it; your edit is overwritten and the deploy verify silently breaks.

---

## STEP 5 — Build

```bash
export REACT_APP_SUPABASE_URL="https://xlgfspnojjgvkuitcoaf.supabase.co"
export REACT_APP_SUPABASE_ANON_KEY="<anon key>"
GENERATE_SOURCEMAP=false CI=false npx vite build
```
Must end with `✓ built`. A build error here is a real syntax/import problem — fix it before going further. (If you hit `ERR_MODULE_NOT_FOUND`, node_modules got wiped mid-session — re-run `npm install`.)

---

## STEP 6 — RUN THE GATE (the step that protects the beta)

```bash
export SUPABASE_URL="$REACT_APP_SUPABASE_URL"
export SUPABASE_ANON_KEY="$REACT_APP_SUPABASE_ANON_KEY"
export SUPABASE_SERVICE_KEY="<fetch live>"
npx playwright install chromium      # once per fresh clone
bash smoke/run.sh
```

The gate must show ALL of these green:
| Check | Proves |
|---|---|
| `scope_check` | no undefined identifiers |
| `SMOKE: 20/20` | every view mounts without crashing |
| `LARGE FONT: 15/15` | layouts hold at big system font |
| `FUNCTIONAL: 112/112` | **features actually work, as a logged-in agent, on iPhone/Android/tablet/desktop** |
| `hooks-check: PASS` | no React hook-order bugs |

**The FUNCTIONAL gate is the one that would have prevented the beta meeting.** It logs in as a real agent and exercises real features across four device types. If it's red, a feature is broken on some device — do not ship.

**Never push on red. There is no exception to this.**

---

## STEP 7 — Ship

```bash
git fetch -q origin                       # see the current tip
git add -A
git commit -q -F <message-file>           # explain WHAT and WHY
git push -q origin main
```
CI takes the push, re-runs the gate, and publishes to darasapp.com only if the gate passes. Deployment is push-to-main — never hand-run `gh-pages`.

Write the commit message like you're telling your future self why: the symptom, the root cause, the fix. Every message in this app's history reads that way for a reason.

---

## STEP 8 — Verify live (by SHA, and wait for the CDN)

```bash
# CI status
curl -s "https://api.github.com/repos/DaraKhoyi/khoyi/actions/runs?per_page=1" \
  -H "Authorization: Bearer <PAT>" | python3 -c "import sys,json;r=json.load(sys.stdin)['workflow_runs'][0];print(r['head_sha'][:7],r['status'],r.get('conclusion'))"

# what you pushed
git rev-parse origin/main | cut -c1-7

# what's actually live (the 7-char hash must match the two above)
curl -s "https://darasapp.com/sw.js?cb=$RANDOM" | grep -o 'prismos-[a-z0-9]*'
```
The GitHub Pages CDN lags **~2–4 minutes** — be patient before concluding it failed. Match by the **7-character SHA prefix**, not the version string. When all three agree, it's live.

Then tell agents to **pull to refresh once** to pick it up (the app now prompts them automatically within a minute, but a manual refresh is instant).

---

## TRACK B — Data or backend-only changes

For fixing records, database triggers, or edge functions — **no app version bump, no app build, no gh-pages.** Instead:

**Data fixes (via the Management API):**
1. **Look before you write.** SELECT the rows first, confirm exactly what you're changing and how many.
2. Make the change with a dedup/idempotent guard (so re-running is safe).
3. **Verify:** re-SELECT and confirm the count is what you expected, and that the problem is gone.
4. For bulk changes (many rows), confirm with Dara before running — show him the count and a sample first.
5. Run the integrity sweep after: `SUPA_PAT=<pat> node smoke/data_integrity.mjs` — must be **10/10 clean.**

**Edge function deploys:**
- Multipart POST to `/v1/projects/{ref}/functions/deploy?slug={slug}` (never PATCH — PATCH causes BOOT_ERROR).
- **Preserve `verify_jwt`** — check the function's current setting first and keep it. Functions called by cron or internal token need `verify_jwt: false`, or the gateway rejects them before the code runs.
- Test the function directly after deploying (a real call), don't assume it works.

**Test as an agent without breaking anything:** never change an agent's password. Mint a real login token via the admin magic-link flow (generate_link → verify), use it to exercise the exact path, then you've proven it works for a real agent — which is how the research bug was finally caught.

---

## THE 60-SECOND CHECKLIST (pin this)

```
□ Fresh clone (never reuse)
□ Made ONE focused change; checked for a second copy of the logic
□ Checked { error } on every DB write
□ scope_check → clean
□ Bumped src/version.js (app changes only)
□ Build → ✓ built
□ Gate → ALL green (scope, smoke 20/20, large-font 15/15, functional 112/112, hooks PASS)
□ Committed with a WHAT + WHY message
□ Pushed to main
□ Verified live by 7-char SHA (waited for the CDN)
□ (data change) integrity sweep 10/10 clean
```

If every box is checked, it's live and it works. If any box isn't, it's not done.

---

## WHY THIS PROCESS EXISTS

Every step here is a scar. The research meeting broke because features weren't tested as a logged-in agent on real devices — now the functional gate does that. Bugs shipped silently because writes weren't error-checked — now that's a rule. Stale versions kept agents on broken code — now the app prompts to update and we verify by SHA. Follow the path and the app stays trustworthy, which is the whole reason it exists: to make you look prepared, never embarrassed.
