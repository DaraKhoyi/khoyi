// ── Pure formatting / date / phone helpers ─ extracted from App.js (strangle) ──
// No React, no app state — safe to import anywhere. App.js re-exports these for
// back-compat so existing '../App' imports keep working during the migration.
import { supabase } from './dataService';

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

export function priorityLabel(t) {
  if (t.priority_system === 'eisenhower' && t.eisenhower_quadrant) {
    return `${t.eisenhower_quadrant}${t.eisenhower_rank ?? ''}`;
  }
  return t.priority || '';
}

export function priorityClass(t) {
  if (t.priority_system === 'eisenhower' && t.eisenhower_quadrant) {
    return `priority-${t.eisenhower_quadrant}`;
  }
  return `priority-${t.priority || 'medium'}`;
}

export function pad2(n){ return String(n).padStart(2,'0'); }

export function ymd(d){ return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

export const today_ymd = () => new Date().toISOString().slice(0, 10);

export function quoNormPhone(raw) {
  if (!raw) return '';
  const d = String(raw).replace(/[^\d]/g, '');
  if (raw.toString().trim().startsWith('+')) return '+' + d;
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d ? '+' + d : '';
}

export function quoLast10(raw) { return String(raw || '').replace(/[^\d]/g, '').slice(-10); }

export function quoFmtPhone(e164) {
  if (!e164) return '';
  const d = String(e164).replace(/[^\d]/g, '');
  if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
  return e164;
}

export function quoFmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const yest = new Date(now); yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function quoFmtDur(sec) {
  if (!sec && sec !== 0) return '';
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

export function money(n){ if(n===null||n===undefined||n==='') return '—'; const v=Number(n); if(isNaN(v)) return '—'; return '$'+v.toLocaleString(undefined,{maximumFractionDigits:0}); }

export function num(v){ return v===''||v===null||v===undefined||isNaN(Number(v))?null:Number(v); }

// batch 2 — pure standalone helpers + shared style constants
export function pickerInitials(name, email) {
  const s = (name || email || '?').trim();
  if (!s) return '?';
  const parts = s.replace(/[<>"]/g, '').split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

export function owesReply(c) {
  if (!c) return false;
  if (c.last_communication_direction !== 'inbound' || !c.last_inbound_at) return false;
  const lin = new Date(c.last_inbound_at).getTime();
  if (!Number.isFinite(lin)) return false;
  if (c.comms_settled_at && new Date(c.comms_settled_at).getTime() >= lin) return false;
  if (c.no_reply_needed_at && new Date(c.no_reply_needed_at).getTime() >= lin) return false;
  return true;
}

export const modal={ width:'100%', maxWidth:'460px', padding:'18px' };

export const lbl={ display:'flex', flexDirection:'column', gap:'3px', fontSize:'10px', color:'var(--text-3)', textTransform:'uppercase', letterSpacing:'.04em', fontWeight:700 };

// email reply splitter — separates a freshly-typed reply from the quoted thread below it
export function splitQuotedReply(text) {
  const src = String(text || '');
  if (!src.trim()) return { body: src, quoted: '' };
  const lines = src.split('\n');
  const MARKERS = [
    /^\s*On .{4,120}\bwrote:\s*$/i,          // Gmail / Apple: "On <date>, <name> wrote:"
    /^\s*-{2,}\s*Original Message\s*-{2,}/i, // Outlook
    /^\s*-{2,}\s*Forwarded message\s*-{2,}/i,
    /^\s*_{5,}\s*$/,                          // Outlook's underscore rule
    /^\s*From:\s*.+/i,                        // Outlook header block
    /^\s*Sent from my \w+/i,                  // signature that precedes a quote
  ];
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (MARKERS.some(re => re.test(ln))) { cut = i; break; }
    // A run of quoted lines counts too, but one stray ">" does not — a single
    // line could easily be an arrow or a fragment the user typed themselves.
    if (/^\s*>/.test(ln) && /^\s*>/.test(lines[i + 1] || '')) { cut = i; break; }
  }
  if (cut < 0) return { body: src, quoted: '' };
  return { body: lines.slice(0, cut).join('\n'), quoted: lines.slice(cut).join('\n') };
}

// HTML entity decoding — used across email/notes rendering
export const HTML_ENTITIES = {
  lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ',
  ndash: '\u2013', mdash: '\u2014', lsquo: '\u2018', rsquo: '\u2019',
  ldquo: '\u201C', rdquo: '\u201D', hellip: '\u2026', bull: '\u2022',
  middot: '\u00B7', copy: '\u00A9', reg: '\u00AE', trade: '\u2122',
  deg: '\u00B0', eacute: '\u00E9', egrave: '\u00E8', uuml: '\u00FC',
  ouml: '\u00F6', auml: '\u00E4', ccedil: '\u00E7', ntilde: '\u00F1',
  laquo: '\u00AB', raquo: '\u00BB', euro: '\u20AC', pound: '\u00A3', yen: '\u00A5',
};
export function cpToStr(cp) {
  // Reject surrogates and out-of-range values rather than throwing on bad input.
  if (!Number.isFinite(cp) || cp < 0 || cp > 0x10FFFF || (cp >= 0xD800 && cp <= 0xDFFF)) return '';
  try { return String.fromCodePoint(cp); } catch (_) { return ''; }
}
export function decodeEntities(str) {
  if (typeof str !== 'string' || str.indexOf('&') === -1) return str;
  return str
    .replace(/&#x([0-9a-f]+);/gi, (m, h) => cpToStr(parseInt(h, 16)) || m)
    .replace(/&#(\d+);/g, (m, d) => cpToStr(parseInt(d, 10)) || m)
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => {
      const k = n.toLowerCase();
      return k === 'amp' ? m : (HTML_ENTITIES[k] !== undefined ? HTML_ENTITIES[k] : m);
    })
    .replace(/&amp;/gi, '&');
}

// merge fields + send-account resolution (moved with the email modals)
export const MERGE_FIELDS = [
  { token: 'first_name', label: 'First name' },
  { token: 'last_name', label: 'Last name' },
  { token: 'full_name', label: 'Full name' },
  { token: 'company', label: 'Company' },
  { token: 'role', label: 'Role/title' },
  { token: 'email', label: 'Email' },
  { token: 'phone', label: 'Phone' },
  { token: 'property_address', label: 'Property address' },
  { token: 'deal_name', label: 'File name' },
  { token: 'my_name', label: 'Your name' },
  { token: 'today', label: "Today's date" },
];

export function applyMergeFields(text, { contact, deal, property, senderName } = {}) {
  if (!text) return text || '';
  const nm = (contact?.name || '').trim();
  const parts = nm ? nm.split(/\s+/) : [];
  const map = {
    first_name: parts[0] || '',
    last_name: parts.length > 1 ? parts[parts.length - 1] : '',
    full_name: nm,
    company: contact?.company || '',
    role: contact?.role || '',
    email: contact?.email || '',
    phone: contact?.phone || '',
    property_address: property?.address || deal?.address || '',
    deal_name: deal?.name || '',
    my_name: senderName || 'Dara',
    today: new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
  };
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key) => {
    const k = key.toLowerCase();
    return (k in map) ? map[k] : m;
  });
}

export async function resolveSendAccount(fields = 'id,email_address') {
  const sel = fields.includes('is_default') ? fields : fields + ',is_default';
  const { data } = await supabase.from('email_accounts')
    .select(sel).contains('purposes', ['email']).order('created_at');
  const accs = data || [];
  if (!accs.length) return null;
  return accs.find(a => a.is_default) || accs.find(a => a.is_active !== false) || accs[0];
}

// task priority test (A-quadrant / top rank)
export function isTopPriority(t) {
  if (t.priority_system === 'eisenhower') return t.eisenhower_quadrant === 'A';
  return t.priority === 'high';
}

// Eisenhower quadrant labels for the priority picker
export const QUADRANTS = [
  { letter:'A', label:'A — Urgent & Important',     short:'Do now' },
  { letter:'B', label:'B — Important, Not Urgent',  short:'Schedule' },
  { letter:'C', label:'C — Urgent, Not Important',  short:'Delegate' },
  { letter:'D', label:'D — Neither',                short:'Drop' },
];

// task ordering (priority quadrant, due date, created)
export function taskSortKey(t) {
  if (t.priority_system === 'eisenhower' && t.eisenhower_quadrant) {
    const qIdx = { A:0, B:1, C:2, D:3 }[t.eisenhower_quadrant] ?? 4;
    return [0, qIdx, t.eisenhower_rank ?? 999];
  }
  const pIdx = { high:0, medium:1, low:2 }[t.priority] ?? 3;
  return [1, pIdx, t.simple_rank ?? 999];
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) => {
    const ka = taskSortKey(a), kb = taskSortKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return 0;
  });
}
