// ── Pure formatting / date / phone helpers ─ extracted from App.js (strangle) ──
// No React, no app state — safe to import anywhere. App.js re-exports these for
// back-compat so existing '../App' imports keep working during the migration.

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
