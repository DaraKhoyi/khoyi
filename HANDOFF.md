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
  `access:"push"`. **DO NOT CALL IT in a session that must push** (tested 26 Sep):
  while the Claude GitHub App is not linked for this repo, add_repo returns
  `push_check: "refused"`, and from then on the proxy refuses EVERY push in that
  session — including the PAT-header push in §1.2, with a valid token. It cannot
  be undone in that session. REST starts working; pushing stops. Not worth it.

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
`openscreens_check` · `responsive` · `test_hygiene` · `edge_parse` ·
`ai_cost_guard` · `anon_exposure` (calls every exposed database function with
only the public anon key; any real data in the answer blocks — needs the
service key only to list them) · `definer_guard` (PAT; signed-out bypasses in
definer functions, sensitive columns on shared tables)
Credentialed extras that skip without a key rather than failing: `stale_readers`,
`cron_health` (blocks on current or repeated failures, reports superseded ones and
slow calls), `schema_drift`, and two that BLOCK when a key is present:
`snapshot_quarantine` (no one-off backup tables in `public`), `function_config`
(deployed functions = repo; verify_jwt = config.toml) and `data_integrity`
(listed here for weeks but never actually called by run.sh until 26 Sep — the
list and the script had drifted; check the script, not the list). `touch_targets` REPORTS and does not block — the
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

**DELETED EMAIL IS GONE (29 Sep).** Josh: the app kept asking him to answer
emails he had deleted in Gmail. Deleting in Gmail is a Trash LABEL; the sync only
handled permanent deletes, and 24 readers never excluded TRASH/SPAM. Now the
table is `email_messages_all` and **`email_messages` is a security_invoker VIEW
without TRASH/SPAM** — every reader (SQL, screens, edge functions) sees only live
mail. Only gmail-sync (history labelsAdded/Removed → labels; permanent deletes;
reconcile), gmail-trash and gmail-modify (so Undo/restore can find trashed rows)
use `email_messages_all`. Trigger `email_trash_changed` (on label change): thread
labels = union of its messages', message_count/worth_a_look/has_unread follow the
visible mail, the sender's contact is recomputed (stored last_inbound_at from the
deleted mail cleared first; recompute now says NOT waiting when nothing is left),
and a pending lead card from that sender is archived. Daily cron
`gmail-reconcile-gone-daily` marks what Gmail holds in Trash/Spam
(`email_mark_gone`); the sync also reconciles when its history id is too old.
**A column added to email_messages_all must be added to the view** (`create or
replace view public.email_messages … select * …`). `smoke/deleted_email.mjs`.

**ONE SYSTEM: THE CHIEF OF STAFF QUEUE (29 Sep).** Dara: "do we need two
systems?" → "make the chief of staff capable of all that would be missed … do
the right thing." There is now ONE queue, `chief_queue(p_limit)` (SQL, live, no
AI, `supabase/sql/2026-09-29_chief_queue.sql`), shown on Today by
`src/views/ChiefQueue.jsx` as "Your one thing now" and on the Chief of Staff page
with the list open. Order: promise from a call (perishable; the call card renders
itself via `CommitmentReview focusCallId`) → late promise owed to you
(`focusId`) → deadline from documents (7 days) → ONE "pick today's must-dos"
nudge when A tasks slip (the task list stays on Tasks) → replies owed (6h–21d,
never yourself) → plans to approve (14d) → deals stuck 10d → review/referral ask
(closed ≤30d) → ONE quiet-recruits nudge. "Not today" / "Done" write
`chief_snoozes`. Retired: the `chief-of-staff` edge function and its morning
cron (4,661 unread items, last acted on 29 Jul); cos_* tables kept as history.
Talk to Prism / Claude gained `whats_next`. The stand-alone "Heard on your
calls" block on Today is now the queue's promise card; when the queue is empty
Today shows only the "set aside — look again" recovery.

**CLOSE THE LOOP (29 Sep).** Panel: 145 call suggestions and 4,661 Chief of
Staff items "never closed". Cause: `expire_short_fuse_commitments()` existed but
was never scheduled. Now cron `commitments-expire-hourly` sets aside unreviewed
call suggestions (status 'expired') after 3/14/30 days by fuse — never one still
dated in the future, never one a person brought back (`auto_expired_at` set).
It had been switched off because "expired" read as a verdict (Ray) and vanished
silently (Fiduciary): so the UI never says expired — Today shows ONE call at a
time, and once caught up offers "PrismOS set aside N older suggestions — look
again" with Bring back (`restore_commitment`). Chief of Staff: yesterday's
untouched items retire when today's list is built; the morning job builds a list
only for people who SAW the last one (`cos_runs.seen_at`, set by `cos_seen()`
when the screen opens; opening with no list builds one on the spot); the screen
shows "Your one thing now" with the full list a tap away. The every-agent run
now requires the service key (it was callable by anyone). `smoke/close_the_loop.mjs`.

