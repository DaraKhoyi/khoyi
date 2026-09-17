import React, { useState } from 'react';
import { MODES } from '../modes';

// Launchers.
//
// Dara long-presses nothing. He wants ICONS ON THE HOME SCREEN — one per room —
// and his PiTaKa case has three NFC buttons that fire a URL. Both of those need
// the same thing and it is not a jump list: it is a plain, copyable link to each
// destination.
//
// Every room and page in PrismOS already has one. ?view= has been honoured since
// the launcher work, ?sub= since today. Nothing needed building except somewhere
// to SEE them, which is this page — because a URL nobody can find is a URL that
// does not exist.
//
// Why not one installable app per room, which is the other way to do this: on
// Android a PWA's identity is its MANIFEST PATH, so serving a second manifest
// does produce a second icon with its own name. It also produces a second app in
// the launcher, a second entry in app settings, and a second thing to update.
// Google explicitly discourages it for exactly this shape. A home-screen
// shortcut to a URL gets the same icon in the same place with none of that, so
// that is what this page hands out.

// The eight that have their own install page under /launch/. Each is a
// separately installable app with its own name and icon, so tapping "Add to
// Home Screen" there gives a real, labelled icon rather than a ninth copy of the
// PrismOS one.
const INSTALLABLE = [
  ['nerve',      'Nerve Center', 'Your whole world'],
  ['money',      'Money',        'Add an expense, see the numbers'],
  ['prospect',   'Prospecting',  "Today's hunt"],
  ['deals',      'Deals',        'Your pipeline'],
  ['library',    'Library',      'Notes, docs and calls'],
  ['brokerage',  'Brokerage',    'The office'],
  ['tasks',      'Tasks',        'Everything on your plate'],
  ['addexpense', 'Add Expense',  'Straight to the form'],
];

const LINKS = [
  { group: 'Straight to a page', items: [
    { label: 'Add expense',    hint: 'Opens the transaction form',   url: '/?view=finance&sub=ledger' },
    { label: 'My numbers',     hint: 'GCI against goal',             url: '/?view=numbers' },
    { label: "Today's Hunt",   hint: 'Your prospecting for today',   url: '/?view=prospecting&sub=today' },
    { label: 'What Paid',      hint: 'Which systems returned money', url: '/?view=prospecting&sub=roi' },
    { label: 'Contacts',       hint: 'Your people',                  url: '/?view=contacts' },
    { label: 'Tasks',          hint: 'Everything on your plate',     url: '/?view=tasks' },
    { label: 'Calendar',       hint: 'Your week',                    url: '/?view=calendar' },
    { label: 'Inbox',          hint: 'Mail and replies you owe',     url: '/?view=inbox' },
    { label: 'Calls & Texts',  hint: 'The Quo line',                 url: '/?view=quo' },
    { label: 'Daily Journal',  hint: 'Write the day down',           url: '/?view=journal' },
    { label: 'My Drives',      hint: 'Mileage',                      url: '/?view=mileage' },
    { label: 'Ask Ari',        hint: 'Ask about your own data',      url: '/?view=chat' },
  ] },
];

