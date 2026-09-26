# PrismOS — handoff (STANDALONE). Last updated 26 September 2026.

**This file replaces every earlier handoff.** It depends on no other document.
Read §1 and §8 before touching anything.

Live at time of writing: **v1.08.72** (deployed SHA `faf21dc4`). A SECOND Claude
session often works this same repo, so the version you see may be ahead of this
file. Always `git log --oneline -12` after cloning.

---

## 1. BEFORE YOU DO ANY WORK

### 1.1 Always fresh-clone
```bash
cd /home/claude && rm -rf khoyi
git clone -q https://github.com/DaraKhoyi/khoyi.git
cd khoyi && git log --oneline -12
git config user.email "noreply@anthropic.com"   # the Stop hook REQUIRES this author
git config user.name  "Claude"
npm install --no-audit --no-fund      # scope_check needs @babel/parser
```
Do NOT embed the PAT in the clone URL — see §1.2.

### 1.2 Verify you can PUSH, first, before any work
The repo is **public**, so a clone with a dead or unauthorized token still
succeeds; without this check you find out at the push, after the build and a
six-minute gate. That has cost two sessions.

**The agent proxy strips credentials embedded in a git remote URL** (discovered
25 Sep). A `https://<PAT>@github.com/...` push fails 403 "not in this session's
authorized repository set" no matter how good the token is. Pass the token as a
header instead — this is how every push must be done:

```bash
GH="Authorization: Basic $(printf 'x-access-token:%s' "$PAT" | base64 -w0)"
git -c http.extraHeader="$GH" push --dry-run origin main   # 0 = you can push
```

Verified 26 Sep against both a good and a deliberately bogus token: the good one
returns `Everything up-to-date` (exit 0), the bogus one fails with exit 128.
`curl api.github.com/user` returns 200 even when you cannot push this repo, so it
is NOT a sufficient check — use the dry run.

### 1.3 The GitHub REST API is PARTLY blocked — use git
- `api.github.com/user` → 200 (token liveness only)
- `api.github.com/repos/DaraKhoyi/khoyi/**` → **403 from the agent proxy**, not
  from GitHub. The body names the remedy: an `add_repo` tool with
  `access:"push"`. That tool was NOT available in the 25–26 Sep sessions; if your
  session has it, attach the repo and the REST API works normally.

So **check CI and deploys with git, not REST**:
```bash
git fetch origin gh-pages
git log origin/gh-pages -1 --format='%h %ad %s' --date=format:'%d %b %H:%M'
# tip message is literally "deploy: <full SHA of main that was published>"
```
That is seconds, works with the API blocked, and is the ONLY deploy check you
need. **Dara's standing instruction (25 Sep): STOP WATCHING THE DEPLOY.** After
pushing, say it will be live in ~5 minutes and stop. Do not poll darasapp.com.

### 1.4 RUN THE WHOLE GATE, NOT MOST OF IT
The single most repeated failure: running scope_check, calling it green, and
pushing something jsx_escapes or the file ratchet would have caught.
**`smoke/run.sh` has 23 stages. Run all of them, and READ THE EXIT CODE.**
Redirect to a log and check `$?` — piping a stage through `tail` has masked a
real failure twice. A blank line is not a pass.

### 1.5 Never infer "today" from context
Call the clock. It drifts. In code, `src/clock.js` — New York time, always (§8).

---

## 2. Keys and identifiers

**THE SECRETS ARE NOT IN THIS FILE, AND MUST NEVER BE.** `DaraKhoyi/khoyi` is a
PUBLIC repository. An earlier draft pasted the GitHub and Supabase tokens here
out of habit and GitHub's push protection refused the push — correctly.
Verified clean 26 Sep: no credential literals in any tracked file.

Read these from the **project files**, never from the repo:
```
GitHub PAT         fine-grained on DaraKhoyi/khoyi, Contents + Workflows +
                   Actions + Secrets, all Read and write
Supabase Mgmt PAT  sbp_...
QCP_TOKEN          internal token for cron-called edge fns (night-review,
                   panel-propose, commitment-nudge, commitment-rejudge)
Anon key           safe by design, but keep it out of the repo
```

