# PrismOS — handoff (STANDALONE). Last updated 17 September 2026.

**This file replaces every earlier handoff.** It depends on no other document.
Read §1 and §8 before touching anything.

Live at time of writing: **v1.08.21**. A SECOND Claude session often works this
same repo, so the version you see may be ahead of this file. Always
`git log --oneline -12` after cloning.

---

## 1. BEFORE YOU DO ANY WORK

### 1.1 Always fresh-clone
```bash
cd /home/claude && rm -rf khoyi
git clone -q https://<PAT>@github.com/DaraKhoyi/khoyi.git
cd khoyi && git log --oneline -12
git config user.email "dara@brokerdara.com"
git config user.name  "Dara Khoyi"
npm install --no-audit --no-fund      # scope_check needs @babel/parser
```

### 1.2 Verify the token FIRST — it fails silently
The repo is **public**, so a clone with a dead token still succeeds; you only
find out at the push.
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://api.github.com/user \
  -H "Authorization: Bearer <PAT>"     # 200 = alive, 401 = STOP, ask Dara
```

### 1.3 Check the live version before bumping
```bash
curl -s "https://darasapp.com/sw.js?cb=$RANDOM" | grep -o 'prismos-[a-z0-9]*'
```
Never read it from raw.githubusercontent.com — it caches and lags.

### 1.4 RUN THE WHOLE GATE, NOT MOST OF IT
The single most repeated failure of this month, three times in one week: running
scope_check, calling it green, and pushing something jsx_escapes or the file
ratchet would have caught. **The gate has seventeen stages. Run all of them.**

---

## 2. Keys and identifiers

**THE SECRETS ARE NOT IN THIS FILE, AND MUST NEVER BE.** `DaraKhoyi/khoyi` is a
PUBLIC repository. An earlier draft of this handoff pasted the GitHub and
Supabase tokens here out of habit, copied from the old project-file version, and
GitHub's push protection refused the push — correctly. Anything committed here is
world-readable the moment it lands.

Ask Dara for, or read from the project files rather than the repo:
  GitHub PAT        fine-grained on DaraKhoyi/khoyi, Contents + Workflows +
                    Actions + Secrets, all Read and write
  Supabase Mgmt PAT sbp_...
  QCP_TOKEN         internal token required by night-review, panel-propose and
                    commitment-nudge

**Project ref:** `xlgfspnojjgvkuitcoaf` · **App:** https://darasapp.com
**Repo:** `DaraKhoyi/khoyi` (public), branch `main`
**Dara's user_id:** `ad06bbc1-a1cb-4716-84d3-36f426ea3187`
**Dara's mobile (roster):** `+17275147777` · **Quo line:** `+18134456295`
**Anon key** (build time): safe to expose by design, but read it from the project
files or from Supabase rather than pasting it into the repo.
**Service-role key:** fetch live, never paste stale:
```bash
curl -s "https://api.supabase.com/v1/projects/xlgfspnojjgvkuitcoaf/api-keys?reveal=true" \
  -H "Authorization: Bearer <SUPABASE_PAT>" -H "User-Agent: KhoyiApp/1.0"