**BROKERAGE-WIDE SENDER MUTES (28 Sep).** `lead_sender_rules.is_brokerage`
drops mail from an exact address for EVERY agent (gmail-sync pushes,
lead_concierge_pending). Gate, one definition: `brokerage_mute_allowed(sender)`
— 2+ agents with an agents row `production_role='producing'` mute it, nobody
marked it lead_ok, and it matches no active `lead_sources.sender_re` (nor a
portal/CRM list). Trigger `lead_sender_rules_brokerage_guard_trg` refuses the
flag otherwise, for every role; the browser has no column grant on
is_brokerage/learned_from at all. `promote_shared_sender_rules` (cron 06:45)
now also UN-mutes anything that stops qualifying and logs both directions to
`brokerage_mute_log`; `brokerage_mutes()` is the staff/panel view. The panel's
old "from_producers: 0" was a column added after the rows — not a gate breach.
`smoke/brokerage_mute_guard.mjs` (known-answer tested).

**UPDATES ARE THE PERSON'S CHOICE (28 Sep).** Dara lost a Library note when a
new version swapped itself in mid-task. Now: `public/sw.js` never skipWaiting()s
on install; `index.html` reloads on controllerchange only after
`window.__prismUpdateRequested`; `lazyWithReload` retries then shows a Refresh
card, never reloads; `src/UpdateBanner.jsx` shows "New version ready" with
Later (tucks to an "Update" pill) and Update (asks first if you typed in the
last 3 minutes or a text box on screen holds words). deploy.yml has
`keep_files: true` so a phone on the old version can still load its screens —
a MANUAL gh-pages publish must also keep old files (copy the build over the
existing tree; do NOT `git rm -rq .`). A new note never saved is offered back
in the Library ("Unsaved note from earlier"). `smoke/no_forced_update.mjs` pins
all of it.

**Smaller traps:** the deploy robot must run the SAME Node major as the local gate (22): on Node 20, `createClient` from supabase-js throws at start (no built-in WebSocket), which silently kept v1.08.79–80 off the site for a night · PostgREST bulk insert rejects a batch whose objects have
different key sets rather than defaulting the gaps · Supabase Management API
always needs `User-Agent: KhoyiApp/1.0`, SQL literals use doubled single-quotes,
and it rate-limits · duplicate tool names in an Anthropic API call are a hard
non-retryable 400 · `recordings.summary` is JSONB (use `rec_summary_text()`;
`btrim(jsonb)` throws) · PWA manifest `orientation` hard-locks rotation on
installed Android (now `"any"`; an installed app keeps the OLD manifest until
reinstalled) · MyVoice applies to OUTBOUND CLIENT DRAFTS ONLY, never the Briefing.

**A CHECK THAT PASSES ON THE SIGN-IN SCREEN IS NOT A CHECK.** (26 Sep) The
functional suite failed three checks on ONE random device per run for a week.
Making the failing checks print what they SAW found the page on the sign-in
screen. Root cause: on a first visit, `sw.js`'s `clients.claim()` fired
`controllerchange`, and `index.html` reloaded the page on ANY controllerchange —
wiping a half-typed sign-in form. Every fresh test browser is a first visit;
install time grows under load, hence "random device". Real users hit it too: a
new agent's first sign-in on a slow phone. Fixed in v1.08.73 (reload only when a
NEW worker replaces an OLD one). Worse, the harness hid it: every suite's
"logged in" waited for `window.__setView`, which exists on the sign-in screen,
and most view checks pass on any page with text and no error boundary — so up to
64 smoke + 37 large-font + 22 room checks could go green testing nothing. Now:
`smoke/session_guard.mjs`, one probe, used by every suite; logins wait for the
sign-in screen to be GONE. Also: `browser_gate.sh` keeps a failed first
attempt's log (`<suite>.try1.log`) — the retry used to overwrite the only evidence.

**"NO RESPONSE" IS NOT "FAILED"; READ THE JOB'S OUTPUT.** (26 Sep) `net._http_response`
keeps 6 hours (pg_net.ttl; not raisable on Supabase) and has no URL, so
`cron_health` claimed a 24h window it did not have and could not name a job.
`public.worker_calls` had both all along — every `cron_call()` by job name, kept
days. All 50 HTTP jobs now go through `cron_call` (8 bypassed it). The rule
"doing nothing at all" lives ONCE, in `public.workers_failing_every_run()`, used
by the texted alert AND the gate. A call that outlives the 30s wait usually
finished anyway — chief-of-staff never answered in time in 8 days and wrote all
14 briefings every morning — so slow jobs are proved by their output (`PROOF` in
cron_health), and a single failure already superseded by successes reports
instead of blocking. **`net._http_response` has NO index on `id`**: bound it by
`created` (indexed) and materialise before joining, or the planner may rescan it
per row — 100s+, and it failed a live monitor run on 26 Sep.

