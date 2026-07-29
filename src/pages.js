// ── pages.js — the single source of truth for every page in PrismOS ───────────
//
// STAGE 0 of the menu-consolidation + licensing work. Before this file, the same
// screen was described in up to four places that drifted: the primary MENU tree
// (App.js), the mindset rooms (modes.js), the NAV_ALL tab list (App.js), and the
// router. Adding a page meant editing three or four spots and hoping they agreed.
//
// Now EVERY page is declared once here. The menus, the tab bar, visibility
// (module_visibility), role-gating, and — soon — entitlements all derive from
// this. modes.js still owns each room's ORDER and bottom-bar (a room's feel), but
// the room a page belongs to, its label, icon, group, role, and license tier live
// here.
//
// Fields per page:
//   label     display name (menus + tabs)
//   icon      icon key (matches the app's <Icon name> set) or an emoji glyph
//   room      which mindset room it lives in (matches a MODES id) | null
//   group     which primary-menu group heading it sits under
//   minRole   'agent' | 'team_leader' | 'admin'  — lowest role that may see it
//   feature   entitlement key for licensing (Stage 2+). Pages sharing a feature
//             unlock together. `core: true` overrides — always on, never licensed.
//   tier      'base' | 'pro'  — the default package a page ships in. When
//             licensing goes live, everyone drops to `base`; `pro` pages are
//             granted up per user. (Per Dara: license per PAGE, drop-to-base.)
//   built     false = a planned placeholder, greyed in menus, no route yet
//   core      true = cannot be hidden or licensed away (Today, Settings, …)
//
// NOTE: badges (unread counts, task counts, …) stay computed at render time in
// App.js — they are live data, not static metadata, so they don't belong here.

export const PAGE_GROUPS = [
  'Daily',
  'AI Agents',
  'Pipeline & Growth',
  'Communications',
  'Deals & Property',
  'Finance',
  'Learn & Coaching',
  'My Prism Identity',
  'Brokerage',
  'Settings & Systems',
];

