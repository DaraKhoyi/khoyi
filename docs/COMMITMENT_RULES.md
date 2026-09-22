# What becomes a task from a conversation

Written 22 Sep 2026 from an analysis of the broker's 190 dismissed commitment
cards. Every extractor that turns a call, recording, text or email into proposed
work follows these rules. Change them here first.

## What the 190 dismissals were

| Cause | Share | Fix |
|---|---|---|
| The same promise already shown in the *other* call queue | **61%** | One shared duplicate check across both extractors, tasks and cards |
| Someone else's promise that owed the agent nothing (a contractor's own work steps) | 50%* | `owed_to_me` required for any promise not the agent's |
| No person identified ("Unknown said they would") | 23% | Name the person, or do not extract |
| Conditional ("if I run into tenants…") | 8% | Excluded in prompt and in code |
| Too vague ("Send the words", "Take care of something") | 8% | Stand-alone title: verb + object + person + property |
| Done during the call ("let me check now") | 8% | Excluded |

*Causes overlap; percentages are of the 190. Kept cards show each pattern far less
often, which is what makes them safe rules rather than guesses.

## The rules

1. **It must create work for the agent** — he will do it, or someone will deliver
   something to him or his client that he may need to chase.
2. **Personal and family promises count exactly as much** as real-estate ones.
   (The first re-judge run archived "check your Apple account" as "not real
   estate"; that was the instruction's fault and it was corrected.)
3. **Name the person.** No name, no card.
4. **The title stands alone** a week later for someone who never heard the call.
5. **Every card says what the agent does** (`next_step`) — "Chase Tom Thursday for
   the cabana test result" — even when someone else made the promise. This is the
   line that answers "what does this want me to do?"
6. **Not commitments:** conditional, done during the call, requests the agent did
   not agree to, logistics settled on the call, pleasantries.
7. **Already on the plate?** `find_similar_work(user, contact, title)` checks open
   tasks, open cards and pending call follow-ups. Both call extractors
   (`call-commitments`, `quo-call-process`) ask it before proposing anything.
   Hiding a real task is worse than showing a doubtful one: thresholds are 0.55
   in general and 0.45 for the same person, after "Call back after speaking with
   Jala" falsely matched "Call back after reviewing screenshot" at 0.35.
8. Cards retired by rules are `archived` with the reason in `commitment_events`,
   never `dismissed` — that word is reserved for the agent's own decisions, so the
   dismissal rate stays an honest measure.

## Clean-up of 22 Sep

Pending cards 269 → 192 by rules → 138 for the broker after an AI re-judge
(`commitment-rejudge`, $0.46), every survivor with a named person and a next step.
Call follow-ups 189 → 142 (47 merged into the card from the same call). Backups:
`commitments_backup_20260922`, `quo_calls_followups_backup_20260922`.

## Not yet covered

Commitments come only from calls today. Email and text do not yet propose
commitments; when they do, they must call `find_similar_work` and follow these
rules, or they will recreate the two-queue duplicate across channels.