**THE REPO MUST DESCRIBE WHAT IS DEPLOYED — AND NOW A CHECK SAYS SO.** (26 Sep)
Seventeen live edge functions had no source here; six more were live on code
older than the repo (fixes committed in July and September that never shipped);
42 of 46 functions bundled an old `_shared/aiUsage.ts`. Causes, all fixed:
`deploy-functions.yml` skipped `_shared/` entirely (now redeploys every importer);
`property-research` had not PARSED since 19 Sep (a `//` comment swallowed its
closing brackets), so its deploys failed silently; 31 functions were live with
verify_jwt OFF but absent from `config.toml`, so their next deploy would have
locked out their cron/webhook callers. Guards: `edge_parse` (every function
parses; static, runs in CI), `function_config` (every deployed function has
source here; verify_jwt matches config.toml), `ai_cost_guard` (every AI-calling
function records its cost; 8 did not, 3 of those also had NO caller check).
**Verify a function deploy by its VERSION NUMBER**, not the CLI's message:
parallel `supabase functions deploy` runs reported success for three functions
that never changed. Recover missing source with
`npx supabase functions download <slug> --project-ref <ref> --use-api`.
Internal function-to-function calls send `x-qcp-token` as well as the service
key: two service-key formats are live, and a bare key compare fails when caller
and callee hold different ones — that is how 7 of 10 morning briefings were lost.

**MEASURE THE RETURN IN ONE PLACE: `business_outcomes(p_days)`.** (27 Sep) The
panel reported "no outcome recorded anywhere" because `ai_spend_with_outcome`
admitted only staff or the row's own user, and the panel reads as the SERVICE
ROLE — it got `[]` every night whatever the data said. Fixed (service_role
admitted), and `business_outcomes()` now composes the chain AI spend → leads →
answered → client → closing → GCI from facts already recorded, with
`blocked_by` naming the missing link. Attribution is live but has nothing to
attribute until closings carry the client: the Gold Report has NO client
column, and no contract has ever been extracted. `sheets-sync` now reads
Client / Buyer / Seller / Client Email columns the moment they exist. The same
audit found `speed_to_lead()` readable by ANY anonymous caller (the gate
allowed "auth.uid() is null") — fixed to staff or service_role.

**THE GOLD REPORT IMPORT WAS SILENTLY DEAD FOR FIVE DAYS.** (27 Sep) A note row
was added above the headers in both tabs (~22 Sep): every daily run read 0 of
~2,700 rows and answered ok. Fixed: the header row is FOUND, not assumed, and a
tab that imports nothing reports why. The same edit reformatted the paid-date
column as a DATE, so month.day numbers ("2.25") arrive as 1900 serials, and
"2.10" arrives as 2.1. The first re-import BLANKED 106 paid dates, restored at
once from `archive.brokerage_transactions_pre_resync_20260927` (snapshot taken
first — the rule paid for itself). Now 1900 serials are read back as typed,
and x.1 vs x.10 is settled by the received date. Re-imported: all 669 rows
match the pre-change values except 3 legitimate changes; 2 new closings
arrived. `cron_health` now proves the import WROTE rows in the last 26h.

**SNAPSHOTS GO IN `archive`, NEVER `public`.** Snapshotting a table before a data
fix is right; putting the copy beside the live table is not. By 26 Sep eleven
had piled up in `public` — `cfd_backup_20260923` alone was 12,420 rows, the
sixth-largest table in the system, and `txn_date_paid_backup_20260921` held
commission dates — where any broad report or schema scan could count them as
real. All moved to the `archive` schema (not exposed to the API, no app-role
grants). Do it this way:
`create table archive.<table>_<purpose>_<YYYYMMDD> as select * from public.<table> where ...;`
`smoke/snapshot_quarantine.mjs` fails the gate otherwise. Drop an archive table
once its fix is proven; they are rollback copies, not records.