export const PAGES = {
  // ── Daily drivers ──────────────────────────────────────────────────────────
  today:        { label: 'Today',            icon: 'sparkles', room: null,            group: 'Daily', minRole: 'agent', feature: 'core',        tier: 'base', core: true },
  dashboard:    { label: 'Dashboard',        icon: 'dashboard', room: null,           group: 'Daily', minRole: 'agent', feature: 'core',        tier: 'base' },
  review:       { label: 'Review',           icon: 'inbox',    room: null,            group: 'Daily', minRole: 'agent', feature: 'core',        tier: 'base' },
  tasks:        { label: 'Tasks',            icon: 'tasks',    room: null,            group: 'Daily', minRole: 'agent', feature: 'tasks',       tier: 'base' },
  someday:      { label: 'Someday / Maybe',  icon: 'sparkles', room: null,            group: 'Daily', minRole: 'agent', feature: 'tasks',       tier: 'base' },
  calendar:     { label: 'Calendar',         icon: 'calendar', room: null,            group: 'Daily', minRole: 'agent', feature: 'calendar',    tier: 'base', ai: true },
  chat:         { label: 'Ask Ari',          icon: 'chat',     room: 'library',       group: 'Daily', minRole: 'agent', feature: 'ai_assistant',tier: 'pro',  ai: true },

  // ── Relationships / Communications ─────────────────────────────────────────
  contacts:     { label: 'Contacts',         icon: 'contacts', room: 'relationships', group: 'Communications', minRole: 'agent', feature: 'contacts',     tier: 'base', ai: true },
  inbox:        { label: 'Inbox',            icon: 'inbox',    room: 'relationships', group: 'Communications', minRole: 'agent', feature: 'inbox',        tier: 'base', ai: true },
  email_review: { label: 'Email Review',     icon: 'mail',     room: 'relationships', group: 'Communications', minRole: 'agent', feature: 'inbox',        tier: 'base', ai: true },
  quo:          { label: 'Phone & Text',     icon: 'quo',      room: 'relationships', group: 'Communications', minRole: 'agent', feature: 'quo',          tier: 'pro',  ai: true },
  journal:      { label: 'Daily Journal',    icon: 'journal',  room: 'relationships', group: 'Communications', minRole: 'agent', feature: 'journal',      tier: 'base', ai: true },
  group_message:{ label: 'Group Message',    icon: 'message',  room: 'brokerage',     group: 'Communications', minRole: 'agent', feature: 'group_message',tier: 'pro',  ai: true },
  contact_types:{ label: 'Contact Types',    icon: 'contacts', room: 'relationships', group: 'Communications', minRole: 'agent', feature: 'contacts',     tier: 'base' },

  // ── Library / knowledge ────────────────────────────────────────────────────
  notes:        { label: 'Library',          icon: 'notes',    room: 'library',       group: 'Learn & Coaching', minRole: 'agent', feature: 'library',    tier: 'base', ai: true },
  documents:    { label: 'Documents',        icon: 'folder',   room: 'library',       group: 'Deals & Property', minRole: 'agent', feature: 'library',    tier: 'base' },
  brain:        { label: 'Brain',            icon: 'brain',    room: 'library',       group: 'Learn & Coaching', minRole: 'agent', feature: 'brain',      tier: 'pro',  ai: true },
  knowledge:    { label: 'Knowledge',        icon: 'library',  room: 'library',       group: 'Learn & Coaching', minRole: 'agent', feature: 'library',    tier: 'base' },
  playbooks:    { label: 'Playbooks',        icon: 'playbooks',room: 'prospect',      group: 'Learn & Coaching', minRole: 'agent', feature: 'playbooks',  tier: 'base' },
  learn:        { label: 'Field Guide',      icon: 'library',  room: null,            group: 'Learn & Coaching', minRole: 'agent', feature: 'core',       tier: 'base' },
  coach:        { label: 'Coach',            icon: 'target',   room: null,            group: 'Learn & Coaching', minRole: 'agent', feature: 'coaching',   tier: 'pro' },

  // ── Prospect / Pipeline / Growth ───────────────────────────────────────────
  prospecting:  { label: 'Prospecting',      icon: 'prospecting', room: 'prospect',   group: 'Pipeline & Growth', minRole: 'agent', feature: 'prospecting',tier: 'base' },
  systems:      { label: 'Lead-Gen Systems', icon: 'signal',   room: 'prospect',      group: 'Pipeline & Growth', minRole: 'agent', feature: 'prospecting',tier: 'pro' },
  pipeline:     { label: 'Transaction Pipeline', icon: 'chart', room: 'deals',        group: 'Pipeline & Growth', minRole: 'agent', feature: 'pipeline',   tier: 'base' },
  scoreboard:   { label: "How I'm Doing",    icon: 'target',   room: 'money',         group: 'Pipeline & Growth', minRole: 'agent', feature: 'scoreboard', tier: 'base' },
  growth:       { label: 'Growth',           icon: 'chart',    room: 'prospect',      group: 'Pipeline & Growth', minRole: 'agent', feature: 'growth',     tier: 'pro' },

  // ── AI Agents ──────────────────────────────────────────────────────────────
  chief:        { label: 'Chief of Staff',   icon: 'briefing', room: null,            group: 'AI Agents', minRole: 'agent', feature: 'ai_assistant', tier: 'pro', ai: true },
  agentruns:    { label: 'Prepared by AI',   icon: 'sparkles', room: 'brokerage',     group: 'AI Agents', minRole: 'agent', feature: 'ai_assistant', tier: 'pro', ai: true },
  agent_activity:{ label: 'Agent Activity',  icon: 'brain',    room: 'brokerage',     group: 'AI Agents', minRole: 'admin', feature: 'brokerage',    tier: 'pro' },
  briefing:     { label: 'Plan My Day',      icon: 'sun',      room: 'money',         group: 'AI Agents', minRole: 'agent', feature: 'ai_assistant', tier: 'pro', ai: true },

  // ── Deals & Property ───────────────────────────────────────────────────────
  deals:        { label: 'Deals / Files',    icon: 'deals',    room: 'deals',         group: 'Deals & Property', minRole: 'agent', feature: 'deals',      tier: 'base' },
  files:        { label: 'Contract Management', icon: 'folder',room: 'deals',         group: 'Deals & Property', minRole: 'agent', feature: 'deals',      tier: 'base', ai: true },
  tracker:      { label: 'My Projects',      icon: 'tracker',  room: 'deals',         group: 'Deals & Property', minRole: 'agent', feature: 'deals',      tier: 'base' },
  properties:   { label: 'Properties',       icon: 'properties', room: 'deals',       group: 'Deals & Property', minRole: 'agent', feature: 'properties', tier: 'pro' },
  investments:  { label: 'My Investments',   icon: 'investments', room: 'money',      group: 'Deals & Property', minRole: 'agent', feature: 'investments',tier: 'pro' },

  // ── Finance / Money ────────────────────────────────────────────────────────
  finance:      { label: 'Finance Dashboard',icon: 'dollar',   room: 'money',         group: 'Finance', minRole: 'agent', feature: 'finance',     tier: 'pro' },
  mileage:      { label: 'Mileage',          icon: 'car',      room: 'money',         group: 'Finance', minRole: 'agent', feature: 'mileage',     tier: 'base' },
  numbers:      { label: 'My Stats',         icon: 'chart',    room: 'money',         group: 'Finance', minRole: 'agent', feature: 'numbers',     tier: 'base' },

  // ── My Prism Identity ──────────────────────────────────────────────────────
  my_prism:     { label: 'My Prism Profile', icon: 'prism',    room: null,            group: 'My Prism Identity', minRole: 'agent', feature: 'disc',      tier: 'base' },
  prism:        { label: 'Prism Profile',    icon: 'prism',    room: null,            group: 'My Prism Identity', minRole: 'agent', feature: 'disc',      tier: 'base' },
  disc_test:    { label: 'DISC / Grit Test', icon: 'bulb',     room: null,            group: 'My Prism Identity', minRole: 'agent', feature: 'disc',      tier: 'base' },
  disc_roster:  { label: 'DISC Roster',      icon: 'bulb',     room: null,            group: 'My Prism Identity', minRole: 'agent', feature: 'disc',      tier: 'pro' },
  myvoice:      { label: 'My Voice',         icon: 'mic',      room: null,            group: 'My Prism Identity', minRole: 'agent', feature: 'myvoice',    tier: 'pro' },
  voice_roster: { label: 'Voice Roster',     icon: 'mic',      room: null,            group: 'My Prism Identity', minRole: 'agent', feature: 'myvoice',    tier: 'pro' },

  // ── Brokerage (role-gated) ─────────────────────────────────────────────────
  agents:       { label: 'Brokerage',        icon: 'building', room: 'brokerage',     group: 'Brokerage', minRole: 'team_leader', feature: 'brokerage', tier: 'pro' },
  recruiting:   { label: 'Recruiting',       icon: 'recruiting', room: 'prospect',    group: 'Pipeline & Growth', minRole: 'admin', feature: 'recruiting', tier: 'pro' },
  team:         { label: 'Team Sharing',     icon: 'users',    room: 'brokerage',     group: 'Brokerage', minRole: 'team_leader', feature: 'brokerage', tier: 'pro' },
  teams:        { label: 'Teams',            icon: 'users',    room: 'brokerage',     group: 'Brokerage', minRole: 'admin', feature: 'brokerage',    tier: 'pro' },
  announcements:{ label: 'Announcements',    icon: 'megaphone',room: 'brokerage',     group: 'Brokerage', minRole: 'team_leader', feature: 'brokerage', tier: 'pro' },
  production:   { label: 'Production',       icon: 'chart',    room: 'brokerage',     group: 'Brokerage', minRole: 'admin', feature: 'brokerage',    tier: 'pro' },
  actas:        { label: 'Act as User',      icon: 'users',    room: null,            group: 'Brokerage', minRole: 'admin', feature: 'brokerage',    tier: 'pro' },

  // ── Settings & Systems ─────────────────────────────────────────────────────
  settings:     { label: 'Settings',         icon: 'settings', room: null,            group: 'Settings & Systems', minRole: 'agent', feature: 'core',      tier: 'base', core: true },
  app_health:   { label: 'System Health',    icon: 'systems',  room: 'brokerage',     group: 'Settings & Systems', minRole: 'admin', feature: 'brokerage', tier: 'pro' },
  classic_dashboard: { label: 'Classic Dashboard', icon: 'dashboard', room: null,     group: 'Settings & Systems', minRole: 'agent', feature: 'core',      tier: 'base' },
};

