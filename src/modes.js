// ── modes.js ─────────────────────────────────────────────────────────────────
// The mindset architecture. An agent is never "using a CRM" — at any moment they
// are in one headspace: getting ready, working relationships, hunting business,
// pushing deals, or checking money. Each MODE is a room that shows ONLY the tools
// for that headspace, so the 40-item menu stops being one overwhelming stack.
//
// This file is pure data on purpose: reordering a room, moving a screen between
// rooms, or renaming a mode is a one-line edit here, not surgery in App.js.

// Every mode: an id, the label + glyph shown on the dashboard tile, a one-line
// "what this headspace is", the ordered list of views that belong to it, and the
// 3–5 that appear in the scoped bottom bar (bar[0] is the room's home).
export const MODES = [
  {
    id: 'relationships',
    label: 'Relationships',
    tag: 'Who needs my attention',
    glyph: 'people',
    accent: '#8FB8A8',
    home: 'contacts',
    // Dara's order (left→right): Contacts, Calls, Calendar, Tasks, Email, Journal.
    // Six sections so the whole daily-communication surface is one tap apart.
    bar: ['contacts', 'quo', 'calendar', 'tasks', 'inbox', 'journal'],
    views: ['contacts', 'quo', 'calendar', 'tasks', 'inbox', 'journal', 'email_review', 'contact_types'],
  },
  {
    // THE LIBRARY as a first-class room. An agent is sometimes not working a
    // person or a deal but looking for what they KNOW — a document, a call, a
    // note, an answer. That headspace had no room; its screens (notes,
    // documents) were buried as extra views inside other modes and appeared in
    // no bottom bar. Now it is a destination.
    //
    // The bar is built for FINDING, not filing: All (the whole library), Search
    // (jump straight to the search field), Upload (add something), and Ari — because
    // a library you can ASK ("what did counsel say about the warehouse use?") is
    // the difference between storage and intelligence.
    id: 'library',
    label: 'Library',
    tag: 'Everything I know',
    glyph: 'library',
    accent: '#8FB8A8',
    home: 'notes',
    bar: [
      { view: 'notes', sub: 'all',    label: 'All',    glyph: 'library' },
      { view: 'notes', sub: 'search', label: 'Search', glyph: 'search' },
      { view: 'notes', sub: 'upload', label: 'Upload', glyph: 'upload' },
      { view: 'chat', label: 'Ask Ari', glyph: 'spark' },
    ],
    views: ['notes', 'documents', 'chat'],
  },
  {
    id: 'prospect',
    label: 'Prospect',
    tag: 'Find new business',
    glyph: 'target',
    accent: '#C98A5E',
    home: 'prospecting',
    // The prospecting mindset lives almost entirely inside ProspectingView, which
    // has its own sub-tabs. The bar deep-links into them so "Systems" opens the
    // LEAD-GEN LIBRARY (browse + activate the 85 systems) — NOT the infrastructure
    // health monitor, which is a different screen entirely.
    bar: [
      { view: 'prospecting', sub: 'today', label: 'Today', glyph: 'target' },
      { view: 'prospecting', sub: 'library', label: 'Systems', glyph: 'gear' },
      { view: 'growth', label: 'Growth', glyph: 'up' },
      { view: 'recruiting', label: 'Recruit', glyph: 'people' },
    ],
    views: ['prospecting', 'systems', 'growth', 'recruiting', 'playbooks'],
  },
  {
    id: 'deals',
    label: 'Deals',
    tag: "What's in motion",
    glyph: 'flow',
    accent: '#7FA6C9',
    home: 'pipeline',
    bar: ['pipeline', 'deals', 'files', 'properties'],
    views: ['pipeline', 'deals', 'files', 'properties'],
  },
  {
    id: 'money',
    label: 'Money',
    tag: 'Am I hitting my goal',
    glyph: 'coin',
    accent: '#C9A84E',
    home: 'numbers',
    bar: ['numbers', 'briefing', 'scoreboard', 'finance'],
    // 'briefing' carries Outreach -> Results + the Goal Engine: performance
    // review, not daily planning. Visited weekly/monthly, deliberately.
    views: ['numbers', 'briefing', 'scoreboard', 'mileage', 'finance', 'investments'],
  },
  {
    // Only rendered for broker-admins / team leaders. Same app, role-aware room.
    id: 'brokerage',
    label: 'Brokerage',
    tag: 'Run the business',
    glyph: 'building',
    accent: '#B98BC9',
    adminOnly: true,
    home: 'agents',
    bar: ['agents', 'agent_activity', 'app_health', 'announcements'],
    views: ['agents', 'agent_activity', 'app_health', 'announcements', 'teams', 'group_message', 'agentruns'],
  },
];

// Labels + glyphs for the bottom-bar items (kept short — a bar is not a menu).
export const VIEW_META = {
  briefing:   { label: 'Plan Day', glyph: 'sun' },
  tasks:      { label: 'Tasks',    glyph: 'check' },
  review:     { label: 'Clear',    glyph: 'inbox' },
  calendar:   { label: 'Calendar', glyph: 'cal' },
  chief:      { label: 'Chief',    glyph: 'star' },
  contacts:   { label: 'Contacts', glyph: 'people' },
  inbox:      { label: 'Email',    glyph: 'mail' },
  quo:        { label: 'Calls',    glyph: 'phone' },
  journal:    { label: 'Journal',  glyph: 'book' },
  email_review:{ label: 'Triage',  glyph: 'mail' },
  documents:  { label: 'Docs',     glyph: 'doc' },
  notes:      { label: 'Library',  glyph: 'library' },
  contact_types:{ label: 'Types',  glyph: 'people' },
  prospecting:{ label: 'Today',    glyph: 'target' },
  systems:    { label: 'Systems',  glyph: 'gear' },
  growth:     { label: 'Growth',   glyph: 'up' },
  recruiting: { label: 'Recruit',  glyph: 'people' },
  playbooks:  { label: 'Scripts',  glyph: 'book' },
  pipeline:   { label: 'Pipeline', glyph: 'flow' },
  deals:      { label: 'Deals',    glyph: 'flow' },
  files:      { label: 'Files',    glyph: 'doc' },
  properties: { label: 'Property', glyph: 'building' },
  numbers:    { label: 'My GCI',   glyph: 'coin' },
  scoreboard: { label: 'Rank',     glyph: 'up' },
  mileage:    { label: 'Mileage',  glyph: 'car' },
  finance:    { label: 'Finance',  glyph: 'coin' },
  investments:{ label: 'Invest',   glyph: 'building' },
  agents:     { label: 'Roster',   glyph: 'people' },
  agent_activity:{ label: 'Activity', glyph: 'up' },
  app_health: { label: 'Health',   glyph: 'gear' },
  announcements:{ label: 'Notices', glyph: 'mail' },
  teams:      { label: 'Teams',    glyph: 'people' },
  group_message:{ label: 'Message', glyph: 'mail' },
  agentruns:  { label: 'By AI',    glyph: 'star' },
};

// view id -> mode id, so any screen knows which room it lives in (for the bar +
// the back-to-hub gesture). Built once from MODES.
export const VIEW_TO_MODE = (() => {
  const m = {};
  for (const mode of MODES) for (const v of mode.views) if (!m[v]) m[v] = mode.id;
  return m;
})();

export const modeById = (id) => MODES.find((m) => m.id === id) || null;
