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

- `speed_to_lead()` per producing agent: median minutes to first reply and the
  share inside five minutes. The answer *rate* is only meaningful for cards the
  new gate created (`source` set) — before 21 Sep a card was only knowable as a
  lead if someone answered it, which makes a rate that cannot fail.
- `brokerage_leads` unrouted, and how long the oldest has waited.
- The overnight panel audits the lead agent against this document.

## Known gaps

- **Mary Sous has no email connected.** The system has never seen one of her
  leads. Connecting it is the single highest-leverage action available.
- Sign calls and texts reach the concierge through Quo; their source is not yet
  tagged, so they do not appear in speed-to-lead as leads.
- Portal leads that carry the buyer only in the Reply-To header fall back to the
  sender address when no email appears in the body.