// Role rank for minRole comparisons.
const ROLE_RANK = { agent: 0, team_leader: 1, admin: 2, owner: 3 };
export function roleAllows(userRole, minRole) {
  const u = ROLE_RANK[userRole] ?? 0;
  const need = ROLE_RANK[minRole] ?? 0;
  return u >= need;
}

// The single predicate every menu/tab uses: may this user SEE this page right now?
// Combines (1) it exists & built, (2) role, (3) per-user hide (module_visibility),
// (4) — Stage 2+ — entitlements. `entitled` is injected so this file stays free of
// data-loading; callers pass a (pageId)=>bool built from the user's entitlements.
export function pageVisible(pageId, { role = 'agent', moduleVisibility = {}, entitled = null, isImpersonating = false } = {}) {
  const p = PAGES[pageId];
  if (!p) return false;
  if (p.built === false) return false;
  if (!roleAllows(role, p.minRole)) return false;
  if (p.core) return true;                      // core pages are never hidden/licensed
  if (moduleVisibility[pageId] === false) return false;   // per-user simplify (Stage 1)
  if (entitled && !entitled(p.feature)) return false;      // licensing (Stage 2+)
  return true;
}

// Pages grouped for the primary menu, in group order, honoring visibility.
export function pagesByGroup(ctx) {
  const out = {};
  for (const g of PAGE_GROUPS) out[g] = [];
  for (const [id, p] of Object.entries(PAGES)) {
    if (!pageVisible(id, ctx)) continue;
    (out[p.group] || (out[p.group] = [])).push({ id, ...p });
  }
  return out;
}

// The set of feature keys, for the admin entitlement UI (Stage 3).
export const ALL_FEATURES = [...new Set(Object.values(PAGES).map(p => p.feature))].filter(f => f && f !== 'core').sort();

// The base-tier feature set (what everyone keeps when licensing ships).
export const BASE_FEATURES = [...new Set(Object.values(PAGES).filter(p => p.tier === 'base').map(p => p.feature))].filter(f => f && f !== 'core').sort();

// Build the `entitled(feature)` predicate for a user. A feature is available if:
//   • it's core or base-tier (everyone keeps these — "drop to base"), or
//   • the owner/admin is asking (they always have everything), or
//   • the user has been granted it (an entitlement row / redeemed code).
// grantedFeatures is the array from get_my_entitlements(); role bypass covers
// owner + admins. This is what Stage 3 passes into pageVisible().
export function makeEntitled(grantedFeatures, role) {
  const granted = new Set(grantedFeatures || []);
  const base = new Set([...BASE_FEATURES, 'core']);
  const roleBypass = role === 'owner' || role === 'admin';
  return (feature) => {
    if (!feature || feature === 'core') return true;
    if (base.has(feature)) return true;
    if (roleBypass) return true;
    return granted.has(feature);
  };
}