**Project ref:** `xlgfspnojjgvkuitcoaf` · **App:** https://darasapp.com
**Repo:** `DaraKhoyi/khoyi` (public), branch `main`
**Dara's user_id:** `ad06bbc1-a1cb-4716-84d3-36f426ea3187`
**Dara's mobile:** `+17275147777` · **Quo line:** `+18134456295`
**Service-role key:** fetch live, never paste stale:
```bash
curl -s "https://api.supabase.com/v1/projects/xlgfspnojjgvkuitcoaf/api-keys?reveal=true" \
  -H "Authorization: Bearer <SUPABASE_PAT>" -H "User-Agent: KhoyiApp/1.0"
```

**Key people:** Josh Maples `f122858e-ec92-44dc-bea2-a5f629054e82` ·
Alexander Khoyi auth `122eafc8-37db-41ed-beb6-4cb0c192527d`,
`alex@brokeralex.com`, **iPhone** · Dara on Samsung S26 Ultra, large system font.

**Never change Dara's password to test an authenticated path.** He signs in with
email+password, so a reset is disruptive. Use a throwaway auth user — the gate
already builds one; reuse that pattern.

---

## 3. Stack and layout
- **React 19 SPA**, Vite. `src/App.js` **2083 lines** (HARD RATCHET — see §8).
  Feature screens in `src/views/*.jsx` (**156 files**). Global CSS `src/index.css`.
- **Supabase** — Postgres + RLS + edge functions + pg_cron (**67 active jobs**) +
  pgvector. **225 tables**, 474 functions in `public` (26 Sep).
- **GitHub Pages** on `gh-pages`, custom domain darasapp.com.
- **Anthropic Claude** (`claude-sonnet-4-6`) reasoning + OCR; **AssemblyAI**
  transcription; **OpenAI/Voyage** embeddings.
- `src/modes.js` owns the six ROOMS, their bars, glyphs and accents, plus
  `roomEntry()` and `launchTarget()`.
