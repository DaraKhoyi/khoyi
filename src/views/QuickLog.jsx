// QuickLog — the fast activity-logging sheet, and the locked-page shell it shares.
// Extracted from App.js (strangle the monolith, step 28).
import React, { useEffect, useRef, useState } from 'react';
import { modal } from '../helpers';
import { Icon } from '../icons';
import { logJournalEntry } from '../lib/journalLog';
import RedeemCodeBox from '../views/RedeemCodeBox';
import { useDictation } from '../views/SharedUi';

export function LockedPage({ page, onRedeem, onSettings }) {
  return (
    <div style={{ maxWidth: 520, margin: '8vh auto 0', textAlign: 'center', padding: '0 20px' }}>
      <div style={{ width: 64, height: 64, borderRadius: 18, margin: '0 auto 20px', display: 'grid', placeItems: 'center', background: 'rgba(203,163,92,0.1)', border: '1px solid rgba(203,163,92,0.3)' }}>
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="#CBA35C" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      </div>
      <div style={{ fontSize: '10.5px', fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 6 }}>Locked feature</div>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 400, fontSize: 28, color: 'var(--text-1)', margin: '0 0 10px' }}>{page.label}</h2>
      <p style={{ fontSize: 14, color: 'var(--text-2)', lineHeight: 1.6, margin: '0 0 24px' }}>
        This page isn&rsquo;t part of your current plan. If you have an unlock code, enter it below and it&rsquo;ll turn on right away — otherwise reach out to your broker to add it.
      </p>
      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, textAlign: 'left' }}>
        <RedeemCodeBox onRedeemed={onRedeem} />
      </div>
      <button className="btn btn-ghost" style={{ marginTop: 18 }} onClick={onSettings}>Go to Settings</button>
    </div>
  );
}






// ─────────────────────────────────────────
// PROJECT TRACKER  (tracker schema — multi-user RBAC)
// ─────────────────────────────────────────

