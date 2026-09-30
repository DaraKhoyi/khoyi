# Lead strategy — how PrismOS finds, routes and learns about leads

Written 21 Sep 2026, from Dara's direction: *"Learning from me is not a good way
to fine-tune surfacing leads. Develop a better strategy."* Every lead feature,
edge function and AI agent follows this. Change it here first.

## The principle

A brokerage does not need a better spam filter. It needs a **lead pipeline**:
recognise a lead the way the industry actually delivers it, get it to someone who
sells, answer it fast, and learn from the people who convert.

The one number that predicts conversion is **speed to lead** — minutes from
arrival to first reply. Portal buyers usually inquire with several agents at once
and go with whoever answers first and most usefully. Judge everything by that,
not by cards surfaced or suppressed.

## 1. Recognise — in this order

1. **Source template** (`lead_sources`, `match_lead_source()`). Zillow,
   realtor.com, Homes.com, Redfin, rental portals, the brokerage IDX site, the
   Realty ONE Group site, CRM platforms (kvCORE, BoomTown, Follow Up Boss…),
   showing requests, home-value requests. Each is its sender **and** the exact
   shape of its lead subject. Checked **before** any bulk filter: portals send
   from notification addresses and Gmail files many under *Updates* — the old gate
   discarded real buyers for exactly that reason. The same domains send marketing
   ("Your 33756 leads are inside"); only the template tells them apart.
2. **Referral** from an established contact — someone the agent knows saying a
   friend, relative or neighbour wants to buy or sell. The largest lead source for
   most agents; the old gate skipped every established contact by definition.
3. **Direct inquiry** from a stranger — only with stated intent: *a person saying
   what they want* ("we're looking to buy", "can we see it Saturday", "what's my
   home worth"). Not topic words — "home" and "property" are in every newsletter.
   And not a **pitch**: a vendor says *"your buyer"*; a lead says *"I want to buy"*.

Everything else still reaches the inbox (*Worth a look*). It is simply not a lead.

## 2. Route — by role

`agents.production_role`: `producing` | `broker` | `staff`.
Dara is broker, Josh is staff (office manager), Alexander and Mary produce.

- A lead reaching a **producing** agent becomes their concierge card with a
  first reply drafted in their voice.
- A lead reaching the **broker or office manager** goes to `brokerage_leads` and
  waits on Goals & Pace, with how long it has waited, until it is assigned to a
  producing agent (`assign_brokerage_lead()` → drafted reply + push to that agent).

## 3. Learn — both ways, only from producers

- **Acted** = replied by email, called, or sent the concierge draft
  (`lead_was_acted()`). Counting only the concierge draft recorded 20 responses
  where agents had actually answered 371 — and muted people they had answered,
  including Dara's business partner.
- **Surface** (`lead_ok`): acted on 2+ times, or once on a recognised source.
  Beats any mute.
- **Suppress** (`not_a_lead`): dismissed 3+ times by a producing agent, never
  acted on, not a lead source. Expires after 180 days.
- **Brokerage-wide** mutes need two *producing* agents. Never a lead source.
- Cards the gate itself retires are `archived`, not `dismissed`, so they never
  teach a mute.

## 4. Reply — how top agents answer each kind

- **Portal buyer:** name the property, offer two concrete times today or
  tomorrow, ask one qualifying question (pre-approved? timeline?). Never
  "thanks for reaching out".
- **Referral:** thank the referrer; ask the best way to reach the person.
- **Rental:** confirm availability or offer alternatives, propose a viewing, ask
  the move-in date. Renters are next year's buyers.
- **Home-value request:** a seller. Promise a real market analysis, not an online
  estimate; ask about condition or updates.

## 5. Measure

**27 Sep — readiness, and the funnel instead of a rate.** Marguerite (panel):
"I am not going to answer 568 things to close 1 deal... the number that matters
is whether the lead could ever buy." Two changes:

- **`lead_readiness` (per PERSON, written by `lead-qualify`).** From the portal
  template, no AI: budget band from listing prices, areas, repeat inquiries,
  closed with us before. From the lead's OWN words (their portal comment, and
  every email/text they send after), read by a small model: pre-approved / cash /
  talking to a lender, timeline, must sell first, already has an agent, move-in.
  Each fact keeps their quote; nothing is inferred. Grade: **ready** (can pay +
  inside 3 months), **active**, **early**, **not yet known** — with the one
  question to ask next. Shown on the agent's card and the broker's queue.
- **Pre-approval is only known because the buyer says it** — CINC's badge is
  the buyer's own form answer. Portal leads never carry it, so the first reply
  now asks it and offers a lender, and `lead-qualify` (every 15 min, and on
  arrival) reads the answer when it comes back.
