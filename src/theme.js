// ── Prism theme — the single source of truth for brand tokens ────────────────
// Report finding #3: the brand theme is repeated by hand in ~38 files, so a color
// change means editing many places and polish drifts between screens. Everything
// new imports from here; existing screens migrate onto it over time. Change a value
// once here and it changes everywhere that has been migrated.

export const COLORS = {
  // canvas (screen / dark)
  ink: '#100D09',        // deepest canvas / print text
  inkDeep: '#060608',
  card: '#1B1610',
  cream: '#F6F1E7',
  creamHi: '#FBF7EF',
  // gold ramp (6 stops, bronze -> cream-hi)
  bronze: '#3D2600',
  gold0: '#7A5020',
  gold: '#C5A95E',       // hero gold
  goldAlt: '#CBA35C',
  champ: '#EBCB82',      // champagne
  champAlt: '#E2C97E',
  pale: '#F5E8B0',
  goldHi: '#FFF8DC',
  // ink-on-print / deeper gold for print
  printGold: '#9A7B2E',
  calloutFill: '#FBF6E9',
  calloutBorder: '#9A8038',
  // text roles (on dark)
  text1: '#F6F1E7',
  text2: '#C8BFAE',
  text3: '#8C8475',
  // status
  green: '#22c55e',
  amber: '#EBCB82',
  red: '#ef4444',
  warn: '#e0794f',
  good: '#7fae8f',
  // DISC
  disc: { D: '#ef4444', I: '#EBCB82', S: '#22c55e', C: '#5aa9e6' },
};

export const FONTS = {
  serif: "'Fraunces', Georgia, serif",
  display: "'Playfair Display', 'Fraunces', Georgia, serif",
  eyebrow: "'Barlow Condensed', sans-serif",
  body: "Manrope, Barlow, system-ui, sans-serif",
};

// CSS custom properties for the .ww-prism wrapper — one place, referenced by var().
export const PRISM_VARS = {
  '--bg-base': COLORS.ink,
  '--bg-card': COLORS.card,
  '--border': 'rgba(203,163,92,.20)',
  '--text-1': COLORS.text1,
  '--text-2': COLORS.text2,
  '--text-3': COLORS.text3,
  '--gold': COLORS.gold,
  '--champ': COLORS.champ,
};

// helpers
export const money = (n, cents = false) => (n || n === 0)
  ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })
  : '—';
export const goldGradient = (deg = 135) =>
  `linear-gradient(${deg}deg, ${COLORS.gold0}, ${COLORS.gold} 40%, ${COLORS.champ} 70%, ${COLORS.pale})`;

// back-compat shorthands used across newer views
export const GOLD = COLORS.gold, CHAMP = COLORS.champ, INK = COLORS.ink;

export default { COLORS, FONTS, PRISM_VARS, money, goldGradient, GOLD, CHAMP, INK };