export default function LaunchersView() {
  const [copied, setCopied] = useState(null);
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://darasapp.com';

  async function copy(url, key) {
    const full = origin + url;
    try {
      await navigator.clipboard.writeText(full);
    } catch (_) {
      // Clipboard is blocked in some in-app browsers; fall back to a selection
      // the user can copy by hand rather than failing silently.
      try {
        const ta = document.createElement('textarea');
        ta.value = full; document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); document.body.removeChild(ta);
      } catch (__) { return; }
    }
    setCopied(key);
    setTimeout(() => setCopied(c => (c === key ? null : c)), 1800);
  }

  return (
    <div style={{ padding: '2px 2px 20px' }}>
      <div style={{ fontFamily: "'Barlow Condensed',sans-serif", textTransform: 'uppercase',
        letterSpacing: '.14em', fontSize: 11, fontWeight: 700, color: 'var(--room-accent, var(--accent))' }}>
        Shortcuts
      </div>
      <h2 style={{ fontFamily: 'Fraunces, Georgia, serif', fontWeight: 300, fontSize: 30, margin: '4px 0 6px', display: 'flex', minWidth: 0 }}>
        <span style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>Launchers.</span>
      </h2>
      <div style={{ fontSize: 13, color: 'var(--text-3)', lineHeight: 1.5 }}>
        A link to every room and page. Put them on your home screen, or assign one to
        a phone-case button or an NFC tag.
      </div>
      <hr className="room-rule" />

      {/* THE ONE-TAP ROUTE. Each of these opens a page that carries its own
          manifest, so Chrome offers a single Add to Home Screen button and the
          icon that lands is named and coloured for that room. The handoff to
          Chrome is unavoidable — an installed app has no install machinery — but
          this is the whole of it: tap, tap, done. */}
      <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
        color: 'var(--room-accent-85, var(--text-3))', margin: '14px 0 8px' }}>
        Add an icon to your home screen
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 18 }}>
        {INSTALLABLE.map(([key, label, hint]) => (
          <a key={key} href={'/launch/' + key + '/'} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', gap: 9, textDecoration: 'none',
              border: '1px solid var(--border)', borderRadius: 11, padding: '10px 11px' }}>
            <img src={'/launch/' + key + '-192.png'} alt="" width="34" height="34"
              style={{ borderRadius: 9, flexShrink: 0 }} />
            <span style={{ minWidth: 0 }}>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-1)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
              <span style={{ display: 'block', fontSize: 10.5, color: 'var(--text-3)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hint}</span>
            </span>
          </a>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.55, marginBottom: 18 }}>
        Tap one, then <strong>Add to Home Screen</strong> on the page that opens. It has to
        open in Chrome for a moment — an installed app cannot install things — then you
        are back.
      </div>

      <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '13px 14px', margin: '12px 0 16px' }}>
        <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
          color: 'var(--text-3)', marginBottom: 8 }}>Any other page, or a case button</div>
        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-2)', lineHeight: 1.7 }}>
          <li>Tap <strong>Copy</strong> beside the one you want.</li>
          <li>Open Chrome and paste it into the address bar, then go.</li>
          <li>Chrome menu → <strong>Add to Home screen</strong>. Rename it there.</li>
        </ol>
        <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 9, lineHeight: 1.5 }}>
          For a case button or an NFC tag, paste the same link wherever it asks for a
          URL — nothing else is needed.
        </div>
      </div>

      {LINKS.map(section => (
        <div key={section.group} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase',
            color: 'var(--room-accent-85, var(--text-3))', marginBottom: 8 }}>{section.group}</div>
          {section.items.map(it => (
            <div key={it.url + it.label} style={{ display: 'flex', alignItems: 'center', gap: 10,
              border: '1px solid var(--border)', borderRadius: 11, padding: '11px 12px', marginBottom: 8 }}>
              <div style={{ flex: '1 1 0', minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-1)' }}>{it.label}</div>
                {it.hint && <div style={{ fontSize: 11.5, color: 'var(--text-3)', marginTop: 1 }}>{it.hint}</div>}
                <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 3, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'ui-monospace, monospace' }}>
                  {origin}{it.url}
                </div>
              </div>
              <button type="button" onClick={() => copy(it.url, it.url + it.label)}
                style={{ flexShrink: 0, fontSize: 12, fontWeight: 800, padding: '8px 14px', borderRadius: 9,
                  cursor: 'pointer', border: '1px solid var(--room-accent, var(--accent))',
                  background: copied === it.url + it.label ? 'var(--room-accent, var(--accent))' : 'transparent',
                  color: copied === it.url + it.label ? 'var(--bg-base)' : 'var(--room-accent, var(--accent))' }}>
                {copied === it.url + it.label ? 'Copied' : 'Copy'}
              </button>
            </div>
          ))}
        </div>
      ))}

      <div style={{ fontSize: 11.5, color: 'var(--text-3)', lineHeight: 1.55, marginTop: 6 }}>
        A shortcut opens PrismOS at that page — same login, same data. It is not a
        separate app, so there is nothing extra to install or keep updated.
      </div>
    </div>
  );
}
