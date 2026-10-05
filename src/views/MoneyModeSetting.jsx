// MoneyModeSetting — who the Money screens are set up for: Agent, Partner or Coach.
//
// This switch used to sit on top of every Money screen, where it was three
// buttons nobody presses day to day and one tap away from turning the whole
// room read-only. Dara, 5 Oct 2026: "Move the Agent, Partner and Coach views to
// the setup screen in an appropriate location." It is a setting; it lives here.
import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { notifyError } from '../notify';

const MODES = [
  ['agent', 'Agent', 'Your full workspace. Enter, edit and plan.'],
  ['partner', 'Partner', 'Look only. For a spouse or accountability partner reviewing with you: nothing can be changed.'],
  ['coach', 'Coach', 'For working with a coach: the limit on lead sources is lifted and reports show extra detail.'],
];

export default function MoneyModeSetting({ userId }) {
  const [mode, setMode] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let off = false;
    (async () => {
      const { data, error } = await supabase.from('finance_settings').select('user_mode').eq('user_id', userId).maybeSingle();
      if (off) return;
      if (error) { notifyError('Money view did not load: ' + error.message); return; }
      setMode((data && data.user_mode) || 'agent');
    })();
    return () => { off = true; };
  }, [userId]);

  async function choose(next) {
    if (next === mode || saving) return;
    setSaving(true);
    const { error } = await supabase.from('finance_settings').upsert({ user_id: userId, user_mode: next }, { onConflict: 'user_id' });
    setSaving(false);
    if (error) { notifyError('That did not save: ' + error.message); return; }
    setMode(next);
  }

  if (mode == null) return null;
  return (
    <div className="panel" style={{marginBottom:'18px'}} data-testid="money-mode-setting">
      <div className="panel-header"><h3>Money view</h3></div>
      <div className="panel-body">
        <p style={{fontSize:'13px',color:'var(--text-2)',margin:'0 0 14px',lineHeight:1.5}}>Who the Money screens are set up for. Most people leave this on Agent.</p>
        <div role="radiogroup" aria-label="Money view" style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {MODES.map(([id, label, what]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} disabled={saving} onClick={() => choose(id)} data-testid={'money-mode-' + id}
              style={{display:'flex',alignItems:'center',gap:'12px',width:'100%',minHeight:'56px',textAlign:'left',padding:'10px 12px',borderRadius:'10px',cursor:'pointer',fontFamily:'inherit',
                background: mode === id ? 'var(--accent-glow)' : 'var(--bg-base)', border: mode === id ? '1px solid var(--accent)' : '1px solid var(--border)', color:'var(--text-1)'}}>
              <span aria-hidden="true" style={{flex:'none',width:'18px',height:'18px',borderRadius:'50%',border:'2px solid var(--accent)',background: mode === id ? 'var(--accent)' : 'transparent',boxShadow: mode === id ? 'inset 0 0 0 3px var(--bg-base)' : 'none'}} />
              <span style={{minWidth:0}}>
                <span style={{display:'block',fontSize:'14px',fontWeight:700}}>{label}</span>
                <span style={{display:'block',fontSize:'12.5px',color:'var(--text-2)',lineHeight:1.45,marginTop:'2px'}}>{what}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
