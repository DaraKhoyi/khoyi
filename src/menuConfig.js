// menuConfig — the tuning-fork menu, as data.
//
// It is a function rather than a constant because the menu closes over live
// values — the admin/team-leader role, the two role-specific groups, and the two
// navigation callbacks. Everything it needs is passed in explicitly, so this file
// imports nothing from App.js and the dependency stays a tree.
//
// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURE — ideality audit Block B
//
// Before: 26 top-level entries and 13 destinations reachable from two or more
// places. Finance was reachable FIVE ways, three of which rendered the identical
// view with no sub-state and were therefore indistinguishable to a user. Library
// and "AI Notes" were the same screen under two names in two different groups.
// An agent who found something once could not reliably find it twice.
//
// Now: ONE HOME PER DESTINATION. Where a screen fits two mental models it lives
// in the one an agent would guess first.
//
// The shape has two halves, deliberately:
//
//   DAILY DRIVERS stay flat and one tap away — Today, Nerve Center, Phone &
//   Text, Tasks, Inbox, Calendar, Contacts, Daily Journal. These are Dara's
//   stated order and are opened many times a day. Burying them to reach a lower
//   top-level count would trade a real cost for a cosmetic one.
//
//   EVERYTHING ELSE groups by the JOB it serves rather than the technology
//   behind it.
//
// That is 15 top-level entries, not the 9 the audit proposed. Nine was not
// reachable without hiding daily drivers, and saying so is better than forcing
// the number. The measure that mattered — one path per destination — is met.
//
// IF YOU ADD A SCREEN: give it exactly one home. The reachability guard catches
// an unreachable screen; nothing catches a SECOND path to one, so that
// discipline is yours.
// ═══════════════════════════════════════════════════════════════════════════
// NOTE FOR WHOEVER EDITS THIS FILE NEXT.
//
// The Brokerage and Team groups are NOT defined here. They are passed in from
// App.js (brokerageGroup / teamGroup) and spliced in at the bottom of this
// function, because they depend on runtime role and impersonation state. Adding
// a Brokerage entry to this file does nothing: it is not merged, it is replaced.
//
// This cost real time twice. During the audit I reported nine "unreachable"
// screens by reading only this file and missing App.js's group. Then I added
// Overnight Review and Goals & Pace here, shipped them, and Dara could not find
// either — because neither ever rendered. Brokerage entries belong in App.js.
export function buildMenu({ isAdmin, isTeamLeader, brokerageGroup, teamGroup, setSidebarOpen, enterMode }) {
  // ── EIGHT, THEN MORE (Dara, 5 Oct 2026) ──────────────────────────────────
  // On 1 Oct the menu was cut to five and More, after Josh: "all the different
  // functions it does, and not being able to collapse it… that's giving you
  // another job to manage." On 5 Oct Dara set the order himself, from using it:
  // Today, Money, Contacts, Phone & Text, Calendar, Tasks, Email, Journal — then
  // More, with everything else exactly as it was. The principle stands: a short
  // fixed list of the day's screens, and one home for everything else. The list
  // is HIS; smoke/calm_guard.mjs pins these eight names in this order.
  //
  // Every entry has its own picture: smoke/menu_icons.mjs fails the release if
  // an icon name does not exist or two entries draw the same thing.
  return [
    { label: 'Today', view: 'today', icon: 'sun' },
    // Money opens the check register (My Transactions); its arrow opens the
    // rest of the room. Dara, 5 Oct 2026. smoke/money_register_guard.mjs pins it.
    { label: 'Money', view: 'finance', sub: 'ledger', icon: 'dollar', children: [
      { label: 'Finance Dashboard', view: 'finance', sub: 'dashboard', icon: 'finance' },
      { label: 'Data Entry', view: 'finance', sub: 'ledger', icon: 'edit' },
      { label: 'Blueprint (Budget)', view: 'finance', sub: 'blueprint', icon: 'scale' },
      { label: 'Financial Records', view: 'finance', sub: 'reports', icon: 'archive' },
      { label: 'Mileage', view: 'mileage', icon: 'car' },
    ] },
    { label: 'Contacts', view: 'contacts', icon: 'contacts' },
    { label: 'Phone & Text', view: 'quo', icon: 'quo' },
    { label: 'Calendar', view: 'calendar', icon: 'calendar' },
    { label: 'Tasks', view: 'tasks', icon: 'tasks' },
    { label: 'Email', view: 'inbox', icon: 'mail' },
    { label: 'Journal', view: 'journal', icon: 'journal' },
    { label: 'More', icon: 'compass', children: [
    { label: 'Done for you', view: 'chief', icon: 'sparkles' },
    // Nerve Center is a ROOM, not a screen, so it is an action node rather than a
    // view node: enterMode() applies the room's resume rule — Contacts on the
    // first visit each day, then wherever you left off.
    { label: 'Nerve Center', icon: 'zap',
      action: () => { setSidebarOpen(false); enterMode('relationships'); } },
    { label: 'Plan My Day', view: 'briefing', icon: 'briefing' },
    { label: 'Launchers', view: 'launchers', icon: 'link' },
    { label: 'Rank', view: 'scoreboard', icon: 'trophy' },

    // ── Autonomous — the screens that go and do the work ──────────────────────
    { label: 'Autonomous', icon: 'cpu', ai: true, children: [
      { label: 'Why It\u2019s Not Selling', view: 'unstuck', icon: 'search', ai: true },
      { label: 'Listing Presentation', view: 'listing_presentation', icon: 'monitor' },
      { label: 'The Correspondent', view: 'correspondent', icon: 'feather', ai: true },
      { label: 'Ask Ari', view: 'chat', icon: 'message', ai: true },
    ] },

    // ── People work that is not the contact list itself ───────────────────────
    // Who to Contact Next, the investor book and the Google import all answer
    // "who do I talk to". They were three separate top-level entries.
    { label: 'Relationships', icon: 'heart', children: [
      { label: 'Who to Contact Next', view: 'cadence_review', icon: 'clock' },
      { label: 'Investor Pipeline', view: 'investor_pipeline', icon: 'cart' },
      { label: 'Group Message', view: 'group_message', icon: 'replyAll' },
      { label: 'Import from Google', view: 'google_contacts', icon: 'download' },
      { label: 'Manage Tags', view: 'tags', icon: 'tag' },
      // DISC profiles across the whole sphere. It was routed but reachable from
      // NOWHERE — no menu entry, no admin group, no setView anywhere in src/.
      // 578 lines of working screen that no agent could open.
      { label: 'DISC Profiles', view: 'prism', icon: 'prism' },
      ...(isAdmin ? [{ label: 'Agent Departures', view: 'investor_transition', icon: 'logout' }] : []),
    ] },

    // ── Winning work ──────────────────────────────────────────────────────────
    { label: 'Prospecting & Growth', icon: 'arrowUp', children: [
      { label: 'Prospecting', view: 'prospecting', icon: 'prospecting' },
      { label: 'Lead-Gen Systems', view: 'prospecting', sub: 'systems', icon: 'signal' },
      { label: 'How I\u2019m Doing', view: 'scoreboard', icon: 'chart' },
      { label: 'My Stats', view: 'numbers', icon: 'hash' },
      { label: 'People You Know', view: 'uncarded', icon: 'userCheck' },
      { label: 'Lead Notifications', view: 'lead_notify', icon: 'bell' },
      { label: 'Growth', view: 'growth', icon: 'investments' },
      ...(isAdmin ? [{ label: 'Recruiting', view: 'recruiting', icon: 'recruiting' }] : []),
    ] },

    // ── Work already won ──────────────────────────────────────────────────────
    // One word for one concept: the file is a TRANSACTION, the view of many is
    // the PIPELINE. "Deals" and "Contract Management" were two more words for the
    // same thing and are gone.
    { label: 'Transactions & Property', icon: 'key', children: [
      { label: 'My Transactions', view: 'deals', icon: 'deals' },
      { label: 'Transaction Pipeline', view: 'pipeline', icon: 'filter' },
      { label: 'All Transactions', view: 'tracker', icon: 'tracker' },
      { label: 'Transaction Documents', view: 'files', icon: 'paperclip', ai: true },
      { label: 'Documents', view: 'documents', icon: 'folder' },
      { label: 'Residential', view: 'properties', icon: 'properties' },
      { label: 'My Investments', view: 'investments', icon: 'building' },
    ] },

    // ── Knowing things ────────────────────────────────────────────────────────
    // "Library" and "AI Notes" were one screen under two names in two groups.
    { label: 'Library & Learning', icon: 'library', ai: true, children: [
      { label: 'Library', view: 'notes', icon: 'notes', ai: true },
      { label: 'Knowledge', view: 'knowledge', icon: 'info' },
      { label: 'Brain', view: 'brain', icon: 'brain' },
      { label: 'Playbooks', view: 'playbooks', icon: 'map' },
      { label: 'Learn', view: 'learn', icon: 'school' },
      { label: 'Coach', view: 'coach', icon: 'flame' },
    ] },

    // ── Things running on their own ───────────────────────────────────────────
    { label: 'Automations', icon: 'repeat', ai: true, children: [
      { label: 'Prepared by AI', view: 'agentruns', icon: 'clipboard' },
      { label: 'Agent Activity', view: 'agent_activity', icon: 'systems' },
    ] },

    // ── Me and the system ─────────────────────────────────────────────────────
    { label: 'Settings & Systems', icon: 'settings', children: [
      { label: 'Settings', view: 'settings', icon: 'sliders' },
      { label: 'My Prism Profile', view: 'my_prism', icon: 'user' },
      { label: 'DISC / Grit Test', view: 'disc_test', icon: 'ruler' },
      { label: 'My Voice', view: 'myvoice', icon: 'mic' },
      { label: 'Someday / Maybe', view: 'someday', icon: 'cloud' },
      { label: 'System Health', view: 'app_health', icon: 'shield' },
      // Also unreachable before this: 287 lines showing per-integration status.
      // Distinct from App Health, which is the client-error view.
      { label: 'Integrations Status', view: 'systems', icon: 'wifi' },
    ] },

    ...(isAdmin ? [brokerageGroup] : isTeamLeader ? [teamGroup] : []),
    ] },
  ];
}