- `src/clock.js` — **New York time, always.** See §8.
- In-repo docs worth reading before touching their area:
  **`docs/LEAD_STRATEGY.md`** (how leads are recognised, routed, learned from,
  and why a lead and an owed reply are different jobs) and
  **`docs/COMMITMENT_RULES.md`** (what earns a place on the task list, written
  from Dara's 190 dismissals). `smoke/SILENT_FAILURES.md` is the write-audit
  ledger. `README.md` is stock boilerplate — ignore it.

---

## 4. How to ship
Push-to-main; CI builds and publishes. Bump `BUILD_VERSION` in `src/version.js`
only. **Never hand-edit `public/sw.js`** — CI rewrites its `VERSION` to
`prismos-<short-sha>` on every deploy, so anything you put there is overwritten.

```bash
export REACT_APP_SUPABASE_URL="https://xlgfspnojjgvkuitcoaf.supabase.co"
export REACT_APP_SUPABASE_ANON_KEY="<anon>"
rm -rf build node_modules/.vite && GENERATE_SOURCEMAP=false CI=false npx vite build
setsid bash smoke/run.sh > /tmp/gate.log 2>&1 < /dev/null &   # ~6 min; READ $?
```
Green = `SMOKE: 64/64`, `LARGE FONT: 37/37`, `FUNCTIONAL: 136/136`, plus every
static guard. Then push with the header form in §1.2 and verify with §1.3.

**Version scheme:** `vMAJOR.MINOR.PATCH`, two digits each. PATCH +1 per deploy;
at 99 roll MINOR and reset.

**The static guards, all of which have caught a real bug:**
`scope_check` · `jsx_escapes` · `appjs_budget` (file ratchet) ·
`menu_reachable` · `edge_auth` · `clock_check` · `icon_check` ·
`hooks_check` · `dead_ui` · `version_bump` · `data_integrity` ·
`mutation_guard` · `hover_guard` · `nested_component_guard` ·
`openscreens_check` · `responsive` · `test_hygiene`
Credentialed extras that skip without a key rather than failing: `stale_readers`,
`cron_health`, `schema_drift`. `touch_targets` REPORTS and does not block — the
baseline differs between this container and CI (111 vs 112 on the same commit)
and blocking on a set that cannot be reproduced would fail deploys for no reason.
Fix which controls differ, not the number, before making it blocking.

### 4.1 The browser suites run in PARALLEL — `smoke/browser_gate.sh`
smoke (64 views), functional (136 checks) and largefont (37 views) do not depend
on each other. `bash smoke/browser_gate.sh` runs them **two at a time**, each
with its own throwaway account, cleanup on a `trap` (so an interrupted run does
not leak a user), and one **printed** serial retry of any suite that loses a race
under load.

Measured on this container, honestly:

| configuration | wall clock |
|---|---|
| serial | ~340s |
| **two at a time (MAXJOBS=2, shipped)** | **~300s** |
| three at once, nothing flaked | 212s |
| three at once, once contention forced a retry | 382s — *slower than serial* |

So the saving is about **40 seconds**, not the four minutes first estimated.
Three-at-once flaked often enough that the retry ate the gain. **Do not raise
MAXJOBS without re-measuring.** And never cure a flake by loosening a check —
run it again cleanly and print that it needed a retry.

### 4.2 Test hygiene runs FIRST — `smoke/test_hygiene.mjs`
Purges any `@example.com` account older than three hours (old enough never to
touch a run in progress, including a parallel session's), and fails the gate if
per-user copies of the standard field catalogue reappear. It exists because 121
of 138 accounts turned out to be abandoned test users holding 88% of the rows —
runs WILL be interrupted again, so the gate has to heal itself.

### 4.3 Edge functions
Deploy via `.github/workflows/deploy-functions.yml`, or manually:
```
POST https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={slug}
  metadata={"entrypoint_path":"index.ts","name":"{slug}","verify_jwt":false}
  file=<index.ts>   headers: Authorization: Bearer <PAT>, User-Agent: KhoyiApp/1.0
```
PATCH updates metadata only → BOOT_ERROR. `verify_jwt` MUST be `false` for any
function pg_cron calls: the gateway rejects service-role JWTs at the edge before
your own auth logic ever runs.

### 4.4 LOOK AT THE SCREEN BEFORE YOU COMMIT
`smoke/look.mjs` captures any view at phone width AND at 135% type, and the
images are meant to be OPENED and examined, not just generated.
```bash
node smoke/look.mjs today tasks contacts        # the views your change touched
LOOK_BASELINE=1 node smoke/look.mjs today       # save a "before" first
```
With a baseline it also reports which screens MOVED — including ones you did not
mean to touch, which is the failure nobody goes looking for. Four styling faults
shipped in one week without it; every one was valid CSS, so no test could have
caught any of them, and Dara found all four by eye. That is not a reasonable
thing to ask of him.

---

## 5. Standing build requirements
**"EXCELLENCE IS THE FLOOR — we design better than that."** No placeholders.
Dara's phrasing, 21 Sep: *"Don't code what I'm asking for, code what I should
have been asking for."*

1. **MULTI-USER.** Scope by `user_id`/role; never hardcode a person.
2. **iOS AND Android.** Dara Samsung; Alexander and most beta agents iPhone.
   **WebKit is where the layout bugs are** — see §8.
3. **Every change through the gate.** Layouts hold at 135% system font.
4. **AI-cost attribution:** every token-spending function logs via
   `logAiUsage` / `logEmbeddingUsage` in `supabase/functions/_shared/aiUsage.ts`,
   resolving the billing user from the JWT or `body.user_id`.
5. **Do not gate family relationships.** Dara's standing rule, 23 Sep: in real
   estate, who the husband, wife and children are is part of the client
   relationship, and spouse names are needed for almost every transaction. Never
   block, hide or omit the ability to record them.
6. **The task list is Dara's WHOLE LIFE**, not a real-estate list. Family,
   personal errands and his own appointments count exactly as much as brokerage
   work. A prompt that calls it a real-estate list will wrongly archive his
   personal tasks — that happened, and four had to be restored.

**Working protocol Dara expects:** ask "easiest or BEST?" → best; check the work
before declaring it done; name blind spots; push back — he wants a design
partner, not a literal executor. "Go"/"Yes" = press through the whole build
without stopping at each step.
**Dara is a coding novice — explain in plain English.** He has asked for this
directly: *"Speak plainly to me."*

---

## 6. Brand — "Prism Editorial"
Warm near-black `#100D09`, cream `#F6F1E7`, gold ramp `#7A5020`→`#C5A95E`→
`#EBCB82`. Fraunces light serif headlines, Barlow Condensed eyebrows, Manrope body.
**Gold is value; the room accent is structure.** Room accents live in `modes.js`.
Page titles follow the **"My ___"** convention Dara set: My Dashboard, My
Transactions, My Blueprint, My Drives, My Scripts, My Growth, Today's Hunt.
One cohesive theme per change — never mix selection styles, pill shapes or sizing.

---

## 7. People and context
**Dara Khoyi is MALE (he/him).** Never infer gender from a transcribed voice;
unknown speakers default to they/them. Owner pronouns live on `agents.pronouns`,
not a contacts row — most owners have no self-contact, which is how Dara got
mis-gendered in his own call summaries.

Owner/Broker, **Realty ONE Group Advantage** (Tampa/Lutz FL), ~96–101 agents on
the roster. Licensed entity **Teamkar Realty, Inc.** d/b/a ROGA. **Team Blue
Koala** (Dara, Tina Danielson, Alex Khoyi) owns the property-management book,
~280 doors. Wife **Anvar**; son **Alex** (broker_admin); daughter **Natasha**;
brother Dana. **Josh Maples** — office manager, broker_admin, greet him "Joshua".
Dara calls Claude **"Albert"** (Al).

**THE BETA IS FOUR PEOPLE — not the roster.** Mary Sous, Alexander Khoyi, Josh
Maples, and Dara. Any adoption figure measured against ~96 agents overstates the
problem. **Production roles matter for lead work:** Alexander and Mary are in
production; **Dara is the broker and does not personally sell**; **Josh is office
manager, not sales**. So lead surfacing must learn from producing agents only —
learning from Dara's or Josh's behaviour teaches the wrong thing.

---

## 8. HARD-WON LESSONS

**ONE RULE, ONE PLACE.** The most expensive pattern in this codebase, by a wide
margin: the same logic written twice and drifting. "Owe a reply" existed in FOUR
implementations that disagreed; Skip existed in two hero cards and the fix went
into the one the user never sees; Mark-done, markReplied and markNoReplyNeeded
each had twin copies; the Google Contacts importer had a second copy that
silently won. **When something works in one place and not another, look for a
second copy BEFORE looking for a bug.** Shared rules live in `owesReply()`,
`useNbaSkips()` (src/nbaSkips.js), and one wrap of `supabase.functions.invoke` in
dataService.js.

**THE REPORTED BUG IS USUALLY ONE INSTANCE OF A WIDER FAULT.** `scope_check` only
read `App.js` + `src/views/*`, so it went blind exactly where code had been moved
out. One reported `tus is not defined` became **five** undefined identifiers the
moment the guard was widened to all of `src/`. Before fixing the instance, ask
what class it belongs to and whether the guard covers that class.

**THE PANEL'S FINDINGS ARE REAL BUT OFTEN MIS-DIAGNOSED — MEASURE FIRST.** Three
times in one week: "3 transactions with null GCI" was three blank rows, while
**151 commission dates were silently stored as 2001** and nobody had looked; the
"25% concierge rate" used a stale denominator; the "270,000 rows at 96 agents"
extrapolation scaled per-transaction when the growth was per-user. Take the
finding seriously, then go and count.

**`CREATE OR REPLACE FUNCTION` WITH A CHANGED ARGUMENT LIST OVERLOADS — IT DOES
NOT REPLACE.** This destroyed the only working `import_google_contact`: the
replace created a second signature, and the follow-up DROP removed the good one.
**After any function change, assert exactly one signature exists.** Separately,
`CREATE OR REPLACE` can drop EXECUTE grants — compare `proacl` to a sibling and
re-`GRANT` if it differs (`my_owe_reply` lost anon and PUBLIC that way, and every
page load 401'd before the session restored).

**supabase-js DOES NOT THROW on a failed write** — it resolves `{ error }`. So
`try { await supabase.from('x').insert(row) } catch (_) {}` never fires. Check
`error` on every mutating call and roll back the optimistic UI.
`smoke/silent_failures.mjs` finds these; `smoke/mutation_guard.mjs` proves the
reporting layer itself still works.

**A TRIGGER CAN OVERWRITE WHAT YOU JUST INSERTED.**
`contacts_sync_default_phone_email` derives scalar phone/email from the jsonb
arrays on INSERT — so the Google Contacts import wrote a scalar email and the
trigger immediately blanked it from an empty array. Nine contacts lost their
email. Provide phones/emails as jsonb arrays on insert, or INSERT then UPDATE.
Likewise `recompute_contact_comms_one` overwrites `last_communication_direction`,
which is why "settled" is its own column (`comms_settled_at`).

**NEW YORK TIME, ALWAYS — `src/clock.js`.** `toISOString().slice(0,10)` is UTC
and was used in 30 places; from 8pm Eastern the app wrote TOMORROW'S date.
Postgres `current_date` is UTC too — use `public.today_ny()`. The device supplies
the instant, never the zone. Always the IANA zone, never a fixed offset.

**A DATE PARSER MUST NEVER INVENT A YEAR.** The Gold Report sheet has dates typed
as "9.9", "3/15 Dara", "710", "69/2026". The old parser fell through to
`new Date()` and stored **151 commissions in 2001**. And when fixing it I trusted
a received date typed "20226" and pushed a paid date into 2027 — my own bug, in
the repair. A year-wrap now requires a believable receipt date, and a
last-resort parse refuses rather than guesses.

**WEBKIT IS WHERE THE LAYOUT BUGS ARE.** Chromium papers over what Safari
enforces. A scrolling flex child without `min-height: 0` pushes its sibling — the
footer with the Save button — clean out of the modal; and `vh` on iOS is the
LARGE viewport, so a 92vh modal is taller than the visible screen. Use `dvh` with
a `vh` fallback.

**A SILENT FALLBACK HIDES A SYSTEMIC FAULT.** `ModeBar` keeps its OWN glyph table
separate from `icons.jsx`, and an unknown name renders a default star without
complaint. Fourteen names did not exist; ~25 tabs across every room drew the same
picture. `icon_check.mjs` now fails on an unknown glyph AND on two tabs in one
bar sharing a picture.

**THE MENU HAS TWO SOURCES.** `menuConfig.js` builds most of it, but the
Brokerage and Team groups come from `brokerageGroup`/`teamGroup` in App.js and
are SPLICED IN, replacing whatever menuConfig has. Adding a Brokerage entry to
menuConfig.js does nothing. A view also needs to be in `builtSet` or it renders
greyed as "SOON" and swallows the click. `menu_reachable.mjs` checks both.

**iOS STALE SESSION** — a backgrounded tab wakes with an expired token; RPCs fail
closed and edge calls 401 before logging anything. Fixed by wrapping
`functions.invoke` AND `supabase.rpc` with `ensureFreshSession()` plus a
wake-refresh effect. Suspect this first when "nothing happens" on mobile.

**AN ERROR MESSAGE THAT GUESSES WILL GUESS WRONG.** The voice-note catch block
blamed the connection for every failure, so a **deprecated AssemblyAI parameter**
(`speech_model` singular → `speech_models` array) read to Dara as "no signal".
Report what actually failed; only claim "offline" when `navigator.onLine` or the
error text says so.

**A LADDER NEEDS A DEFINED BOTTOM RUNG.** The lead-escalation sweep marked a lead
as exhausted but left its assignment open, so the sweep skipped it forever — a
silent dead end. Added a `with_broker` terminal status and a release. Any
retry/escalation loop needs an explicit terminal state, and a test that reaches it.

**RLS IS THE GATE; GRANTS ARE SECONDARY** — but revoke anyway. The Sentinel found
anon holding INSERT/UPDATE/DELETE on five tables; RLS blocked it, so the finding
overstated the risk. Write grants to anon are now revoked schema-wide. The lead
concierge privacy wall must be re-verified after ANY RLS change — cross-agent
leaks have happened here.

**THE FILE RATCHET IS LOAD-BEARING.** App.js is pinned at 2083. When it pushes
back, the answer is a new module — `roomEntry()` and `launchTarget()` both moved
to modes.js that way and App.js came back UNDER budget. **Raise a budget only
with the written reason beside it** (TodayView went 1130→1170 that way, on 25 Sep,
with the justification recorded).

**CHECK YOUR OWN TOOL AGAINST A KNOWN ANSWER.** Every analyzer written here was
wrong on its first run: `gated_props` missed the very bug it was built for;
`largefont` flagged inline `<strong>`s; `seed.mjs` inserted nothing for three
runs while the checker reported 15/15. A green result from an unvalidated tool is
worse than no tool. The same goes for spreadsheets: an xlsx passed recalculation
with zero errors and completely wrong numbers, because the formulas pointed one
column off. Check figures against the database, not against "no errors".

**A SECOND AI PASS IS NOT A RELIABLE AUDITOR OF THE FIRST.** Post-hoc inversion
detection returned `inverted (high confidence)` then `correct (high confidence)`
on the same file. Never auto-rewrite user data on a judgement that unstable —
mark it, explain it, give the human a one-tap switch.

**DON'T FORCE A LIE TO REACH A TRUTH.** The comms pill used to CYCLE
They → You → Settled, so reaching Settled meant first recording an outbound reply
that never happened. Offer the states directly. The same principle produced the
**"Handled"** outcome on lead cards (22 Sep): Dara would not press Dismiss on a
matter he had dealt with, because it taught the system the wrong lesson.
Cards the system itself retires are `archived`, never `dismissed` — that word is
reserved for the human's own decisions, and only those should teach a mute.

**MIRROR, DON'T MIGRATE, WHEN THE SOURCE HAS ITS OWN MACHINERY.** Journal and
recordings stay authoritative in their own tables (analysis, DISC feed, speaker
maps, audio purge); a searchable copy is mirrored into `notes` by trigger. See §9.

**FLORIDA IS ALL-PARTY CONSENT (§ 934.03).** It bans INTERCEPTION, not recording:
live transcription without storing audio is still interception, and so is a
device-derived behavioural read. Third-degree felony. Consent must be captured
BEFORE the device listens. A human listening and taking notes is not interception.

**EMAIL OPEN TRACKING IS UNRELIABLE BY NATURE.** Apple MPP auto-loads images;
Gmail proxies; scanners cause false positives. Label honestly ("Likely seen"),
never a hard "Read". `track_opens` off by default.

**Smaller traps:** PostgREST bulk insert rejects a batch whose objects have
different key sets rather than defaulting the gaps · Supabase Management API
always needs `User-Agent: KhoyiApp/1.0`, SQL literals use doubled single-quotes,
and it rate-limits · duplicate tool names in an Anthropic API call are a hard
non-retryable 400 · `recordings.summary` is JSONB (use `rec_summary_text()`;
`btrim(jsonb)` throws) · PWA manifest `orientation` hard-locks rotation on
installed Android (now `"any"`; an installed app keeps the OLD manifest until
reinstalled) · MyVoice applies to OUTBOUND CLIENT DRAFTS ONLY, never the Briefing.

---

## 9. THE LIBRARY — "one store, many links"
`public.entity_links` is a polymorphic rail with NO foreign keys:
`item_type` (document | note | recording | journal | email) ×
`target_type` (project | contact | property | deal | file), RLS-owned. One
document can hang off several targets at once (a lease is about the property AND
the project AND the tenant AND the deal). No FKs because the target spans many
tables; the cost is possible orphans (harmless to read past), the benefit is that
a new linkable thing needs no migration.

`public.notes` is the store; `kind` governs behaviour and is deliberately NOT
flattened: `note` (a living document you edit), `journal` and `recording` (records
of a moment — append-only, READ-ONLY in the UI). Generated `fts` tsvector + GIN.
`trg_mirror_journal` and `trg_mirror_recording` keep journal_entries and
recordings searchable without migrating them; both are idempotent on the shared
id. `public.documents` holds OCR/summary/embedding/FTS for uploaded files.

**If extending:** put new content types on the same rails — mirror into `notes`
(or `documents` for files) with a new `kind`, link via `entity_links`, and render
read-only if it is a record rather than a living document.

---

## 10. THE PANEL — twelve specialists, nightly
`night-review` runs at **1:00 AM New York** (cron at 05:00 and 06:00 UTC; the
function checks the NY hour so it holds through DST).

**Members:** Architect · Skeptic · Archivist · Curator · Simplifier · Newcomer ·
Accountant · Merchant · **Fiduciary** (trust accounting, veto on client money) ·
**Sentinel** (security) · **Marguerite** (agent, Android, market-first) ·
**Ray** (agent, iOS, does not follow up and will not admit it).

Marguerite and Ray have STANDING BRIEFS in Dara's own words, in the PANEL array —
**do not paraphrase them away.** They outrank everyone on whether a screen is usable.

**THE COUNCIL:** three rounds — file blind, read all twelve, file again. Changing
is NOT required and most will not; change is MEASURED against a preserved
`round1` rather than claimed. Both extremes are reported: nobody changing means
they are not reading each other, everybody changing means they are performing
agreement. A healthy night is 2–3 of 12. Each night it also reviews ONE WORKING
AGENT on rotation, which is how the panel improves the other agents.

**It cannot commit.** `night_review_config.autonomy_level` is 0 (propose only).
`panel-propose` branches, commits and waits for CI; **nothing merges on a red
gate**, and migrations, workflows, gate scripts, version.js and dataService.js are
never editable. Review UI: Brokerage → Overnight Review.

---

## 11. LEADS, REPLIES AND COMMITMENTS — read the docs, they are the spec
**`docs/LEAD_STRATEGY.md` and `docs/COMMITMENT_RULES.md` are authoritative.**
Change them before changing the code. The short version:

**A lead is a race; a reply is a debt.** `lead_concierge.kind` and
`inbound_kind()` decide which, and everything downstream follows: a lead pushes a
notification the moment it lands and is ordered newest-first with a
minutes-waiting clock; a reply joins an hourly "someone is waiting on you" and is
ordered oldest-first. Only leads count in `speed_to_lead()`. Notifications are off
shadow mode for **recognised-source leads only** — one false alarm costs the
channel, a missed lead costs one opportunity.

**Recognition order:** source template (`lead_sources` / `match_lead_source()`) →
referral from an established contact → direct inquiry from a stranger with
*stated intent*. Source templates are checked BEFORE any bulk filter, because
portals send from notification addresses that Gmail files under Updates and the
old gate threw away real buyers for exactly that reason.

**Routing** is by `agents.production_role` (`producing` | `broker` | `staff`),
with `route_lead()`, timed escalation via `escalate_stale_leads()`, and
`lead_sla_dashboard()`. **Current state: Mary is paused** until her mailbox is
connected; **Alex is paused** (vacation) and auto-returns **29 Sep 07:00**. Until
then leads go to Josh, or to Dara when they come from his own contacts.
Most leads today are **agent-created, their own** — the brokerage generates few —
but the code is deliberately built for the volume success would bring.

**Commitments:** the extractor is tuned from Dara's 190 dismissals. Keep only what
creates work for HIM; a vendor describing the steps of their own job owes him
nothing. Archive anything with no nameable person, anything conditional, anything
done during the call, and anything too vague to act on. When unsure, KEEP —
hiding a real task is worse than showing a doubtful one. Every keeper needs a
person, a title that stands alone a week later, his next step, and one line of
context. `commitment-rejudge` re-reads the backlog under these rules.

---

## 12. LAUNCHERS
Eight install pages under `public/launch/<key>/`, each with its own manifest and
icon, generated by `scripts/make_launcher_pages.py` and
`scripts/make_launcher_icons.py`. **Regenerate with those scripts — do not
hand-edit the generated files.** `scope` is `/` on every manifest and `id` is
pinned per launcher. In-app: tuning fork → Launchers. `?view=` and `?sub=` are
whitelisted in `launchTarget()`.

---

## 13. OPEN ITEMS (26 Sep 2026)

**Waiting on Dara — do not start these uninvited**
- **The tiered gate.** Full gate for logic/DB changes, fast gate for wording and
  layout. Deliberately NOT built: it trades safety for speed and that is his call.
- **On temporary hold at his instruction:** Telnyx 10DLC brand + campaign
  registration, and connecting Mary Sous's email. Both block real work
  downstream; neither is a coding problem. The full Telnyx build prompt is
  written and waiting.

**Needs a human, not code**
- **12 transactions in the Gold Report sheet** are wrong at the source: Josh's
  $43.96 on $350k, Demi Noack's $0.00 on $550k, dates typed "710", "3/34",
  "10/41", "69/2026". Do not guess these.

**The one that matters**
- **Activity, not features.** Only four people use this app, and a phone call to
  one agent is still worth more than the next feature. 78 of 89 agents have no
  goal set despite onboarding shipping to fix exactly that.

**Known and open**
- **Mary Sous has no email connected** — the system has never seen one of her
  leads. Still the single highest-leverage action available.
- **The concierge learns mostly from rejections** — hundreds of auto-learned
  "not a lead" rules against very few auto-learned `lead_ok`.
- **`touch_targets` reports and does not block** — the environment count
  difference (111 vs 112) is unresolved; fix *which* controls differ.
- 252 commitments expired silently; the nudge now fires before the deadline but
  the backlog remains.
- `no_reply_needed_at` and `comms_settled_at` overlap — consolidation candidate.
- Phone-number fields do not validate — an 11-digit number saves silently.
- Property management: Phase 0 is the accounting spine; awaiting the Chase API
  answer and a reconciled opening escrow balance (~$480k from memory, not from a
  statement).
- Sign calls and texts reach the concierge through Quo but are not source-tagged,
  so they never appear in speed-to-lead.
