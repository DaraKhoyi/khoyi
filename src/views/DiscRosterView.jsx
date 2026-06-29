import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';

const LETTER_NAME = { D:'Dominance', I:'Influence', S:'Steadiness', C:'Conscientiousness' };
const DIM_NAME = { E:'Endurance', R:'Recovery', D:'Discipline', F:'Focus' };

function discDrift(adaptive, natural) {
  if (!adaptive || !natural) return 0;
  return Math.max(...['D','I','S','C'].map(k => Math.abs((adaptive[k] ?? 0) - (natural[k] ?? 0))));
}

export default function DiscRosterView() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('disc_assessments_roster');
        if (!alive) return;
        if (error) { setError(error.message || 'Could not load'); setRows([]); return; }
        setRows(data || []);
      } catch (e) { if (alive) { setError(String(e.message || e)); setRows([]); } }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="discr">
      <DiscrStyles />
      <div className="discr-wrap">
        <div className="discr-head">
          <h1>Agent DISC &amp; Grit</h1>
          <p>Every agent's latest Full Spectrum readout — Style, Drive, and the coaching priorities Prism flagged.</p>
        </div>

        {rows === null && <div className="discr-loading"><div className="discr-spin" /><span>Loading roster…</span></div>}

        {rows && error && rows.length === 0 && (
          <div className="discr-empty">{/not authorized/i.test(error) ? 'This view is for brokerage owners and admins.' : `Couldn't load the roster: ${error}`}</div>
        )}

        {rows && !error && rows.length === 0 && (
          <div className="discr-empty">No agents have completed the DISC / Grit assessment yet. Once they take it in Get started, their readouts appear here.</div>
        )}

        {rows && rows.length > 0 && (
          <div className="discr-list">
            {rows.map(r => {
              const a = r.adaptive || {}; const n = r.natural_scores || {};
              const drift = discDrift(a, n);
              const flag = r.validity?.flag || null;
              const open = openId === r.user_id;
              const overall = r.drive?.overall;
              const subs = r.drive?.sub || {};
              const lowest = Object.entries(subs).sort((x, y) => x[1] - y[1])[0];
              return (
                <div key={r.user_id} className={`discr-card ${open ? 'open' : ''}`}>
                  <button className="discr-row" onClick={() => setOpenId(open ? null : r.user_id)}>
                    <div className="discr-row-main">
                      <div className="discr-name">{r.agent_name || 'Agent'}{r.team ? <span className="discr-team">{r.team}</span> : null}</div>
                      <div className="discr-tags">
                        <span className="discr-tag gold">{r.style_label || '—'}</span>
                        {typeof overall === 'number' && <span className="discr-tag">Drive {overall}</span>}
                        {flag && flag.type !== 'aligned' && <span className={`discr-tag ${flag.type === 'stress' ? 'red' : 'amber'}`}>⚠ {flag.type}</span>}
                        {drift >= 15 && (!flag || flag.type === 'aligned') && <span className="discr-tag amber">{drift}-pt gap</span>}
                      </div>
                    </div>
                    <div className="discr-row-right">
                      <span className="discr-date">{r.taken_at ? new Date(r.taken_at).toLocaleDateString() : ''}</span>
                      <span className={`discr-chev ${open ? 'up' : ''}`}>⌄</span>
                    </div>
                  </button>

                  {open && (
                    <div className="discr-detail">
                      <div className="discr-cols">
                        <div className="discr-block">
                          <div className="discr-block-h">Style — DISC <span>natural · adaptive</span></div>
                          {['D','I','S','C'].map(L => (
                            <div className="discr-bar" key={L}>
                              <div className="discr-bar-top"><span>{L} · {LETTER_NAME[L]}</span><span className="discr-num">{a[L] ?? '—'}<i> / {n[L] ?? '—'}</i></span></div>
                              <div className="discr-track"><div className="discr-fill nat" style={{ width: `${n[L] ?? 0}%` }} /></div>
                              <div className="discr-track"><div className="discr-fill adapt" style={{ width: `${a[L] ?? 0}%` }} /></div>
                            </div>
                          ))}
                        </div>
                        <div className="discr-block">
                          <div className="discr-block-h">Drive — Grit <span>{overall}/100</span></div>
                          {['E','R','D','F'].map(k => (
                            <div className="discr-bar" key={k}>
                              <div className="discr-bar-top"><span>{DIM_NAME[k]}{lowest && lowest[0] === k ? <i className="discr-low"> · weak spot</i> : null}</span><span className="discr-num">{subs[k] ?? '—'}</span></div>
                              <div className="discr-track"><div className="discr-fill drive" style={{ width: `${subs[k] ?? 0}%` }} /></div>
                            </div>
                          ))}
                          {r.drive?.distortionHits >= 3 && <div className="discr-distort">Self-awareness answers came back unusually flawless ({r.drive.distortionHits}/4) — read Drive as a floor.</div>}
                        </div>
                      </div>

                      {flag && (
                        <div className={`discr-flag ${flag.type}`}>
                          <strong>{flag.type === 'aligned' ? '✓ ' : '⚠ '}{flag.headline}</strong>
                          <p>{flag.detail}</p>
                        </div>
                      )}

                      {r.readout && (
                        <div className="discr-prose-block">
                          <div className="discr-block-h">The read</div>
                          {String(r.readout).split('\n\n').map((p, i) => <p key={i} className="discr-prose">{p}</p>)}
                        </div>
                      )}

                      {r.coaching && (
                        <div className="discr-prose-block">
                          <div className="discr-block-h">Coaching priorities</div>
                          {String(r.coaching).split('\n\n').map((blk, i) => {
                            const lines = blk.split('\n');
                            return <div className="discr-coach" key={i}><div className="discr-coach-h">{lines[0]}</div><p className="discr-prose">{lines.slice(1).join(' ')}</p></div>;
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function DiscrStyles() {
  return <style>{`
  .discr { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; }
  .discr-wrap { max-width:760px; margin:0 auto; padding:18px 16px 96px; }
  .discr-head h1 { font-size:26px; font-weight:700; color:var(--text-1); margin-bottom:6px; }
  .discr-head p { font-size:14px; line-height:1.5; color:var(--text-2); margin-bottom:22px; }
  .discr-loading { display:flex; align-items:center; gap:12px; color:var(--text-2); padding:40px 0; justify-content:center; }
  .discr-spin { width:24px; height:24px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:discrspin .8s linear infinite; }
  @keyframes discrspin { to { transform:rotate(360deg); } }
  .discr-empty { background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:24px; color:var(--text-2); font-size:14px; line-height:1.5; text-align:center; }
  .discr-list { display:flex; flex-direction:column; gap:12px; }
  .discr-card { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; overflow:hidden; }
  .discr-card.open { border-color:var(--accent); }
  .discr-row { width:100%; display:flex; align-items:center; justify-content:space-between; gap:12px; background:transparent; border:none; cursor:pointer; padding:16px; text-align:left; }
  .discr-row-main { min-width:0; flex:1; }
  .discr-name { font-size:16px; font-weight:700; color:var(--text-1); display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .discr-team { font-size:11px; font-weight:600; color:var(--text-3); background:var(--bg-base); border:1px solid var(--border); border-radius:20px; padding:2px 9px; }
  .discr-tags { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .discr-tag { font-size:11px; font-weight:600; color:var(--text-2); background:var(--bg-base); border:1px solid var(--border); border-radius:20px; padding:3px 10px; white-space:nowrap; }
  .discr-tag.gold { color:var(--accent); border-color:var(--accent); }
  .discr-tag.red { color:#C75E5E; border-color:#C75E5E; }
  .discr-tag.amber { color:var(--accent); border-color:var(--accent); }
  .discr-row-right { display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex-shrink:0; }
  .discr-date { font-size:11px; color:var(--text-3); white-space:nowrap; }
  .discr-chev { color:var(--text-3); font-size:18px; transition:transform .2s; line-height:1; }
  .discr-chev.up { transform:rotate(180deg); color:var(--accent); }
  .discr-detail { padding:0 16px 16px; border-top:1px solid var(--border); }
  .discr-cols { display:grid; grid-template-columns:1fr 1fr; gap:18px; margin-top:16px; }
  @media (max-width:560px){ .discr-cols { grid-template-columns:1fr; } }
  .discr-block-h { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--text-3); font-weight:700; margin-bottom:12px; display:flex; justify-content:space-between; align-items:baseline; }
  .discr-block-h span { color:var(--text-3); font-weight:500; text-transform:none; letter-spacing:0.02em; }
  .discr-bar { margin-bottom:12px; } .discr-bar:last-child { margin-bottom:0; }
  .discr-bar-top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:5px; font-size:12px; color:var(--text-2); font-weight:600; }
  .discr-low { color:#C75E5E; font-style:normal; font-weight:600; }
  .discr-num { color:var(--accent); font-weight:700; font-variant-numeric:tabular-nums; }
  .discr-num i { color:var(--text-3); font-weight:500; font-style:normal; }
  .discr-track { height:5px; background:var(--bg-base); border-radius:3px; overflow:hidden; margin-bottom:3px; }
  .discr-fill { height:100%; border-radius:3px; }
  .discr-fill.adapt, .discr-fill.drive { background:linear-gradient(90deg,#9A8344,#D4BC75); }
  .discr-fill.nat { background:var(--text-3); opacity:0.55; }
  .discr-distort { margin-top:8px; font-size:11px; line-height:1.5; color:#C75E5E; }
  .discr-flag { border-radius:12px; padding:14px; margin-top:16px; border:1px solid; }
  .discr-flag.stress { background:rgba(199,94,94,0.10); border-color:#C75E5E; }
  .discr-flag.coaching { background:rgba(197,169,94,0.10); border-color:var(--accent); }
  .discr-flag.aligned { background:rgba(94,199,140,0.10); border-color:#5EC78C; }
  .discr-flag strong { display:block; font-size:13px; color:var(--text-1); margin-bottom:5px; }
  .discr-flag p { font-size:13px; line-height:1.5; color:var(--text-2); }
  .discr-prose-block { margin-top:18px; }
  .discr-prose { font-size:14px; line-height:1.6; color:var(--text-2); margin-bottom:10px; } .discr-prose:last-child { margin-bottom:0; }
  .discr-coach { margin-bottom:12px; } .discr-coach:last-child { margin-bottom:0; }
  .discr-coach-h { font-size:13px; font-weight:700; color:var(--accent); margin-bottom:4px; }
  `}</style>;
}
