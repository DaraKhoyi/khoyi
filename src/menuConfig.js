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
export function buildMenu({ isAdmin, isTeamLeader, brokerageGroup, teamGroup, setSidebarOpen, enterMode }) {
  return [
    // ── Daily drivers: flat, one tap ─────────────────────────────────────────
    { label: 'Today', view: 'today', icon: 'sparkles' },
    // Nerve Center is a ROOM, not a screen, so it is an action node rather than a
    // view node: enterMode() applies the room's resume rule — Contacts on the
    // first visit each day, then wherever you left off. Pointing it straight at
    // 'contacts' would look identical here and silently throw that away.
    { label: 'Nerve Center', icon: 'contacts',
      action: () => { setSidebarOpen(false); enterMode('relationships'); } },
    { label: 'Phone & Text', view: 'quo', icon: 'quo', ai: true },
    { label: 'Tasks', view: 'tasks', icon: 'tasks' },
    { label: 'Inbox', view: 'inbox', icon: 'inbox', ai: true },
    { label: 'Calendar', view: 'calendar', icon: 'calendar', ai: true },
    { label: 'Contacts', view: 'contacts', icon: 'contacts', ai: true },
    { label: 'Daily Journal', view: 'journal', icon: 'journal', ai: true },

    // ── Autonomous — the screens that go and do the work ──────────────────────
    { label: 'Autonomous', icon: 'sparkles', ai: true, children: [
      { label: 'Why It\u2019s Not Selling', view: 'unstuck', icon: 'properties', ai: true },
      { label: 'Listing Presentation', view: 'listing_presentation', icon: 'properties' },
      { label: 'The Correspondent', view: 'correspondent', icon: 'notes', ai: true },
      { label: 'Ask Ari', view: 'chat', icon: 'chat', ai: true },
    ] },

    // ── People work that is not the contact list itself ───────────────────────
    // Who to Contact Next, the investor book and the Google import all answer
    // "who do I talk to". They were three separate top-level entries.
    { label: 'Relationships', icon: 'contacts', children: [
      { label: 'Who to Contact Next', view: 'cadence_review', icon: 'clock' },
      { label: 'Investor Pipeline', view: 'investor_pipeline', icon: 'building' },
      { label: 'Group Message', view: 'group_message', icon: 'chat' },
      { label: 'Email Review', view: 'email_review', icon: 'inbox' },
      { label: 'Import from Google', view: 'google_contacts', icon: 'contacts' },
      { label: 'Manage Tags', view: 'tags', icon: 'notes' },
      // DISC profiles across the whole sphere. It was routed but reachable from
      // NOWHERE — no menu entry, no admin group, no setView anywhere in src/.
      // 578 lines of working screen that no agent could open.
      { label: 'DISC Profiles', view: 'prism', icon: 'prism' },
      ...(isAdmin ? [{ label: 'Agent Departures', view: 'investor_transition', icon: 'building' }] : []),
    ] },

    // ── Winning work ──────────────────────────────────────────────────────────
    { label: 'Prospecting & Growth', icon: 'target', children: [
      { label: 'Prospecting', view: 'prospecting', icon: 'prospecting' },
      { label: 'Lead-Gen Systems', view: 'prospecting', sub: 'systems', icon: 'signal' },
      { label: 'How I\u2019m Doing', view: 'scoreboard', icon: 'target' },
      { label: 'My Stats', view: 'numbers', icon: 'chart' },
      { label: 'People You Know', view: 'uncarded', icon: 'users' },
      { label: 'Lead Notifications', view: 'lead_notify', icon: 'inbox' },
      { label: 'Growth', view: 'growth', icon: 'chart' },
      ...(isAdmin ? [{ label: 'Recruiting', view: 'recruiting', icon: 'recruiting' }] : []),
    ] },

    // ── Work already won ──────────────────────────────────────────────────────
    // One word for one concept: the file is a TRANSACTION, the view of many is
    // the PIPELINE. "Deals" and "Contract Management" were two more words for the
    // same thing and are gone.
    { label: 'Transactions & Property', icon: 'briefcase', children: [
      { label: 'My Transactions', view: 'deals', icon: 'deals' },
      { label: 'Transaction Pipeline', view: 'pipeline', icon: 'chart' },
      { label: 'All Transactions', view: 'tracker', icon: 'tracker' },
      { label: 'Transaction Documents', view: 'files', icon: 'folder', ai: true },
      { label: 'Documents', view: 'documents', icon: 'folder' },
      { label: 'Residential', view: 'properties', icon: 'properties' },
      { label: 'My Investments', view: 'investments', icon: 'building' },
    ] },

    // ── Money ─────────────────────────────────────────────────────────────────
    // Finance was reachable five ways. One way now, with its sub-views as
    // children rather than as siblings of themselves.
    { label: 'Money', icon: 'coin', children: [
      { label: 'Finance Dashboard', view: 'finance', icon: 'coin' },
      { label: 'Data Entry', view: 'finance', sub: 'ledger', icon: 'coin' },
      { label: 'Blueprint (Budget)', view: 'finance', sub: 'blueprint', icon: 'chart' },
      { label: 'Financial Records', view: 'finance', sub: 'reports', icon: 'folder' },
      { label: 'Mileage', view: 'mileage', icon: 'car' },
    ] },

    // ── Knowing things ────────────────────────────────────────────────────────
    // "Library" and "AI Notes" were one screen under two names in two groups.
    { label: 'Library & Learning', icon: 'notes', ai: true, children: [
      { label: 'Library', view: 'notes', icon: 'notes', ai: true },
      { label: 'Knowledge', view: 'knowledge', icon: 'library' },
      { label: 'Brain', view: 'brain', icon: 'brain' },
      { label: 'Playbooks', view: 'playbooks', icon: 'playbooks' },
      { label: 'Learn', view: 'learn', icon: 'library' },
      { label: 'Coach', view: 'coach', icon: 'target' },
    ] },

    // ── Things running on their own ───────────────────────────────────────────
    { label: 'Automations', icon: 'sparkles', ai: true, children: [
      { label: 'Chief of Staff', view: 'chief', icon: 'sparkles', ai: true },
      { label: 'Prepared by AI', view: 'agentruns', icon: 'sparkles' },
      { label: 'Agent Activity', view: 'agent_activity', icon: 'chart' },
    ] },

    // ── Me and the system ─────────────────────────────────────────────────────
    { label: 'Settings & Systems', icon: 'settings', children: [
      { label: 'Settings', view: 'settings', icon: 'settings' },
      { label: 'My Prism Profile', view: 'my_prism', icon: 'prism' },
      { label: 'DISC / Grit Test', view: 'disc_test', icon: 'target' },
      { label: 'My Voice', view: 'myvoice', icon: 'mic' },
      { label: 'Someday / Maybe', view: 'someday', icon: 'sparkles' },
      { label: 'System Health', view: 'app_health', icon: 'health' },
      // Also unreachable before this: 287 lines showing per-integration status.
      // Distinct from App Health, which is the client-error view.
      { label: 'Integrations Status', view: 'systems', icon: 'health' },
    ] },

    ...(isAdmin ? [brokerageGroup] : isTeamLeader ? [teamGroup] : []),
  ];
}