**THE ANON KEY IS PUBLIC — A FUNCTION IT CAN CALL IS A PUBLIC WEB PAGE.** The
anon key ships inside the app, so anyone can call any function granted to
`anon` (Postgres grants EXECUTE to `public` by default, and `anon` inherits
it). On 27 Sep five functions answered strangers with real data:
`speed_to_lead` (every agent's response times), `beta_proof_metrics` (testers'
names, emails, activity), `brokerage_metrics` (YTD GCI $2.2M, deals, volume)
and the company average rate and price. `pg_stat_statements` showed no
legitimate anonymous caller. For every new function that returns business
data: `revoke execute on function ... from public, anon;` then grant
`authenticated`/`service_role` as needed, AND gate inside on
`is_brokerage_staff()` or `auth.role() = 'service_role'`. Never gate on
`auth.uid() is null` alone — a stranger passes that. `smoke/anon_exposure.mjs`
fails the gate otherwise (known-answer tested: reopening one function fails it).

**TABLES AND VIEWS, TOO (29 Sep).** The Sentinel flagged app_config and
agent_aliases as "readable by every signed-in account"; it was worse — their
read rules had no role, so strangers with the anon key could read them, and a
sweep of all 228 tables/views as anon found 13 readable. The worst were two
VIEWS without `security_invoker` (`lead_queue_v`, `overdue_waiting_on`): a view
runs as its owner and skips row-level security, so any stranger saw every
agent's pending leads and late promises. Fixed in
`supabase/sql/2026-09-29_close_open_reads.sql`: both views are security_invoker;
app_config is readable by agents only for browser-safe keys (today
`licensing_enforced` — add a key to that policy's list only if the browser truly
needs it), everything else owner/broker_admin; agent_aliases is staff-only
(brokerage-import uses the service key); knowledge, announcements and reference
lists are `to authenticated`. Only `idx_listings` (published IDX) stays public.
Rules: **every new view is `with (security_invoker = true)`**; every new policy
names its role (`to authenticated`); a `using (true)` read rule needs a reason.
`anon_exposure.mjs` now sweeps tables as anon too; `smoke/open_reads.mjs` fails
on any non-invoker view, any unlisted `true` read rule, or an agent reading a
staff-only setting or the alias list.

**LAST TIME — WHAT WAS SAID, NEVER HOW LONG AGO (30 Sep).** Ray (panel): "I
always forget what I said last time" — and he closes anything that scores the
relationship or shows the gap. `_shared/lastTime.ts` writes three plain sentences
(your last message, theirs, the last call), each with a calendar date; any
sentence about elapsed time or a score is dropped (`plainSentence`). Stored on
profiles.last_time; returned by contact-transact, ari-call-prep and prismTools
`contact_details`; shown by TransactLine ("Last time") on the contact screen and
in call prep. **House rule for every agent-facing AI surface: never "N days
ago", never "you should have", never a relationship score.** Applied to the
contact-research and call-prep prompts and Talk to Prism. Note: supabase-js
`.contains()` on a jsonb array of objects sends "[object Object]" — use
`.filter(col, "cs", JSON.stringify([...]))`. `smoke/last_time.mjs`.

**THE LIBRARY HOLDS TALKS; SHARED FILES OPEN FOR EVERYONE (30 Sep).** Ricky
Carruth's talk (recording, transcript, summary) is in Knowledge → Library, scope
brokerage. Fixed on the way: (1) storage policy `knowledge_read_shared` — a
`knowledge` file is readable when its knowledge_sources row is visible (before,
owner-only, so "whole brokerage" items could not be opened); (2) long audio
(> 6 MB) goes to AssemblyAI via signed URL and is collected by cron
`knowledge-transcribe-poll` (paragraphs + timestamps, `transcript` jsonb,
`speaker_names`); (3) embeddings are budget-batched with 429 back-off (Voyage
rate limits had left items "processing" forever) and an indexing failure now
reads as an error with Reprocess reusing the saved transcript; (4) publishing to
the brokerage is staff-only server-side; (5) knowledge-ingest accepts `as_user`
from the service only. UI: `src/views/LibraryOpen.jsx` (Listen / Open file /
Read). `smoke/library_shared.mjs`.

**CAN THEY TRANSACT (30 Sep).** Marguerite's condition for using the research
brief. `_shared/transactFacts.ts` (`gatherOwnWords` → `extractTransactFacts` →
`verifyFacts` receipt check → `transactLine`; `refreshTransact` stores on
profiles.transact_* and skips the model when nothing is new). Served by
`contact-transact` ({contact_id} or {sweep} at 6:35 ET), called by
contact-research and ari-call-prep, read by prismTools `contact_details`.
UI: `src/views/TransactLine.jsx` (contact screen, call prep). First-party only,
never the web (FCRA). `smoke/can_they_transact.mjs`.

