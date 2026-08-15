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
    // "Relationships" undersold it: half this room is not people, it is the
    // promises you made them (Tasks), when you see them (Calendar) and the record
    // of what happened (Journal). The room holds all of it, and its name must not
    // collide with the Contacts page inside it, which is titled "My People."
    // Renamed from "My World" at Dara's request. The room's stored identity is the
    // id 'relationships' — resume state and mode preference key off that, never the
    // label — so renaming is safe and orphans no saved state.
    label: 'Nerve Center CRM',
    tag: 'My people, my day.',
    glyph: 'globe',
    accent: '#8FB8A8',
    home: 'contacts',
    resume: true,
    // Dara's order (left→right): Contacts, Calls, Calendar, Tasks, Email, Journal.
    // Six sections so the whole daily-communication surface is one tap apart.
    bar: ['contacts', 'quo', 'calendar', 'tasks', 'inbox', 'journal'],
    views: ['contacts', 'quo', 'calendar', 'tasks', 'inbox', 'journal', 'email_review', 'contact_types', 'google_contacts', 'cadence_review'],
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
    resume: true,
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
    label: 'Prospecting',
    tag: 'Find new business',
    glyph: 'target',
    accent: '#C98A5E',
    home: 'prospecting',
    resume: true,
    // Six sections, one complete hunt loop, left to right:
    //   pick a system -> work it today -> know what to say -> present -> see
    //   what paid -> steer the quarter.
    // Today / Systems / ROI deep-link into ProspectingView's own sub-tabs; the
    // page hides its internal pill row when this bar is driving it, so there is
    // never a second tab strip stacked on the same screen.
    // Recruiting moved OUT to Brokerage - hiring agents is running the business,
    // not hunting client work, and mixing the two is what made the old menu a pile.
    bar: [
      // Six distinct glyphs on purpose. ROI and Growth both wanted the rising
      // line; two identical icons in one bar is a bar you have to read.
      { view: 'prospecting', sub: 'today',   label: 'Today',   glyph: 'target' },
      { view: 'prospecting', sub: 'library', label: 'Systems', glyph: 'library' },
      { view: 'prospecting', sub: 'roi',     label: 'ROI',     glyph: 'coin' },
      { view: 'playbooks', label: 'Scripts', glyph: 'book' },
      { view: 'listing_presentation', label: 'Present', glyph: 'doc' },
      { view: 'growth', label: 'Growth', glyph: 'up' },
    ],
    // listing_presentation belonged to NO room, so it showed no bottom bar at
    // all - the same gap Calendar and Tasks had. It is the screen where a seller
    // lead becomes a listing, so it belongs in the hunting room.
    views: ['prospecting', 'playbooks', 'listing_presentation', 'growth'],
  },
  {
    id: 'deals',
    label: 'Deals',
    tag: "What's in motion",
    glyph: 'flow',
    accent: '#7FA6C9',
    home: 'pipeline',
    resume: true,
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
    resume: true,
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
    resume: true,
    // Recruiting lives here now: growing the roster is a brokerage job.
    bar: ['agents', 'recruiting', 'agent_activity', 'app_health', 'announcements'],
    // 'systems' is the INFRASTRUCTURE health monitor (Online / Degraded /
    // Offline) - it was filed under Prospect, where an ops screen inherited the
    // hunting bar. It is an operations tool, so it sits beside app_health.
    views: ['agents', 'recruiting', 'agent_activity', 'app_health', 'announcements', 'teams', 'group_message', 'agentruns', 'systems'],
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
  listing_presentation: { label: 'Present', glyph: 'doc' },
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
