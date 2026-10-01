// calm.js — the quiet visual language (1 Oct 2026).
//
// Josh, after a week on his iPhone: "Borders around borders around borders
// around cards… gold outlines everywhere, different font families, teeny
// uppercase headings, pills everywhere, icons everywhere. Nothing gets to
// breathe. It feels like a cockpit instead of a luxury." Dara: "I was feeling
// the same — overwhelmed."
//
// The rules, so every screen that adopts this reads as one place:
//   • TWO typefaces. Fraunces (light) for the few words that are titles;
//     Manrope for everything else. No condensed uppercase labels.
//   • NO BOXES AROUND ROWS. A list is rows divided by one faint hairline. A
//     border is for the rare thing that must stand apart, never for grouping.
//   • GOLD IS AN ACCENT, NOT A FRAME. One filled gold button per row at most;
//     links are gold text; nothing gets a gold outline.
//   • SPACE IS THE LUXURY. Generous padding, 15px titles, 13.5px explanations.
//   • NO INVENTORY COUNTS. A number appears only when it is the answer to the
//     question the screen asks ("2 replies drafted for your OK"), never as a
//     measure of how much exists.
// Plain objects, not components, so any screen can adopt them without a rewrite.

const SERIF = "'Fraunces', Georgia, serif";
const SANS = "'Manrope', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif";
const HAIR = '1px solid rgba(246,241,231,0.07)';

export const calm = {
  SERIF, SANS, HAIR,
  page: { maxWidth: 680, margin: '0 auto', fontFamily: SANS },
  greeting: { fontFamily: SERIF, fontWeight: 300, fontSize: 30, letterSpacing: '-0.015em', color: 'var(--text-1)', margin: 0, lineHeight: 1.15 },
  date: { fontSize: 13.5, color: 'var(--text-3)', marginTop: 4 },
  section: { fontFamily: SERIF, fontWeight: 400, fontSize: 19, color: 'var(--text-1)', margin: '30px 0 4px' },
  sectionNote: { fontSize: 13, color: 'var(--text-3)', marginBottom: 6, lineHeight: 1.5 },
  row: { padding: '14px 0' },
  rowRule: { padding: '14px 0', borderTop: HAIR },
  rowTitle: { fontSize: 15.5, fontWeight: 600, color: 'var(--text-1)', lineHeight: 1.4 },
  rowWhy: { fontSize: 13.5, color: 'var(--text-2)', marginTop: 3, lineHeight: 1.5 },
  actions: { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 },
  btnPrimary: { minHeight: 40, padding: '0 16px', borderRadius: 10, border: 'none', background: '#C5A95E', color: '#100D09',
    fontFamily: SANS, fontSize: 13.5, fontWeight: 700, cursor: 'pointer' },
  btnQuiet: { minHeight: 40, padding: '0 10px', borderRadius: 10, border: 'none', background: 'transparent', color: 'var(--text-3)',
    fontFamily: SANS, fontSize: 13.5, fontWeight: 600, cursor: 'pointer' },
  link: { minHeight: 44, padding: 0, border: 'none', background: 'none', color: '#C5A95E', fontFamily: SANS, fontSize: 13.5,
    fontWeight: 600, cursor: 'pointer', textAlign: 'left' },
  empty: { fontSize: 14, color: 'var(--text-3)', padding: '14px 0', lineHeight: 1.5 },
};

export default calm;