**NO SSN, TAX ID, CARD OR BANK NUMBER REACHES AN AI MODEL (30 Sep).** Sentinel
+ Fiduciary asked whether contact-research put `contacts.tax_id_last4` in its
prompt. It did not (every AI function names its fields; those columns are empty
and `contacts_strip_tax_id_trg` keeps them so until the drop after 4 Oct). The
real exposure was FREE TEXT — notes, emails (title-company wiring
instructions), texts, call summaries. `_shared/aiGuard.ts` wraps `fetch` for the
AI hosts (Anthropic, OpenAI, Voyage, Gemini) and blanks SSN/ITIN, labelled tax
IDs/EINs, Luhn-valid card numbers and labelled account/routing numbers in every
TEXT field of the request; image/PDF base64 is never touched. **Every function
that calls an AI host must start with `import "../_shared/aiGuard.ts";`** —
`smoke/ai_guard.mjs` fails otherwise and holds the known answers (phones, ZIP+4,
prices, dates, MLS and parcel numbers must pass untouched).

**WHO JUST ASKED (30 Sep).** Panel wanted contact-research fired on lead
claim; instead the existing pieces were joined and fixed, at arrival: known facts
(`lead_known_facts`), readiness (lead-qualify — now accepts Zillow per-buyer
relay addresses and reads Zillow rentals; `force:true` re-reads), the three-line
`lead-brief` (service-callable; it had selected a non-existent column so every
"Who is this?" tap failed), and a facts-first push body. `lead_concierge_pending`
now returns `brief` and `known`. See docs/LEAD_STRATEGY.md; `smoke/who_just_asked.mjs`.

**EVERY AI CALL NAMES ITS SUBJECT (30 Sep).** Panel (Archivist + Merchant):
2,866 of 2,872 AI calls named nobody, so spend → person → deal could not close.
Now each function passes what it already holds to the logger (`subjectType` +
`subjectId`: contact / lead_card / call / email_thread / email_message /
commitment / transaction / deal, and/or `subjectEmail` / `subjectPhone`); the
BEFORE INSERT trigger `ai_usage_subject` on `ai_usage_log` resolves
`contact_id`, `subject_email`, `subject_phone` and `about` ('person' | 'deal' |
'no_one'). Functions truly not about one person are listed in
`ai_fn_not_about_a_person()`. **A new AI function must do one or the other** —
`smoke/ai_subject_guard.mjs` fails otherwise (static) and proves each kind
resolves (live). closing_attribution counts spend by contact, by address, or by
the transaction itself. History recovered where timing proves it (concierge,
calls, inbox triage); nightly inbox reads before 30 Sep stay unattributed.
`txn_parties_from_contract_trg`: a contract read by txn-contract-extract now
fills the transaction's buyer/seller when empty, so closings get their client
without anyone typing it.

**AN ALERT THAT REACHES NOBODY (29 Sep).** Every push the DATABASE sent
(`notify_lead_escalation`) used vault `service_role_jwt`; push-send only knew the
sb_secret key, answered 401, and nothing recorded it — the lead ladder was
silent from the day it shipped. push-send now uses `_shared/serviceCaller.ts`
(it also accepted ANY token starting `sb_secret_` — anyone could push anyone),
logs every send to `push_log`, and clears `last_error` on success (stale errors
made working phones look dead). From SQL, call functions with vault
`service_role_key` (what `cron_call` uses). The ladder skips anyone who fails
`lead_reachable()`, and checks `lead_was_acted()` before moving a lead. See
docs/LEAD_STRATEGY.md "Reach"; `smoke/lead_reaches_a_person.mjs`.

**"auth.uid() IS NOT NULL AND …" IS NOT A GUARD.** In a SECURITY DEFINER
function the body's own check is the only lock, and a signed-out caller's uid is
NULL — so that condition is false and the whole check is skipped. set_tax_id
and merge_contacts both had it, both callable with the anon key (27 Sep). Deny
first: `if auth.role() is distinct from 'service_role' then if auth.uid() is
null then raise ...; if auth.uid() <> owner and not is_brokerage_staff() then
raise ...;`. Also: a `raise` rolls back an audit insert made just before it, so
"log DENIED then raise" logs nothing (reveal_tax_id, set_tax_id). And no
sensitive column (tax ID, SSN, account, passport) goes on a table other agents
can read by sharing — contacts is one. Tax IDs live only in `contact_tax_ids`
(owner + staff), read and written through `src/taxId.js`.
`smoke/definer_guard.mjs` enforces both.

