// ═══════════════════════════════════════════════════════════════════════════
// TIPS REGISTRY — the teachable-moments library.
//
// Every entry is a short lesson shown in-context the first time an agent lands
// on a screen, then dismissed for good (gated by the seen-list + pace in App).
//
// VOICE (house standard): benefit-led, plain, short, confident, never salesy.
// Lead with the human outcome, then the mechanism. Augmented, not artificial —
// "Prism makes you a better you", it does not replace judgement. Bold the phrase
// that carries the point, not everything.
//
// HOW TO ADD ONE (standing instruction): whenever a feature ships, add a tip
// here keyed to the screen it lives on, and drop <TipFor screen="..."/> on that
// screen. That is the whole ritual — the registry keeps voice consistent and
// makes the habit one line of work.
//
// id must be globally unique and STABLE (it is the dismissal key — changing it
// re-shows the tip to everyone). label is the gold eyebrow. body is JSX-safe
// markup as a string rendered via the Tip component; use <b> for emphasis.
// ═══════════════════════════════════════════════════════════════════════════

export const TIPS = [
  // ── Listing Presentation ────────────────────────────────────────────────────
  { id: 'lp_autoresearch', screen: 'listing_presentation', label: 'Turn an address into a dossier',
    body: 'Type the property address and tap <b>Auto-research</b>. Prism pulls comparable sales, market speed, and property facts from public sources (Zillow, Realtor, Redfin, county records) and fills the form for you \u2014 a stand-in until your IDX feed is connected. <b>Always review the numbers before you present</b> \u2014 public data varies by address, so confirm the comps and market read against what you know.' },
  { id: 'lp_adjust_confidence', screen: 'listing_presentation', label: 'Tune the comps, read the confidence',
    body: 'Prism adjusts every comp <i>to your listing</i> \u2014 size, age, condition, time \u2014 and reconciles them into one value with a <b>5-star confidence rating</b> (more comps that agree = more stars). Disagree with a comp? Drag its <b>slider</b> to nudge it up or down and watch the valuation and stars update live. Your judgment, applied on top of the math \u2014 then it\u2019s <i>your</i> number, defensible line by line.' },
  // ── Brokerage: AI usage reports ─────────────────────────────────────────────
  { id: 'ai_reports_auto', screen: 'ai_usage_reports', label: 'Your AI bill, itemized — automatically',
    body: 'On the 1st of every month, Prism builds a per-agent AI cost report for the month just ended, emails it to the brokerage, and files it here in Excel. <b>The brokerage-account cost is what you could bill back.</b> No spreadsheet to assemble — it\u2019s already done.' },
  // ── The Library / knowledge ────────────────────────────────────────────────
  { id: 'library_one_store', screen: 'notes', label: 'One place, everything you know',
    body: 'Notes, journal, call transcripts, documents, filed emails — all one searchable library. Stop keeping four apps in your head. <b>Ask it anything and it answers from everything you own.</b>' },
  { id: 'library_ask_ari', screen: 'notes', label: 'A library you can ask',
    body: 'Browsing is storage. <b>Asking is intelligence.</b> Tap Ask Ari and say "what did counsel say about the warehouse use?" — it reads your notes, calls and documents and answers, with the source.' },
  { id: 'library_link', screen: 'notes', label: 'Filed once, found everywhere',
    body: 'A lease belongs to the property, the deal, the tenant and the project at once. Link it to all of them and <b>it surfaces from every one</b> — you never have to remember which folder you chose.' },
  { id: 'library_search_deep', screen: 'documents', label: 'Search by meaning, not just words',
    body: 'Ordinary search needs the exact word. <b>Deep search understands the idea</b> — ask for "intensification of use" and it finds the clause even if the contract phrased it differently.' },
  { id: 'library_email_file', screen: 'inbox', label: 'Pull the attachment into your brain',
    body: 'That PDF someone emailed you is reference material. <b>File to library</b> reads it, summarizes it, and links it to the sender — so it is searchable next to everything else, not buried in your inbox.' },

  // ── Relationships / contacts ────────────────────────────────────────────────
  { id: 'contacts_owe_reply', screen: 'contacts', label: 'Never leave someone hanging',
    body: 'Prism watches who messaged you last and flags the ones <b>waiting on you</b>. Clearing that list is the cheapest trust you will ever buy — people remember who replies.' },
  { id: 'contacts_settled', screen: 'contacts', label: 'Settle it when it\u2019s done',
    body: 'Some threads do not need a reply — they are just finished. Mark them <b>settled</b> so they stop nagging you, without pretending you owe a message you do not.' },
  { id: 'contacts_disc_read', screen: 'contacts', label: 'Read the person, not just the deal',
    body: 'Two agents send the same message and get opposite results — the words were not wrong, the <b>delivery</b> was. Prism reads how each person likes to be approached, so you meet them their way.' },
  { id: 'contacts_research', screen: 'contacts', label: 'Walk in already knowing them',
    body: 'Before you call, let Ari build a profile — background, connections, what matters to them. <b>You stop reacting to your sphere and start reading it.</b>' },
  { id: 'contacts_touch', screen: 'contacts', label: 'Intuition is attention over time',
    body: 'A steady rhythm of small touches is how sphere agents earn referrals — not the big ask when you need something. Prism keeps the rhythm so <b>you look effortless</b>.' },

  { id: 'social_research', screen: 'contacts', label: 'Add their socials, sharpen the research',
    body: 'Drop a LinkedIn, Instagram, or Facebook on a contact (Details tab) and Prism uses it to <b>find the right person fast</b> — a profile URL pins identity far better than a name. Better in, better out.' },
  { id: 'research_docx', screen: 'contacts', label: 'Export research as a branded Word doc',
    body: 'Open a contact\'s research report and tap <b>⬇ Word report</b>. Pick <b>Client-facing dossier</b> (a polished bio to share — no behavioral read) or <b>Agent prep sheet</b> (adds the DISC read, still hides the rapport & things-to-avoid coaching). Branded Realty ONE Group Advantage.' },
  { id: 'multiparty_calls', screen: 'briefing', label: 'Three-party calls & meetings',
    body: 'Calls and meetings with 3+ people now attribute each commitment to the right person by name. If a third party owes something, it becomes a follow-up on <b>them</b> — and if they\'re one of your agents, it can route to their list. Tap the owner chip in review to correct any guess.' },
  // ── Deals / pipeline ────────────────────────────────────────────────────────
  { id: 'deals_stall', screen: 'deals', label: 'Catch a deal before it dies',
    body: 'Deals rarely blow up — they <b>go quiet</b>. Prism flags the ones that have stalled past their stage so you re-engage while it is still saveable, not at the post-mortem.' },
  { id: 'deals_next_step', screen: 'deals', label: 'Every deal, one clear next move',
    body: 'A pipeline is not a list to admire — it is a set of <b>next actions</b>. Prism keeps the single next step visible on each deal so momentum never depends on your memory.' },
  { id: 'pipeline_focus', screen: 'pipeline', label: 'Work the movers first',
    body: 'Not every deal deserves equal attention today. Prism surfaces the ones where <b>your next move changes the outcome</b> — so your best hours land where they matter.' },

  // ── Tasks / next best action ───────────────────────────────────────────────
  { id: 'tasks_abc', screen: 'tasks', label: 'A before B, always',
    body: 'The list is sorted by <b>what actually moves your business</b>, not what shouts loudest. Work top-down and the important stops losing to the urgent.' },
  { id: 'tasks_someday', screen: 'tasks', label: 'Someday isn\u2019t today',
    body: 'A wish is not a commitment. Park "maybe later" items in <b>Someday</b> so your real list stays honest — a to-do list you trust is one you actually work.' },
  { id: 'tasks_plan_day', screen: 'today', label: 'Start the day already decided',
    body: 'The hardest part of the morning is choosing. <b>Plan my day</b> lays out a realistic order from everything due, so you open the app and simply begin.' },
  { id: 'somedaymaybe', screen: 'someday', label: 'A holding pen, not a graveyard',
    body: 'Someday is where good ideas wait without cluttering today. Review it now and then — <b>promote what\u2019s ready, drop what\u2019s gone cold</b>. Nothing rots here unseen.' },

  // ── Calendar / time ─────────────────────────────────────────────────────────
  { id: 'calendar_sync', screen: 'calendar', label: 'One calendar, both directions',
    body: 'Events you make here sync to Google, and what you book there flows back. <b>One source of truth</b> — no double-entry, no "which calendar was that on?"' },
  { id: 'calendar_appointments', screen: 'calendar', label: 'Real appointments, not noise',
    body: 'Prism tells a client meeting from a birthday reminder, so your appointment count means something. If it ever guesses wrong, <b>one tap sets it straight</b> and it remembers.' },

  // ── Email ───────────────────────────────────────────────────────────────────
  { id: 'email_review_owe', screen: 'email_review', label: 'The replies you owe, in one place',
    body: 'Prism reads your inbox for threads <b>genuinely waiting on you</b> and gathers them here — so "inbox zero" becomes "nobody\u2019s waiting", which is the part that actually matters.' },
  { id: 'email_voice', screen: 'inbox', label: 'Sounds like you, tuned to them',
    body: 'Draft replies come back in <b>your</b> voice — then adapted to how the recipient likes to be spoken to. Same you, delivered the way each person hears best.' },
  { id: 'email_open_honest', screen: 'inbox', label: 'We won\u2019t lie about opens',
    body: 'Open tracking is unreliable by nature — scanners and privacy features trip it constantly. So Prism says <b>"likely seen,"</b> never a false "read." Honest beats flattering.' },

  // ── Recordings / calls / DISC ───────────────────────────────────────────────
  { id: 'calls_transcribe', screen: 'quo', label: 'Every call becomes searchable memory',
    body: 'Prism transcribes your calls and files them in the library. Six months later, <b>search a word someone said out loud</b> and find the exact conversation. Nothing said is ever lost.' },
  { id: 'calls_extract', screen: 'quo', label: 'It hears the to-do so you don\u2019t',
    body: 'Promised to send something on a call? Prism catches the commitment and offers it as a task in <b>Review</b> — you confirm, it graduates to your list. Your word gets kept automatically.' },
  { id: 'disc_roster', screen: 'disc_roster', label: 'Your whole sphere, decoded',
    body: 'Each contact\u2019s DISC read tells you <b>how to open, what to lead with, what to avoid</b>. It is the difference between a message that lands and one that gets ignored.' },
  { id: 'disc_assess', screen: 'disc', label: 'Not artificial intuition \u2014 yours, amplified',
    body: 'DISC is not a box to file someone in. It is a <b>head start on empathy</b> — a fast read of how this person prefers to be met, so you spend your attention on connecting, not guessing.' },

  // ── Journal / brain ─────────────────────────────────────────────────────────
  { id: 'journal_record', screen: 'journal', label: 'A record of the moment',
    body: 'Journal is append-only on purpose — it is <b>what you thought when you thought it</b>, not a document to revise. Prism analyzes each entry and links the people and threads it touches.' },
  { id: 'brain_memory', screen: 'brain', label: 'The things you never want to lose',
    body: 'Brain holds your durable decisions, playbooks and principles — the stuff that should <b>outlast any single conversation</b>. Prism recalls it when it is relevant, so past-you keeps helping present-you.' },

  // ── Money / production ──────────────────────────────────────────────────────
  { id: 'accounting_receipt', screen: 'accounting', label: 'Snap it now, sort it never',
    body: 'Photograph a receipt and Prism reads the amount, vendor and category, then files it for tax time. <b>The shoebox is gone.</b> Deductions you would have missed, captured in two seconds.' },
  { id: 'production_gci', screen: 'production', label: 'Know your number, always',
    body: 'Your production, commissions and pace toward goal — <b>live, not at year-end when it is too late to change it</b>. What gets measured in real time is what you can still steer.' },
  { id: 'mileage_track', screen: 'mileage', label: 'Miles are money you\u2019re leaving behind',
    body: 'Every drive to a showing is deductible — and easy to forget. Log it here and <b>the write-off is waiting at tax time</b>, documented the way an accountant wants it.' },

  { id: 'capture_snap', screen: 'notes', label: 'Snap it, and it reads itself',
    body: 'Photograph a document, a whiteboard, a business card — Prism <b>reads the text off the image</b>, summarizes it, and files it searchable. The photo becomes knowledge, not just a picture.' },
  { id: 'capture_voice', screen: 'notes', label: 'Talk it out, hands-free',
    body: 'Record a voice memo right into the library and Prism transcribes it — so a thought you had driving between showings becomes <b>searchable text</b> without you typing a word.' },
  { id: 'capture_share', screen: 'notes', label: 'What you know, the team knows',
    body: 'Share a document or note to your team or the whole brokerage in two taps. <b>Institutional knowledge stops living in one person’s head</b> — the best playbook helps everyone.' },
  // ── Recruiting / brokerage ──────────────────────────────────────────────────
  { id: 'recruiting_pipeline', screen: 'recruiting', label: 'Recruit like you sell',
    body: 'Agents are a pipeline too — same cadence, same follow-up discipline that wins listings. Prism tracks each prospect\u2019s stage so <b>your best recruits don\u2019t go cold while you\u2019re busy</b>.' },
];

// index by screen for O(1) lookup
export const TIPS_BY_SCREEN = TIPS.reduce((m, t) => {
  (m[t.screen] = m[t.screen] || []).push(t);
  return m;
}, {});
