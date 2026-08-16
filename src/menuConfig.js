// menuConfig — the tuning-fork menu, as data.
//
// This lived inside AppMain, which meant every reorder edited the composition
// root and ate into its size budget. It is CONFIG, not logic: Dara rearranges it
// regularly, and a menu change should never risk the app shell.
//
// It is a function rather than a constant because the menu closes over live
// values — the admin/team-leader role, the two role-specific groups, and the two
// navigation callbacks. Everything it needs is passed in explicitly, so this file
// imports nothing from App.js and the dependency stays a tree.
//
// Ordering note: Tasks, Calendar and Contacts appear BOTH at top level and inside
// Planning. That duplication is deliberate — one tap away as daily drivers, and
// grouped as planning tools. Do not "tidy" it away.
export function buildMenu({ isAdmin, isTeamLeader, brokerageGroup, teamGroup, setSidebarOpen, enterMode }) {
  return [
    // ── Top level — Dara's order, set 2026-08-15 ──────────────────────────────
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
    // Autonomous — the screens that go and do the work rather than waiting to be
    // driven. Listing Presentation moved here from under Ask Ari, where it sat as
    // a child of a chat screen it has nothing to do with.
    { label: 'Autonomous', icon: 'sparkles', ai: true, children: [
      { label: 'Unstuck.', view: 'unstuck', icon: 'properties', ai: true },
      { label: 'Listing Presentation', view: 'listing_presentation', icon: 'properties' },
    ] },
    { label: 'Investor Pipeline', view: 'investor_pipeline', icon: 'building' },
    { label: 'Cadence Review', view: 'cadence_review', icon: 'clock' },
    // Planning deliberately repeats Tasks / Calendar / Contacts from above. They
    // are one tap away as daily drivers AND grouped here as planning tools; the
    // duplication is the point, not an oversight.
    { label: 'Planning', icon: 'calendar', children: [
      { label: 'Tasks', view: 'tasks', icon: 'tasks' },
      { label: 'Someday / Maybe', view: 'someday', icon: 'sparkles' },
      { label: 'Calendar', view: 'calendar', icon: 'calendar', ai: true },
      { label: 'Contacts', view: 'contacts', icon: 'contacts', ai: true },
      { label: 'My Stats', view: 'numbers', icon: 'chart' },
    ] },
    { label: 'Library', view: 'notes', icon: 'notes', ai: true },
    // Not in the new top-level list but kept rather than deleted — say the word
    // and it goes.
    { label: 'Google Contacts', view: 'google_contacts', icon: 'contacts' },
    { label: 'Finance Dashboard', view: 'finance', icon: 'dollar' },
    { label: 'Mileage', view: 'mileage', icon: 'car' },
    // Listing Presentation moved to Autonomous; Ask Ari is a plain entry now.
    { label: 'Ask Ari', view: 'chat', icon: 'chat', ai: true },
    { label: 'Prospecting', view: 'prospecting', icon: 'prospecting' },
    // ── AI Agents ──
    { label: 'AI Agents', icon: 'sparkles', ai: true, children: [
      { label: 'Chief of Staff', view: 'chief', icon: 'briefing' },
      { label: 'Prepared by AI', view: 'agentruns', icon: 'sparkles' },
      { label: 'Agent Activity', view: 'agent_activity', icon: 'brain' },
      ...(isAdmin ? [{ label: 'App Health', view: 'app_health', icon: 'brain' }] : []),
    ] },
    // ── Pipeline & Growth ──
    { label: 'Pipeline & Growth', icon: 'target', children: [
      { label: 'Transaction Pipeline', view: 'pipeline', icon: 'chart' },
      { label: 'Prospecting', view: 'prospecting', icon: 'prospecting' },
      { label: 'Lead-Gen Systems', view: 'prospecting', sub: 'systems', icon: 'signal' },
      { label: "How I'm Doing", view: 'scoreboard', icon: 'target' },
      { label: 'Growth', view: 'growth', icon: 'chart' },
      ...(isAdmin ? [{ label: 'Recruiting', view: 'recruiting', icon: 'recruiting' }] : []),
    ] },
    // ── Communications ──
    { label: 'Communications', icon: 'message', children: [
      { label: 'Inbox', view: 'inbox', icon: 'inbox' },
      { label: 'Email Review', view: 'email_review', icon: 'mail', ai: true },
      { label: 'Phone & Text (Quo)', view: 'quo', icon: 'quo' },
      { label: 'Group Message', view: 'group_message', icon: 'message', ai: true },
      { label: 'Journal', view: 'journal', icon: 'journal' },
      { label: 'Drip Campaigns', built: false, icon: 'signal' },
    ] },
    // ── Deals & Property ──
    { label: 'Deals & Property', icon: 'briefcase', children: [
      { label: 'Transaction Pipeline', view: 'deals', icon: 'deals' },
      { label: 'Contract Management', view: 'files', icon: 'folder', ai: true, children: [
        { label: 'View Transactions', view: 'tracker', icon: 'tracker' },
        { label: 'Upload Trans. Docs', built: false, icon: 'folder' },
        { label: 'Upload Recordings', built: false, icon: 'mic' },
      ] },
      { label: 'Documents', view: 'documents', icon: 'folder' },
      { label: 'Residential', view: 'properties', icon: 'properties', children: [
        { label: 'Create Trans.', built: false, icon: 'plus' },
        { label: 'Upload Trans. Docs', built: false, icon: 'folder' },
        { label: 'Upload Recordings', built: false, icon: 'mic' },
      ] },
      { label: 'Commercial', built: false, icon: 'building', children: [
        { label: 'Create Trans.', built: false, icon: 'plus' },
        { label: 'Upload Trans. Docs', built: false, icon: 'folder' },
        { label: 'Upload Recordings', built: false, icon: 'mic' },
      ] },
      { label: 'Rentals', built: false, icon: 'properties', children: [
        { label: 'Create Trans.', built: false, icon: 'plus' },
      ] },
      { label: 'My Projects', view: 'tracker', icon: 'tracker' },
      { label: 'My Investments', view: 'investments', icon: 'investments' },
    ] },
    // ── Finance ──
    { label: 'Finance', icon: 'dollar', children: [
      { label: 'Finance Dashboard', view: 'finance', icon: 'finance', children: [
        { label: 'Data Entry', view: 'finance', sub: 'ledger', icon: 'camera' },
        { label: 'Blueprint (Budget)', view: 'finance', sub: 'blueprint', icon: 'compass' },
        { label: 'Financial Records', view: 'finance', sub: 'reports', icon: 'chart' },
      ] },
      { label: 'Mileage', view: 'mileage', icon: 'car' },
    ] },
    // ── Learn & Coaching ──
    { label: 'Learn & Coaching', icon: 'library', children: [
      { label: 'Brain', view: 'brain', icon: 'brain', ai: true },
      { label: 'Playbooks', view: 'playbooks', icon: 'playbooks' },
      { label: 'AI Notes', view: 'notes', icon: 'notes', ai: true },
      { label: 'Knowledge', view: 'knowledge', icon: 'library' },
      { label: 'Training', icon: 'school', children: [
        { label: 'DISC Learning', built: false, icon: 'bulb' },
        { label: 'Coaching', built: false, icon: 'megaphone' },
        { label: 'Accountability Partner', built: false, icon: 'users' },
      ] },
    ] },
    // ── My Prism Identity ──
    { label: 'My Prism Identity', icon: 'prism', children: [
      { label: 'My Prism Profile', view: 'my_prism', icon: 'prism' },
      { label: 'DISC / Grit Test', view: 'disc_test', icon: 'bulb' },
      { label: 'My Voice (Voice Card)', view: 'myvoice', icon: 'mic' },
      { label: 'Get Started / Onboarding', icon: 'star', action: () => { try { window.__openOnboarding && window.__openOnboarding(); } catch (_) {} } },
      { label: 'Business Plan', built: false, icon: 'clipboard' },
    ] },
    // ── Brokerage (admin -> Brokerage, team leader -> Team, agent -> neither) ──
    ...(isAdmin ? [brokerageGroup] : isTeamLeader ? [teamGroup] : []),
    // ── Settings & Systems ──
    { label: 'Settings & Systems', icon: 'settings', children: [
      { label: 'Settings', view: 'settings', icon: 'settings' },
      { label: 'System Health', view: 'app_health', icon: 'systems' },
    ] },
  ];;
}