**NO THIRD-PARTY CREDENTIAL EVER REACHES THE BROWSER, AND NO KEY LIVES IN A
FUNCTION'S ENVIRONMENT.** Found 27 Sep (panel asked about the iCloud key): the
app loaded `email_accounts` with select('*'), so every agent's Gmail refresh
token — standing access to their mailbox — sat in their phone's memory; and an
agent's session could rewrite `icloud_connections.calendar_home_url`, the
address icloud-sync sends the Apple password to every 20 minutes. Now: token,
password and ciphertext columns are withheld from anon/authenticated (the app
reads `has_refresh_token`; select('*') on these tables FAILS — use
`EMAIL_ACCOUNT_COLS` in src/helpers.js, and GRANT any new column); the iCloud
key is in Vault (`icloud_key`) and only the database encrypts/decrypts, via
service-role-only functions; credentials are only ever sent to https://*.icloud.com.
Honest limit: every edge function holds the service-role key, so a compromised
function can still ask the database to decrypt. Vault means the key is never in
a function's env, logs or memory, and rotates in one place.
`smoke/definer_guard.mjs` enforces the browser half.

**A DECODED TOKEN IS NOT A VERIFIED ONE.** 112 functions run with verify_jwt =
false, so the gateway checks nothing; the function must. Five decided "service
role" by base64-decoding the JWT and reading `role` — an unsigned, hand-typed
`{"role":"service_role"}` got a 200 (tested 27 Sep). calendar-sync then took any
agent's user_id from the body; task-autoschedule also trusted a decoded `sub`
as the user. Service callers: `isServiceCaller(req)` from
`_shared/serviceCaller.ts` (exact key, QCP, or a token PostgREST's root accepts
— it answers only to a real service key). Users: `auth.getUser(token)`.
`smoke/edge_auth.mjs` now fails any function that trusts a decoded role or sub.

**THE CLAUDE CONNECTOR (prism-mcp, 27 Sep).** PrismOS is a remote MCP server:
`https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/prism-mcp`. Sign-in is
Supabase Auth's own OAuth 2.1 server (Authentication > OAuth Server: on,
authorization path `/oauth/consent`, dynamic registration on). The consent page
is `src/views/OAuthConsent.jsx`, routed in App.js; the auth server only accepts
consent calls from the Site URL origin (darasapp.com). Rules that make it safe —
keep all of them when adding tools:
- Every tool queries through the client built from the caller's OWN token, so
  RLS decides what Claude sees. Never read client data with the service role in
  a tool (the only service-role write is the `mcp_calls` usage log).
- Tokens are verified with `auth.getUser`, and must carry `client_id` (minted by
  the consent flow, not a copied app session).
- The consent page approves only requests returning to claude.ai / claude.com.
  Dynamic registration lets anyone register a client; a look-alike is refused.
- `mcp_access` gates who may use it at all. Staff-only tools set `staffOnly`.
- v1 sends nothing to anyone (no email/text). Adding a sending tool is a
  decision for Dara, not a code change.
`smoke/mcp_connector.mjs` runs the whole sign-in as Claude would and proves RLS
and every gate on each gate run (known-answer tested: opening the allowlist
fails it).

**WHERE CLOSINGS CAME FROM (28 Sep).** The brokerage does NOT run its own lead
generation — every agent generates their own (Dara, 28 Sep). So attribution
answers, per closing: who the client was, where they came from, how fast they
were answered. `closing_attribution(from, to)` (one row per sale; staff see all,
an agent only their own) and `lead_attribution(days)` (by source, by agent,
closings missing a client) in `supabase/sql/2026-09-28_lead_attribution.sql`.
Source precedence: the Gold Report "Lead Source" column (sheets-sync writes
`brokerage_transactions.lead_source` when that column exists — it does not yet)
> the earliest PrismOS record of the client matched on CLIENT Email (or on a
full name when the row has no email): company lead, lead card, the agent's
contact (prospecting system / referral / origin). Records dated after the
closing never count. `lead_source_bucket()` folds free text into ~15 fixed
sources. The Gold Report's CLIENT NAME / CLIENT Email columns start 28 Sep 2026:
older closings have no client BY DESIGN — never report them as a gap.
`business_outcomes()` now reads its closings from `closing_attribution`. Broker
card: `src/views/DealAttribution.jsx` on the goal roster. Panel reads
`lead_attribution(90)` with that context. `smoke/lead_attribution.mjs` plants
known closings in 1999 and checks every answer.

**TALK TO PRISM (talk-to-prism, 27 Sep).** The voice screen: `/?talk=1`
(`src/views/TalkToPrism.jsx`, routed in `src/publicRoutes.jsx` — App.js is at its
line budget, so stand-alone pages live there). Its own home-screen icon comes
from the launcher page `/launch/talk/`; the main manifest also carries a "Talk"
shortcut (long-press the PrismOS icon). The phone listens and speaks (browser
speech APIs, free); `supabase/functions/talk-to-prism` thinks. It shares the
connector's tools (`_shared/prismTools.ts` — ONE list for both; add a tool there
and both get it) and the same rules: user-scoped client, `mcp_access`, no
sending. **Nothing changes without a yes:** a write tool call stops the loop and
comes back as `pending`; only a follow-up `decision:"confirm"` runs it, and
saying anything else drops it (the function answers the dangling tool call
itself). The prompt tells the model to ask AND call the tool in one turn — when
it only asked in words, the person had to say yes twice. Conversation lives on
the phone; each model call goes to `ai_usage_log`, each tool call to
`mcp_calls` (client_id `talk-to-prism`). `smoke/talk_to_prism.mjs` proves the
gates, a real answer from the person's own data, and the no-yes rule (about
five cents of AI per gate run).