```

**Key people:** Josh Maples `f122858e-ec92-44dc-bea2-a5f629054e82` ·
Alexander Khoyi `21c8bf05-...` (agents row), auth `122eafc8-37db-41ed-beb6-4cb0c192527d`,
email `alex@brokeralex.com`, **iPhone** · Dara on Samsung S26 Ultra, large system font.

---

## 3. Stack and layout
- **React 19 SPA**, Vite. `src/App.js` ~2085 lines (HARD RATCHET — see §8).
  Feature screens in `src/views/*.jsx`. Global CSS `src/index.css`.
- **Supabase** — Postgres + RLS + edge functions + pg_cron (**62 jobs**) +
  pgvector. **202 tables.**
- **GitHub Pages** on `gh-pages`, custom domain darasapp.com.
- **Anthropic Claude** (`claude-sonnet-4-6`) reasoning + OCR; **AssemblyAI**
  transcription; **OpenAI/Voyage** embeddings.
- `src/modes.js` owns the six ROOMS, their bars, glyphs and accents, plus
  `roomEntry()` and `launchTarget()`.
- `src/clock.js` — **New York time, always.** See §8.

---

## 4. How to ship
Push-to-main; CI builds and publishes. Bump `BUILD_VERSION` in `src/version.js`
only. Never hand-edit `public/sw.js`.

```bash
export REACT_APP_SUPABASE_URL="https://xlgfspnojjgvkuitcoaf.supabase.co"
export REACT_APP_SUPABASE_ANON_KEY="<anon>"
rm -rf build node_modules/.vite && GENERATE_SOURCEMAP=false CI=false npx vite build
# then a throwaway auth user + seed, then:
setsid bash smoke/run.sh > /tmp/gate.log 2>&1 < /dev/null &   # ~6 min
```
Green = `SMOKE: 64/64`, `LARGE FONT: 37/37`, `FUNCTIONAL: 128/128`, plus the
static guards. Verify live by SHA prefix; CDN lag 2–20 min.

**The static guards, all of which have caught a real bug:**
`scope_check` · `jsx_escapes` · `appjs_budget` (file ratchet) ·
`menu_reachable` · `edge_auth` · `clock_check` · `icon_check` ·
`hooks_check` · `data_integrity` · `mutation_guard` · `hover_guard` ·
`nested_component_guard` · `openscreens_check` · `responsive`

Edge functions deploy via `.github/workflows/deploy-functions.yml`, or manually:
```
POST https://api.supabase.com/v1/projects/{ref}/functions/deploy?slug={slug}
  metadata={"entrypoint_path":"index.ts","name":"{slug}","verify_jwt":false}
  file=<index.ts>   headers: Authorization: Bearer <PAT>, User-Agent: KhoyiApp/1.0
```
PATCH updates metadata only → BOOT_ERROR.

---

### 4.1 LOOK AT THE SCREEN BEFORE YOU COMMIT

`smoke/look.mjs` captures any view at phone width AND at 135% type, and the
images are meant to be OPENED and examined, not just generated.

```bash
node smoke/look.mjs today tasks contacts        # the views your change touched
LOOK_BASELINE=1 node smoke/look.mjs today       # save a "before" first
```

With a baseline it also reports which screens MOVED — including ones you did not
mean to touch, which is the failure nobody goes looking for.

Use it for every change that alters anything visual. Four styling faults shipped
in one week without it — a card border set to the divider token, two tabs drawing
the same icon, a label truncated to "Transacti…", an icon mark drowned by its own
background. Every one was valid CSS, so no test could have caught any of them,
and Dara found all four by eye. That is not a reasonable thing to ask of him.

## 5. Standing build requirements
**"GREATNESS IS THE MINIMUM."** No placeholders.
1. **MULTI-USER.** Scope by `user_id`/role; never hardcode a person.
2. **iOS AND Android.** Dara Samsung; Alexander and most beta agents iPhone.
   **WebKit is where the layout bugs are** — see §8.
3. **Every change through the gate.** Layouts hold at 135% system font.
4. **AI-cost attribution:** every token-spending function logs via
   `logAiUsage` / `logEmbeddingUsage` in `supabase/functions/_shared/aiUsage.ts`.

**Working protocol Dara expects:** ask "easiest or BEST?" → best; check the work
before declaring it done; name blind spots; push back — he wants a design
partner. "Go"/"Yes" = press through the whole build.
**Dara is a coding novice — explain in plain English.**
**LOOK AT THE SCREEN.** Three faults this month were invisible in code review and
obvious in a screenshot: identical tab icons, a truncated label, a drowned mark.

---

## 6. Brand — "Prism Editorial"
Warm near-black `#100D09`, cream `#F6F1E7`, gold ramp `#7A5020`→`#C5A95E`→
`#EBCB82`. Fraunces light serif headlines, Barlow Condensed eyebrows, Manrope body.
**Gold is value; the room accent is structure.** Room accents live in `modes.js`.
Page titles follow the **"My ___"** convention Dara set: My Dashboard, My
Transactions, My Blueprint, My Drives, My Scripts, My Growth, Today's Hunt.

---

## 7. People and context
**Dara Khoyi is MALE (he/him).** Owner/Broker, **Realty ONE Group Advantage**
(Tampa/Lutz FL), ~96 active agents. Licensed entity **Teamkar Realty, Inc.**
d/b/a ROGA. **Team Blue Koala** (Dara, Tina Danielson, Alex Khoyi) owns the
property-management book, ~280 doors.
Wife **Anvar**; son **Alex** (broker_admin); daughter **Natasha**; brother Dana.
**Josh Maples** — office manager, broker_admin, greet him "Joshua".
Dara calls Claude **"Einstein"** (also Albert / Al).

---

## 8. HARD-WON LESSONS

**RUN THE WHOLE GATE.** Three CI failures in one week, each from running some
stages and pushing. The guards exist because each one caught something real.

**NEW YORK TIME, ALWAYS — `src/clock.js`.** `toISOString().slice(0,10)` is UTC
and was used in 30 places; from 8pm Eastern the app wrote TOMORROW'S date.
Postgres `current_date` is UTC too — use `public.today_ny()`. The device supplies
the instant, never the zone. Always the IANA zone, never a fixed offset.

**WEBKIT IS WHERE THE LAYOUT BUGS ARE.** Chromium papers over what Safari
enforces. Two examples from one day: a scrolling flex child without
`min-height: 0` pushes its sibling — the footer with the Save button — clean out
of the modal; and `vh` on iOS is the LARGE viewport, so a 92vh modal is taller
than the visible screen. Use `dvh` with a `vh` fallback.

**A SILENT FALLBACK HIDES A SYSTEMIC FAULT.** `ModeBar` keeps its OWN glyph table
separate from `icons.jsx`, and an unknown name renders a default star without
complaint. Fourteen names did not exist; ~25 tabs across every room drew the same
picture. `smoke/icon_check.mjs` now fails the build on an unknown glyph AND on
two tabs in one bar sharing a picture.

**THE MENU HAS TWO SOURCES.** `menuConfig.js` builds most of it, but the
Brokerage and Team groups come from `brokerageGroup`/`teamGroup` in App.js and
are SPLICED IN, replacing whatever menuConfig has. Adding a Brokerage entry to
menuConfig.js does nothing. A view also needs to be in `builtSet` or it renders
greyed as "SOON" and swallows the click. `smoke/menu_reachable.mjs` checks both.

**supabase-js DOES NOT THROW on a failed write** — it resolves `{ error }`.
Check `error` on every mutating call; roll back optimistic UI.

**iOS STALE SESSION** — a backgrounded tab wakes with an expired token; RPCs fail
closed and edge calls 401. Fixed by wrapping `functions.invoke` AND `supabase.rpc`
with `ensureFreshSession()` plus a wake-refresh effect. Suspect this first when
"nothing happens" on mobile.

**RLS IS THE GATE; GRANTS ARE SECONDARY** — but revoke anyway. The Sentinel found
anon holding INSERT/UPDATE/DELETE on five tables; RLS blocked it, so the finding
overstated the risk. Write grants to anon are now revoked schema-wide.

**THE FILE RATCHET IS LOAD-BEARING.** App.js is pinned at 2085. When it pushes
back, the answer is a new module — `roomEntry()` and `launchTarget()` both moved
to modes.js that way and App.js came back UNDER budget. Raise a budget only with
the reason written beside it.

**DON'T TRUST A GREEN RECALC.** An xlsx passed recalculation with zero errors and
completely wrong numbers — the formulas pointed one column off. Check figures
against the database, not against "no errors".

**FLORIDA IS ALL-PARTY CONSENT (§ 934.03).** It bans INTERCEPTION, not recording:
live transcription without storing audio is still interception, and so is a
device-derived behavioural read. Third-degree felony. Consent must be captured
BEFORE the device listens. A human listening and taking notes is not interception.

---

## 9. THE PANEL — twelve specialists, nightly

`night-review` runs at **1:00 AM New York** (cron at 05:00 and 06:00 UTC; the
function checks the NY hour so it holds through DST). 21 runs, 127 findings.

**Members:** Architect · Skeptic · Archivist · Curator · Simplifier · Newcomer ·
Accountant · Merchant · **Fiduciary** (trust accounting, veto on client money) ·
**Sentinel** (security) · **Marguerite** (agent, Android, market-first) ·
**Ray** (agent, iOS, does not follow up and will not admit it).

Marguerite and Ray have STANDING BRIEFS in Dara's own words, in the PANEL array —
do not paraphrase them away. They outrank everyone on whether a screen is usable.

**THE COUNCIL:** three rounds — file blind, read all twelve, file again. Changing
is NOT required and most will not; change is MEASURED against a preserved
`round1` rather than claimed. Both extremes are reported: nobody changing means
they are not reading each other, everybody changing means they are performing
agreement. A healthy night is 2–3 of 12. Each night it also reviews ONE WORKING
AGENT on rotation, which is how the panel improves the other agents.

**It cannot commit.** `night_review_config.autonomy_level` is 0 (propose only).
`panel-propose` branches, commits and waits for CI; **nothing merges on a red
gate**, migrations/workflows/gate scripts/version.js/dataService.js are never
editable, and there is a nightly cap. Review UI: Brokerage → Overnight Review.

---

## 10. THE SYSTEM LEARNS FROM USE
Dara had dismissed 4,926 concierge cards and every correction was discarded.
`learn_from_dismissals()` (nightly) mutes a sender after **3+ dismissals and zero
actions**; never mutes anyone he has replied to. **549 rules, 85 promoted to
brokerage-wide** by `promote_shared_sender_rules()` when 2+ agents reject the same
sender independently — so a new agent inherits them on day one.

`commitment-nudge` (9am NY) texts ONE name BEFORE the deadline — Marguerite's
"build the text, not the list". Own phone only; one a day; silent when nothing
is due.

Notifications: `gmail-sync` pushes only for senders you KNOW (replied to or in
contacts), at most one an hour, with a fallback to "not bulk" below 25 known
correspondents so a new agent is not silenced.

---

## 11. LAUNCHERS
Eight install pages under `public/launch/<key>/`, each with its own manifest and
icon, generated by `scripts/make_launcher_pages.py` and
`scripts/make_launcher_icons.py`. **Regenerate with those scripts — do not
hand-edit the generated files.** `scope` is `/` on every manifest (the launcher
opens the real app) and `id` is pinned per launcher. In-app: tuning fork →
Launchers. `?view=` and `?sub=` are whitelisted in `launchTarget()`.

---

## 12. OPEN ITEMS (17 Sep 2026)

**The one that matters:** **2 agents active in 7 days** out of ~96; 14 have ever
logged in. Two beta testers failed to show for a scheduled meeting. Nothing built
this month changes that number, and a phone call to one agent is worth more than
the next feature.

- **78 of 89 agents have no goal set**, despite onboarding shipping specifically
  to end "with a goal and a reason to come back".
- **252 commitments expired silently** — the nudge now fires before the deadline,
  but the backlog is still there and is the first thing Ray would see.
- **The concierge learns only from rejections.** 424 auto-learned "not a lead"
  rules and ZERO auto-learned "lead_ok". Found by the council; still open.
- **Four rooms unreviewed** for duplicate titles and icons: Nerve Center,
  Library, Deals, Brokerage. Money and Prospecting each had faults.
- 3 unlinked transactions remain — all blank rows, no name/date/amount.
- Property management: Phase 0 is the accounting spine. See the build prompt.
  Awaiting Chase API answer and a reconciled opening escrow balance (~$480k from
  memory, not from a statement).
- Telephony: Telnyx recommended; awaiting the attorney on consent wording and on
  the 683 existing recordings.
- Phone-number fields do not validate — an 11-digit number saved silently.