- **`lead_funnel(days)`** replaces the answer rate everywhere (panel, broker
  screen): recognised leads once per person → answered → inside 5 min → wrote
  back → told us about pre-approval → ready. `noise_cards` = non-leads still
  shown; should sit near zero.

- `speed_to_lead()` per producing agent: median minutes to first reply and the
  share inside five minutes. The answer *rate* is only meaningful for cards the
  new gate created (`source` set) — before 21 Sep a card was only knowable as a
  lead if someone answered it, which makes a rate that cannot fail.
- `brokerage_leads` unrouted, and how long the oldest has waited.
- The overnight panel audits the lead agent against this document.

## Reach — an alert that reaches nobody is not an alert (29 Sep)

Marguerite (panel): "the concierge ran 530 times and sent zero replies … nobody
ever told the agent a lead was waiting." She was right:

- **Every alert from the database was refused** (push-send rejected the signed
  service JWT: 401) — the ladder's "New lead", "Passed to you" and "Lead needs
  you" never reached a phone. Fixed; `push_log` now records every alert and how
  many devices took it, and the panel reads it (`alerts_delivered_7d`).
- **The ladder offers a lead only to someone PrismOS can reach**
  (`lead_reachable()`: a registered device that is not refusing alerts). With
  nobody reachable, the broker gets it at once.
- **An answer from Gmail or the phone counts.** The ladder checks
  `lead_was_acted()` before moving a lead, so it never takes a lead from the
  agent already on it; the card closes itself (`handled`) within 5 minutes.
- The concierge does **not draft** for an agent with no working device who has
  not opened PrismOS in 14 days — nobody would read it. The card is still made,
  so their speed is measured from Gmail and phone. Each card records
  `alert_reached`, and its AI spend names the card, so "acted on" is real.
- `speed_to_lead()` carries `can_alert` per agent.

## Who just asked — ready on arrival (30 Sep)

Panel (Simplifier + Marguerite + Newcomer): "a lead arrives, no brief fires,
nobody knows if the contact can transact." The answer is assembled the moment a
recognised lead lands, not when someone goes looking:

1. **What PrismOS already knows** (`lead_known_facts()`, lookups, no AI): already
   in this agent's contacts, has written to them before, past client of the
   brokerage. Only this agent's own book — never another agent's contacts.
2. **Can they act** (`lead-qualify`, unchanged role): budget, area, stated
   pre-approval / cash / timeline / has an agent, and the one question to ask.
   Zillow's per-buyer relay address (`…@convo.zillow.com`) IS the buyer; Zillow
   rental inquiries ("Send application") are rentals.
3. **Three lines from their own words** (`lead-brief`, ~¼ cent): who, what they
   want, and whether they can act — from facts only, else "Not known yet — ask …".
   Runs on arrival for recognised leads; reads the portal message when the
   buyer never emailed directly.
4. **The alert carries it**: "Zillow · rental · Wesley Chapel — Ask: When do you
   need to move in?" — the decision to call is made on the lock screen.

`contact-research` (web research, ~30¢, a page long) stays on request: it is the
wrong tool for a stranger who sent one message, and too slow for a race.

## Known gaps

- **Mary Sous has no email connected.** The system has never seen one of her
  leads. Connecting it is the single highest-leverage action available.
- Sign calls and texts reach the concierge through Quo; their source is not yet
  tagged, so they do not appear in speed-to-lead as leads.
- Portal leads that carry the buyer only in the Reply-To header fall back to the
  sender address when no email appears in the body.

## Leads and replies are different jobs (22 Sep)

A lead is a race; a reply is a debt. `lead_concierge.kind` and `inbound_kind()`
decide which, and everything downstream follows from it.

| | **lead** | **reply** |
|---|---|---|
| Who | a recognised source, a referral, or a stranger stating intent | someone in contacts, someone Dara has written to, or any "Re:" thread |
| Alert | push the moment it lands, by name, unthrottled, 7am–10pm | none — it joins the hourly "someone is waiting on you" |
| Draft | written on arrival | only when asked (a reply to a partner in guessed words is worse than none, and drafting every important email spends real money on text nobody sends) |
| Order on screen | newest first — the clock started when it landed | oldest first — the longest wait is the biggest debt |
| Clock shown | minutes waiting, green under 5, red over an hour | when it arrived |
| Counted in speed_to_lead | yes | no |

Notifications came off shadow mode for **recognised-source leads only** — the
portal's own lead template, the IDX form, the franchise site, a referral. Score-
based guesses keep logging to `lead_notifications` until the log earns trust: one
false alarm costs the channel, and a missed lead costs one opportunity.
`gmail-sync` nudges `lead-notify` the instant it files a recognised lead, because
the sweep runs every ten minutes and a five-minute race cannot wait for it.