**THE BOOKS: WHO MAY SEE WHICH MONEY (6 Oct, v1.16.08).** Dara: he, Josh and
Alexander keep the brokerage's books in PrismOS; each person keeps their own; a
team's leader controls the team's, with an assistant who can be switched on and
off. "We don't want a double entry system ... checkbook style." And: an agent's
own books are the agent's — **being Broker or Broker Admin opens nobody's books.**
- **One ledger.** No second transactions table. A *book* (`public.books`: personal
  | team | brokerage) is one separate set of accounts, and every row of
  `transactions`, `tax_categories`, `money_accounts`, `recurring_transactions` has
  a `book_id`. Personal rows keep `user_id` = the owner, so every older reader
  that asks for "my rows" is unchanged. **Shared-book rows have `user_id` NULL**,
  so no personal report or tax form can pick them up. Trigger `book_row_stamp`
  sets both on every write whatever the caller sends (a phone on an old version
  sends `user_id` only and still lands in the right book).
- **Access is a list:** `book_access` (owner / admin / assistant / read_only,
  `is_active` = the switch). Policies ask `my_books_readable()` /
  `_writable()` / `_manageable()`; they were ADDED beside the old "own rows"
  rules, never instead. Off takes effect on the next request. Never gate a book
  on `is_brokerage_staff()` — `smoke/books_guard.mjs` fails on it.
- **Client: `src/books.js`** — `inBook(query, book, userId)` and
  `stamp(book, userId)` are the ONLY way a Money screen reads or files entries;
  `can(book, what)` decides which buttons draw. `BookBar.jsx` (name of the open
  book, sticky, + switcher), `BookAccess.jsx` (the list, the switch, the record),
  `BookRoom.jsx` (Money for a book that is not your own: Add / Reports / Setup).
  `FinanceView` → `OwnMoney` (the old room) or `BookRoom`. Menu "Brokerage
  Financials" opens the brokerage's books (`sub: 'brokerage'`).
- **Released to three people:** `accounting_access` (Dara, Josh, Alexander).
  Everyone else sees Money as before unless put on someone's book. Switch a person
  on: `insert into accounting_access (user_id, note) values (...)`, then they get
  the starter categories on their next visit (`book_category_templates`, one set
  per kind of book; seeding runs once per book, `books.seeded_at`).
- **The record:** `book_log` — every entry added/changed/removed (who, before,
  after), every access change, every category/account change, closing and
  reopening. Append-only even for the service key (trigger `book_log_locked`).
  `transactions.entered_by` / `updated_by` sign each entry.
- **Closing:** `books.closed_through`; entries dated on or before it cannot be
  added, changed or deleted (`book_entry_guard`), nor a category they use deleted.
- **A waiting seat** (named before the person has a sign-in) binds at their first
  visit with that email CONFIRMED. Assistant / read-only named in the last 30 days
  opens by itself; an owner/admin seat or an older one binds switched OFF until
  an owner switches it on (a mistyped or recycled address must not open books).
