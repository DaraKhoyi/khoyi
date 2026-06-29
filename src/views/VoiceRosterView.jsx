import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';

export default function VoiceRosterView() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await supabase.rpc('voice_cards_roster');
        if (!alive) return;
        if (error) { setError(error.message || 'Could not load'); setRows([]); return; }
        setRows(data || []);
      } catch (e) { if (alive) { setError(String(e.message || e)); setRows([]); } }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="vr">
      <VrStyles />
      <div className="vr-wrap">
        <div className="vr-head">
          <h1>Agent voice cards</h1>
          <p>Each agent's personal voice — the layer that rides on top of The Concierge in their drafts.</p>
        </div>

        {rows === null && <div className="vr-loading"><div className="vr-spin" /><span>Loading…</span></div>}
        {rows && error && rows.length === 0 && <div className="vr-empty">{/not authorized/i.test(error) ? 'This view is for brokerage owners and admins.' : `Couldn't load: ${error}`}</div>}
        {rows && !error && rows.length === 0 && <div className="vr-empty">No agents have built a personal voice yet. Once they complete MyVoice in Get started, their cards appear here.</div>}

        {rows && rows.length > 0 && (
          <div className="vr-list">
            {rows.map(r => {
              const open = openId === r.user_id;
              return (
                <div key={r.user_id} className={`vr-card ${open ? 'open' : ''}`}>
                  <button className="vr-row" onClick={() => setOpenId(open ? null : r.user_id)}>
                    <div className="vr-row-main">
                      <div className="vr-name">{r.agent_name || 'Agent'}{r.team ? <span className="vr-team">{r.team}</span> : null}{r.is_active ? <span className="vr-dot" title="Active">●</span> : <span className="vr-dot off" title="Not active">○</span>}</div>
                      {r.persona_summary && <div className="vr-persona">“{r.persona_summary}”</div>}
                    </div>
                    <span className={`vr-chev ${open ? 'up' : ''}`}>⌄</span>
                  </button>
                  {open && (
                    <div className="vr-detail">
                      {r.body && <div className="vr-block"><div className="vr-block-h">The voice</div>{String(r.body).split('\n\n').map((p, i) => <p className="vr-prose" key={i}>{p}</p>)}</div>}
                      {(r.do_examples?.length || r.dont_examples?.length) ? (
                        <div className="vr-cols">
                          {r.do_examples?.length ? <div className="vr-block"><div className="vr-block-h" style={{ color:'#5EC78C' }}>Do</div>{r.do_examples.map((d, i) => <div className="vr-li" key={i}>{d}</div>)}</div> : null}
                          {r.dont_examples?.length ? <div className="vr-block"><div className="vr-block-h" style={{ color:'#C75E5E' }}>Don't</div>{r.dont_examples.map((d, i) => <div className="vr-li" key={i}>{d}</div>)}</div> : null}
                        </div>
                      ) : null}
                      {r.updated_at && <div className="vr-updated">Updated {new Date(r.updated_at).toLocaleDateString()}</div>}
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

function VrStyles() {
  return <style>{`
  .vr { height:100%; overflow-y:auto; -webkit-overflow-scrolling:touch; }
  .vr-wrap { max-width:760px; margin:0 auto; padding:18px 16px 96px; }
  .vr-head h1 { font-size:26px; font-weight:700; color:var(--text-1); margin-bottom:6px; }
  .vr-head p { font-size:14px; line-height:1.5; color:var(--text-2); margin-bottom:22px; }
  .vr-loading { display:flex; align-items:center; gap:12px; color:var(--text-2); padding:40px 0; justify-content:center; }
  .vr-spin { width:24px; height:24px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:vrspin .8s linear infinite; }
  @keyframes vrspin { to { transform:rotate(360deg); } }
  .vr-empty { background:var(--bg-card); border:1px solid var(--border); border-radius:14px; padding:24px; color:var(--text-2); font-size:14px; line-height:1.5; text-align:center; }
  .vr-list { display:flex; flex-direction:column; gap:12px; }
  .vr-card { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; overflow:hidden; }
  .vr-card.open { border-color:var(--accent); }
  .vr-row { width:100%; display:flex; align-items:flex-start; justify-content:space-between; gap:12px; background:transparent; border:none; cursor:pointer; padding:16px; text-align:left; }
  .vr-row-main { min-width:0; flex:1; }
  .vr-name { font-size:16px; font-weight:700; color:var(--text-1); display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .vr-team { font-size:11px; font-weight:600; color:var(--text-3); background:var(--bg-base); border:1px solid var(--border); border-radius:20px; padding:2px 9px; }
  .vr-dot { font-size:10px; color:#5EC78C; } .vr-dot.off { color:var(--text-3); }
  .vr-persona { font-size:14px; font-style:italic; color:var(--accent); line-height:1.5; margin-top:8px; }
  .vr-chev { color:var(--text-3); font-size:18px; transition:transform .2s; line-height:1; flex-shrink:0; }
  .vr-chev.up { transform:rotate(180deg); color:var(--accent); }
  .vr-detail { padding:0 16px 16px; border-top:1px solid var(--border); }
  .vr-block { margin-top:16px; }
  .vr-block-h { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--text-3); font-weight:700; margin-bottom:10px; }
  .vr-prose { font-size:14px; line-height:1.6; color:var(--text-2); margin-bottom:10px; } .vr-prose:last-child { margin-bottom:0; }
  .vr-cols { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:16px; } @media (max-width:560px){ .vr-cols { grid-template-columns:1fr; } }
  .vr-li { font-size:13px; line-height:1.5; color:var(--text-2); padding:6px 0; border-bottom:1px solid var(--border); } .vr-li:last-child { border-bottom:none; }
  .vr-updated { font-size:12px; color:var(--text-3); margin-top:16px; }
  `}</style>;
}