export function QuickLog({ userId, onNavigate, onUploadRecording }) {
  const recRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const dict = useDictation((f) => setText(prev => { const sep = (!prev || /\s$/.test(prev)) ? '' : ' '; return prev + sep + f.trim() + ' '; }));

  async function save() {
    const c = text.trim(); if (!c || saving) return;
    if (dict.recording) dict.stop();
    setSaving(true);
    try { await logJournalEntry(userId, c, dict.recording ? 'voice' : 'text'); setText(''); setJournalOpen(false); if (window.__notify) window.__notify('Logged to journal', 'success'); }
    catch (e) { if (window.__notify) window.__notify(e.message || 'Save failed — please try again. Your text is still here.', 'error'); }
    finally { setSaving(false); }
  }

  const go = (view) => { setMenuOpen(false); if (onNavigate) onNavigate(view); };
  const goQuo = (tab) => { try { window.__quoTab = tab; } catch (e) {} go('quo'); };
  const openJournal = () => { setMenuOpen(false); setJournalOpen(true); };

  // Listed in the user's order; rendered bottom-up (journal nearest the thumb).
  const MENU = [
    { key: 'journal', label: 'Journal',        icon: 'journal',   run: openJournal },
    { key: 'task',    label: 'Task',           icon: 'tasks',     run: () => go('tasks') },
    { key: 'event',   label: 'Calendar',       icon: 'calendar',  run: () => go('calendar') },
    { key: 'contact', label: 'Contact',        icon: 'contacts',  run: () => go('contacts') },
    { key: 'ari',     label: 'Ari',            icon: 'briefing',  run: () => go('chat') },
    { key: 'text',    label: 'Text',           icon: 'message',   run: () => goQuo('messages') },
    { key: 'email',   label: 'Email',          icon: 'mail',      run: () => go('inbox') },
    { key: 'call',    label: 'Quo',            icon: 'quo',       run: () => goQuo('calls') },
    { key: 'recording', label: 'Recording',    icon: 'mic',       run: () => { setMenuOpen(false); if (recRef.current) recRef.current.click(); } },
  ];
  useEffect(() => { window.__attachRecording = () => { if (recRef.current) recRef.current.click(); }; return () => { try { delete window.__attachRecording; } catch (_) {} }; }, []);

  return (
    <>
      <input ref={recRef} type="file" accept="audio/*,.amr,.m4a,.mp3,.wav,.aac,.ogg,.opus,.webm,.3gp" style={{ display: 'none' }}
        onChange={(e) => { const file = e.target.files && e.target.files[0]; e.target.value = ''; if (file && onUploadRecording) onUploadRecording(file); }} />
      {/* Floating quick-create menu */}
      {menuOpen && (
        <>
          <div onClick={() => setMenuOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.28)', backdropFilter: 'blur(1px)' }} />
          <div style={{ position: 'fixed', right: '11px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 123px)', zIndex: 9001, display: 'flex', flexDirection: 'column-reverse', gap: '12px', alignItems: 'flex-end' }}>
            {MENU.map((m, i) => (
              <button key={m.key} onClick={m.run}
                style={{ display: 'flex', alignItems: 'center', gap: '10px', background: 'none', border: 'none', padding: 0, cursor: 'pointer', animation: 'qmRise 0.18s ease both', animationDelay: `${i * 0.03}s` }}>
                <span style={{ padding: '7px 12px', borderRadius: '999px', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-1)', fontSize: '13px', fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 4px 14px rgba(0,0,0,0.35)' }}>{m.label}</span>
                <span style={{ width: '42px', height: '42px', borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--accent)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 14px rgba(0,0,0,0.4)', flexShrink: 0 }}>
                  <Icon name={m.icon} size={19} />
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* FAB — memory icon, 40% smaller, toggles the menu */}
      <button onClick={() => setMenuOpen(o => !o)} aria-label={menuOpen ? 'Close quick create' : 'Quick create'} title="Quick create"
        style={{ position: 'fixed', right: '16px', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 78px)', zIndex: 9002, width: '33px', height: '33px', borderRadius: '50%', background: 'var(--accent)', color: 'var(--bg-base)', border: 'none', boxShadow: '0 6px 20px rgba(0,0,0,0.45)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.18s ease', transform: menuOpen ? 'rotate(90deg)' : 'none' }}>
        {menuOpen ? <span style={{ fontSize: '16px', fontWeight: 700, lineHeight: 1 }}>✕</span> : <Icon name="brain" size={17} />}
      </button>

      {journalOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setJournalOpen(false); }} style={{ padding: '12px' }}>
          <div className="modal" style={{ maxWidth: 'none', width: 'min(760px, 100%)', height: 'min(92vh, 100%)', maxHeight: 'none', padding: '18px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: '16px', display:'inline-flex', alignItems:'center', gap:'7px' }}><Icon name="journal" size={16} /> Quick log</h3>
              <button onClick={() => setJournalOpen(false)} style={{ background: 'none', border: 'none', fontSize: '22px', color: 'var(--text-3)', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <textarea autoFocus value={text + (dict.interim ? ((text && !/\s$/.test(text)) ? ' ' : '') + dict.interim : '')} onChange={e => setText(e.target.value)} placeholder="Capture a moment — it'll timestamp and auto-link…"
              style={{ flex: 1, minHeight: 0, width: '100%', padding: '15px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '10px', color: 'var(--text-1)', fontSize: '16px', boxSizing: 'border-box', lineHeight: 1.6, resize: 'none', fontFamily: 'inherit' }} />
            <div style={{ display: 'flex', gap: '8px', marginTop: '12px', alignItems: 'center', flexShrink: 0 }}>
              {dict.supported && <button onClick={() => dict.recording ? dict.stop() : dict.start()} style={{ padding: '10px 16px', borderRadius: '999px', border: `1px solid ${dict.recording ? 'var(--red)' : 'var(--border)'}`, background: dict.recording ? 'rgba(239,68,68,0.12)' : 'var(--bg-hover)', color: dict.recording ? 'var(--red)' : 'var(--text-2)', cursor: 'pointer', fontSize: '13px', fontWeight: 700 }}>{dict.recording ? <>⏹ Recording…</> : <><Icon name="mic" size={13} /> Voice</>}</button>}
              <span style={{ flex: 1 }} />
              <button onClick={save} disabled={saving || !text.trim()} style={{ padding: '10px 24px', background: 'var(--accent)', color: 'var(--bg-base)', border: 'none', borderRadius: '999px', fontWeight: 800, fontSize: '14px', cursor: 'pointer', opacity: (saving || !text.trim()) ? 0.5 : 1 }}>{saving ? '…' : 'Log'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}




// ─────────────────────────────────────────
// SETTINGS VIEW


// ─────────────────────────────────────────
// SETTINGS VIEW
// ─────────────────────────────────────────




// Ari capability toggles — gate what the assistant can read/do, scoped to you.
















// SimplifyPanel — every hideable page from the registry, grouped, each with a
// show/hide toggle. Core pages appear as always-on (locked). Driven entirely by
// pages.js so a new page shows up here automatically, and hiding here propagates
// to every menu via pageVisible().
// AdminLicensingPanel — the owner's control center (Settings, admin only):
// the master enforcement switch, code generation, and the live code list.


// RedeemCodeBox — enter an unlock code, redeem it, refresh entitlements. Reused
// on the locked-page panel and in Settings.


// LockedPage — shown when enforcement is on and the user opens a page they aren't
// entitled to. An honest upsell, not a dead end: says what the page is and lets
// them redeem a code on the spot.