- **Not built yet, on purpose:** repeating entries and receipts in shared books
  (`run-recurring-transactions` files whatever it can see as the caller's, so the
  recurring table has NO book policies — teach the function about `book_id` first;
  receipts live in the uploader's private folder); statement scanning, sticky
  rules, bank reconciliation, 1099s; and **audit-grade escrow accounting** — an
  account can be marked `escrow` and "held for others" categories stay out of
  income, but there is no per-owner/per-tenant ledger or monthly three-way
  reconciliation. Do not tell anyone the escrow side is audit-ready.
- Seeds: brokerage book (Dara owner, Josh + Alexander admin); "Team Blue Koala"
  (property-management categories; three equal owners: Dara, Alexander and
  Tina Danielson — Dara is the one nobody else can switch off or remove; Tina's
  seat waits for her sign-in and an owner's switch; Myra Torres assistant,
  waiting for an email). Alexander's Broker Admin role and his Blue Koala seat
  are separate facts; Tina has no seat on the brokerage's books. `books.team_id` is NULL on Blue Koala — if a
  `teams` row is ever made for it, set `team_id` or `team_book_sync` makes a
  second book.
- Found on the way: `transactions_entered_via_check` refused `'deal_close'` and
  `'ari'`, which the app has been writing — commission income on deal close and
  entries added by voice were being rejected. Widened.
- `smoke/books_guard.mjs` (three real sign-ins, every accounting table; known-
  answer tested: planting a seat for the outsider fails it 12 ways) and
  `smoke/look_books.mjs` (screenshots of the book screens; not in the gate).
  SQL: `supabase/sql/2026-10-06b_books.sql`. A new accounting table goes in the
  guard's `TABLES`.

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
Nine install pages under `public/launch/<key>/` (the ninth, `talk`, opens Talk to Prism), each with its own manifest and
icon, generated by `scripts/make_launcher_pages.py` and
`scripts/make_launcher_icons.py`. **Regenerate with those scripts — do not
hand-edit the generated files.** `scope` is `/` on every manifest and `id` is
pinned per launcher. In-app: tuning fork → Launchers. `?view=` and `?sub=` are
whitelisted in `launchTarget()`.

---

## 13. OPEN ITEMS (26 Sep 2026)

**Scheduled cleanup (code, no decision needed)**
- **After 4 Oct 2026: drop `contacts.tax_id_last4` and `contacts.tax_id_type`.**
  Kept one release as always-empty columns (trigger `contacts_strip_tax_id_trg`
  blanks them) so phones still on v1.08.73 can save contacts — that build sends
  `tax_id_type` in every save and would fail on a missing column. Drop the
  columns, the trigger and `contacts_strip_tax_id()`, then remove TRANSITIONAL in
  `smoke/definer_guard.mjs` and the `contacts.tax_id_type=ssn` entry in
  `smoke/stale_readers.mjs`.

- **28 Sep, after 03:00 EDT: confirm the staged email-token revoke ran.**
  `select has_column_privilege('authenticated','public.email_accounts','refresh_token','select')`
  must be false and cron job `email-accounts-hide-tokens-once` gone. Then delete
  the STAGED block in `smoke/definer_guard.mjs` (the guard fails on its own if
  the revoke did not happen).
- **Move `AI_KEY_ENC_SECRET` into Vault**, the iCloud way. Personal AI keys
  (`user_ai_keys`) are encrypted with a key held in the environment of 8 edge
  functions. 0 keys stored today, and the browser can no longer read the
  ciphertext, so nothing is exposed — do it before the first agent saves a key.
  Pattern: `_shared/icloudCredential.ts` + `icloud_set_password/get_password`.

- **Texts are not in the lead funnel.** SMS cards to producing agents carry no
  `source`, so `lead_funnel` and `lead-qualify` skip them (LEAD_STRATEGY known
  gap). Tag a source in quo-webhook only once `sms_lead_verdict` proves intent,
  or the funnel fills with vendor texts again.

- **PrismOS connector for Claude — widen after Dara's trial week (from 27 Sep).**
  Only people in `mcp_access` can use it (Dara today). Add an agent with
  `insert into mcp_access (user_id, note) values ('<auth id>', '<name>')`. See
  "THE CLAUDE CONNECTOR" in §8 before adding tools. The same list gates Talk to Prism.

**Waiting on Dara — do not start these uninvited**
- **The tiered gate.** Full gate for logic/DB changes, fast gate for wording and
  layout. Deliberately NOT built: it trades safety for speed and that is his call.
- **On temporary hold at his instruction:** Telnyx 10DLC brand + campaign
  registration, and connecting Mary Sous's email. Both block real work
  downstream; neither is a coding problem. The full Telnyx build prompt is
  written and waiting.

**Needs a human, not code**
- **Gold Report, 27 Sep additions:** Paid 2026 Trans ID 108 (1905 N Oregon Ave #20)
  shows paid 30 Mar but received 28 Apr; Trans ID 230 has a paid date "7.3" (3 or
  30 Jul?) and no address or received date. And the one change that unlocks ROI
  measurement: add **Client** and **Client Email** columns.
- **12 transactions in the Gold Report sheet** are wrong at the source: Josh's
  $43.96 on $350k, Demi Noack's $0.00 on $550k, dates typed "710", "3/34",
  "10/41", "69/2026". Do not guess these.

**The one that matters**
- **Activity, not features.** Only four people use this app, and a phone call to
  one agent is still worth more than the next feature. 78 of 89 agents have no
  goal set despite onboarding shipping to fix exactly that.

**Known and open**
- **Vickie Mitchell (vickiemitchellfl@) gets no morning briefing by design now**:
  no email account, no phone notifications, last sign-in 29 Jul. The delivery
  job records "no delivery channel" and no longer pays to write one ahead; the
  Briefing screen writes it on demand if she opens the app. A human question,
  not code: is she still an active user?
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
