import React, { useState, useEffect } from 'react';
import { supabase } from '../dataService';
import { Icon } from '../App';

const DISC_LETTERS = ['D', 'I', 'S', 'C'];

const DISC_NAMES = { D: 'Dominant', I: 'Influencing', S: 'Steady', C: 'Conscientious' };

const CONFIDENCE_LEVELS = ['high', 'medium', 'low', 'unknown'];

const PROFILE_SOURCES = ['manual', 'first_light', 'full_spectrum', 'prism_read', 'behavioral_signal'];


function PrismView({ profiles, setProfiles, voiceCards, setVoiceCards, contacts, userId }) {
  const [activeTab, setActiveTab] = useState('owner');

  const ownerProfile = profiles.find(p => p.subject_kind === 'owner') || null;
  const contactProfiles = profiles.filter(p => p.subject_kind === 'contact');
  const activeVoiceCard = voiceCards.find(v => v.is_active) || voiceCards[0] || null;

  return (
    <div>
      <div className="page-header">
        <h2 style={{display:'flex',alignItems:'center',gap:'10px'}}><Icon name="prism" size={26} style={{color:'var(--accent)',flexShrink:0}} />Prism</h2>
        <p>Behavioral foundation — DISC profiles and the platform voice that everything else builds on.</p>
      </div>

      <div className="panel">
        <div className="panel-header" style={{flexDirection:'column',alignItems:'stretch',gap:'10px'}}>
          <div style={{display:'flex',gap:'6px',flexWrap:'wrap'}}>
            <button className={`btn btn-sm ${activeTab==='owner'?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab('owner')}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="contacts" size={14} /> Owner Profile</span>
            </button>
            <button className={`btn btn-sm ${activeTab==='voice'?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab('voice')}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="mic" size={14} /> Voice Card</span>
            </button>
            <button className={`btn btn-sm ${activeTab==='contacts'?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab('contacts')}>
              <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}><Icon name="users" size={14} /> Contact Profiles</span> <span style={{marginLeft:'6px',opacity:0.7}}>({contactProfiles.length})</span>
            </button>
            <button className={`btn btn-sm ${activeTab==='validate'?'btn-primary':'btn-ghost'}`} onClick={()=>setActiveTab('validate')}>
              ✓ Validate
            </button>
          </div>
        </div>
        <div className="panel-body">
          {activeTab === 'owner' && (
            <OwnerProfilePanel
              profile={ownerProfile}
              setProfiles={setProfiles}
              userId={userId}
            />
          )}
          {activeTab === 'voice' && (
            <VoiceCardPanel
              card={activeVoiceCard}
              setVoiceCards={setVoiceCards}
              userId={userId}
            />
          )}
          {activeTab === 'contacts' && (
            <ContactProfilesPanel
              profiles={contactProfiles}
              contacts={contacts}
              setProfiles={setProfiles}
              userId={userId}
            />
          )}
          {activeTab === 'validate' && (
            <ValidatePanel
              ownerProfile={ownerProfile}
              voiceCard={activeVoiceCard}
            />
          )}
        </div>
      </div>
    </div>
  );
}


function DiscScoreInput({ label, value, onChange }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'4px',flex:1,minWidth:'80px'}}>
      <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>{label}</label>
      <input
        type="number"
        min="0"
        max="100"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
        style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
      />
    </div>
  );
}


function deriveLetters(d, i, s, c) {
  const arr = [['D', d], ['I', i], ['S', s], ['C', c]].filter(([, v]) => typeof v === 'number');
  if (arr.length === 0) return { primary: null, secondary: null };
  arr.sort((a, b) => b[1] - a[1]);
  return { primary: arr[0][0], secondary: arr[1]?.[0] ?? null };
}


function OwnerProfilePanel({ profile, setProfiles, userId }) {
  const [d, setD] = useState(profile?.d_score ?? null);
  const [i, setI] = useState(profile?.i_score ?? null);
  const [s, setS] = useState(profile?.s_score ?? null);
  const [c, setC] = useState(profile?.c_score ?? null);
  const [confidence, setConfidence] = useState(profile?.confidence || 'medium');
  const [source, setSource] = useState(profile?.source || 'manual');
  const [rationale, setRationale] = useState(profile?.rationale || '');
  const [primaryOverride, setPrimaryOverride] = useState(profile?.primary_letter || '');
  const [secondaryOverride, setSecondaryOverride] = useState(profile?.secondary_letter || '');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  // Recompute when profile from props changes (after save)
  useEffect(() => {
    if (!profile) return;
    setD(profile.d_score ?? null);
    setI(profile.i_score ?? null);
    setS(profile.s_score ?? null);
    setC(profile.c_score ?? null);
    setConfidence(profile.confidence || 'medium');
    setSource(profile.source || 'manual');
    setRationale(profile.rationale || '');
    setPrimaryOverride(profile.primary_letter || '');
    setSecondaryOverride(profile.secondary_letter || '');
  }, [profile?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const derived = deriveLetters(d, i, s, c);
  const primary = primaryOverride || derived.primary;
  const secondary = secondaryOverride || derived.secondary;

  async function handleSave() {
    setSaving(true);
    setMsg('');
    const payload = {
      d_score: d,
      i_score: i,
      s_score: s,
      c_score: c,
      primary_letter: primary,
      secondary_letter: secondary && secondary !== primary ? secondary : null,
      confidence,
      source,
      rationale: rationale || null,
      updated_at: new Date().toISOString(),
    };
    try {
      if (profile) {
        const { data, error } = await supabase
          .from('profiles')
          .update(payload)
          .eq('id', profile.id)
          .select()
          .single();
        if (error) throw error;
        setProfiles(prev => prev.map(p => p.id === data.id ? data : p));
      } else {
        const { data, error } = await supabase
          .from('profiles')
          .insert({ ...payload, user_id: userId, subject_kind: 'owner' })
          .select()
          .single();
        if (error) throw error;
        setProfiles(prev => [...prev, data]);
      }
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2500);
    } catch (err) {
      setMsg('Error: ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'18px',maxWidth:'720px'}}>
      <div>
        <h3 style={{margin:'0 0 4px',fontSize:'16px',color:'var(--text-1)'}}>Your DISC profile</h3>
        <p style={{margin:0,fontSize:'13px',color:'var(--text-2)'}}>
          This profile drives how every assistant speaks to you, and how every draft is shaped.
        </p>
      </div>

      <div style={{display:'flex',gap:'12px',flexWrap:'wrap'}}>
        <DiscScoreInput label="D — Dominant" value={d} onChange={setD} />
        <DiscScoreInput label="I — Influencing" value={i} onChange={setI} />
        <DiscScoreInput label="S — Steady" value={s} onChange={setS} />
        <DiscScoreInput label="C — Conscientious" value={c} onChange={setC} />
      </div>

      <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Primary (auto from scores)</label>
          <select
            value={primaryOverride || (derived.primary ?? '')}
            onChange={e => setPrimaryOverride(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            <option value="">(none)</option>
            {DISC_LETTERS.map(l => <option key={l} value={l}>{l} — {DISC_NAMES[l]}</option>)}
          </select>
        </div>
        <div style={{flex:1,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Secondary</label>
          <select
            value={secondaryOverride || (derived.secondary ?? '')}
            onChange={e => setSecondaryOverride(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            <option value="">(none)</option>
            {DISC_LETTERS.filter(l => l !== (primaryOverride || derived.primary)).map(l => <option key={l} value={l}>{l} — {DISC_NAMES[l]}</option>)}
          </select>
        </div>
      </div>

      <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
        <div style={{flex:1,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Confidence</label>
          <select
            value={confidence}
            onChange={e => setConfidence(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            {CONFIDENCE_LEVELS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{flex:1,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Source</label>
          <select
            value={source}
            onChange={e => setSource(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            {PROFILE_SOURCES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
          </select>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
        <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Notes / rationale</label>
        <textarea
          value={rationale}
          onChange={e => setRationale(e.target.value)}
          rows={5}
          placeholder="What's true about your behavioral style that the assistant should know — adaptive vs natural, work mode vs personal mode, communication preferences…"
          style={{padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px',fontFamily:'inherit',resize:'vertical'}}
        />
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save profile'}
        </button>
        {msg && <span style={{fontSize:'13px',color: msg.startsWith('Error') ? 'var(--red)' : 'var(--green)'}}>{msg}</span>}
      </div>

      {primary && (
        <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'4px',fontWeight:600}}>Current profile snapshot</div>
          <div style={{fontSize:'14px',color:'var(--text-1)'}}>
            <strong>{primary}{secondary && secondary !== primary ? `/${secondary}` : ''}</strong>
            {' · '}
            D:{d ?? '—'} I:{i ?? '—'} S:{s ?? '—'} C:{c ?? '—'}
            {' · '}
            <span style={{color:'var(--text-2)'}}>confidence: {confidence}</span>
          </div>
        </div>
      )}
    </div>
  );
}


function VoiceCardPanel({ card, setVoiceCards, userId }) {
  const [name, setName] = useState(card?.name || 'The Concierge');
  const [kind, setKind] = useState(card?.kind || 'platform');
  const [body, setBody] = useState(card?.body || '');
  const [isActive, setIsActive] = useState(card?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!card) return;
    setName(card.name || 'The Concierge');
    setKind(card.kind || 'platform');
    setBody(card.body || '');
    setIsActive(card.is_active ?? true);
  }, [card?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    setSaving(true);
    setMsg('');
    const payload = {
      name,
      kind,
      body,
      is_active: isActive,
      updated_at: new Date().toISOString(),
    };
    try {
      if (card) {
        const { data, error } = await supabase
          .from('voice_cards')
          .update(payload)
          .eq('id', card.id)
          .select()
          .single();
        if (error) throw error;
        setVoiceCards(prev => prev.map(v => v.id === data.id ? data : v));
      } else {
        const { data, error } = await supabase
          .from('voice_cards')
          .insert({ ...payload, user_id: userId })
          .select()
          .single();
        if (error) throw error;
        setVoiceCards(prev => [...prev, data]);
      }
      setMsg('Saved.');
      setTimeout(() => setMsg(''), 2500);
    } catch (err) {
      setMsg('Error: ' + (err.message || err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'18px',maxWidth:'900px'}}>
      <div>
        <h3 style={{margin:'0 0 4px',fontSize:'16px',color:'var(--text-1)'}}>The active voice card</h3>
        <p style={{margin:0,fontSize:'13px',color:'var(--text-2)'}}>
          This text is injected into every assistant prompt and drafting call. Edits take effect on the next message.
        </p>
      </div>

      <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
        <div style={{flex:2,minWidth:'200px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          />
        </div>
        <div style={{flex:1,minWidth:'150px',display:'flex',flexDirection:'column',gap:'4px'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>Kind</label>
          <select
            value={kind}
            onChange={e => setKind(e.target.value)}
            style={{padding:'8px 10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            <option value="platform">platform</option>
            <option value="agent">agent</option>
          </select>
        </div>
        <div style={{minWidth:'120px',display:'flex',flexDirection:'column',gap:'4px',justifyContent:'flex-end'}}>
          <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600,display:'flex',alignItems:'center',gap:'6px'}}>
            <input
              type="checkbox"
              checked={isActive}
              onChange={e => setIsActive(e.target.checked)}
              style={{margin:0}}
            />
            Active
          </label>
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:'4px'}}>
        <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600}}>
          Voice card body ({body.length.toLocaleString()} chars)
        </label>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={22}
          style={{padding:'12px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'13px',fontFamily:'ui-monospace, Menlo, Monaco, Consolas, monospace',lineHeight:1.55,resize:'vertical',whiteSpace:'pre-wrap'}}
        />
      </div>

      <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
        <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save voice card'}
        </button>
        {msg && <span style={{fontSize:'13px',color: msg.startsWith('Error') ? 'var(--red)' : 'var(--green)'}}>{msg}</span>}
      </div>
    </div>
  );
}


function ContactProfilesPanel({ profiles, contacts, setProfiles, userId }) {
  return (
    <div style={{display:'flex',flexDirection:'column',gap:'12px'}}>
      <p style={{margin:0,fontSize:'13px',color:'var(--text-2)'}}>
        Behavioral profiles inferred from public data or communications history. Confidence is always shown — these are best guesses, not facts.
      </p>
      {profiles.length === 0
        ? <div className="empty-state"><div className="empty-icon"><Icon name="users" size={28} /></div><p>No contact profiles yet. They'll appear here as Prism Read runs against your contacts.</p></div>
        : <div className="task-list">
            {profiles.map(p => {
              const contact = p.contact_id ? contacts.find(c => c.id === p.contact_id) : null;
              const name = contact?.name || contact?.full_name || `Profile ${p.id.slice(0, 8)}`;
              return (
                <div key={p.id} className="task-item" style={{flexDirection:'column',alignItems:'stretch',gap:'6px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'10px',width:'100%'}}>
                    <div style={{flex:1,fontWeight:600,color:'var(--text-1)'}}>{name}</div>
                    <div style={{display:'flex',gap:'6px',alignItems:'center'}}>
                      <span className="pill pill-purple">{p.primary_letter}{p.secondary_letter ? `/${p.secondary_letter}` : ''}</span>
                      <span style={{fontSize:'12px',color:'var(--text-2)'}}>conf: {p.confidence}</span>
                    </div>
                  </div>
                  <div style={{fontSize:'12px',color:'var(--text-2)'}}>
                    D:{p.d_score ?? '—'} · I:{p.i_score ?? '—'} · S:{p.s_score ?? '—'} · C:{p.c_score ?? '—'}
                    {p.source && <> · <span style={{color:'var(--text-3)'}}>{p.source.replace('_', ' ')}</span></>}
                  </div>
                  {p.rationale && <div style={{fontSize:'13px',color:'var(--text-2)',whiteSpace:'pre-wrap',lineHeight:1.5}}>{p.rationale}</div>}
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}


const SAMPLE_SCENARIOS = [
  {
    id: 'pushback',
    label: 'Someone pushing back on a key decision',
    prompt: "A client/colleague just messaged: 'I'm not sure about your recommendation — I want to go in a different direction.' Draft a reply that gives them a real answer, holds your ground where you should, and offers one clear next step.",
  },
  {
    id: 'coach_setback',
    label: 'Coaching someone through a real setback',
    prompt: "A teammate just lost something they worked hard on — a pitch, a project, a client. They sent: 'Lost it. I'm done.' Coach them. They need honesty, not a pep talk.",
  },
  {
    id: 'high_c_detail',
    label: 'Detail-oriented person dissecting your proposal',
    prompt: "A high-C (detail-oriented, data-driven) reviewer wants to challenge every line of your proposal — there are 14 minor items. Draft a message that respects their thoroughness and steers them to the 2-3 items that actually matter.",
  },
];


function ValidatePanel({ ownerProfile, voiceCard }) {
  const [selectedScenario, setSelectedScenario] = useState(SAMPLE_SCENARIOS[0].id);
  const [customPrompt, setCustomPrompt] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [output, setOutput] = useState('');
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');

  async function generate() {
    setGenerating(true);
    setOutput('');
    setMeta(null);
    setError('');
    const scenario = SAMPLE_SCENARIOS.find(s => s.id === selectedScenario);
    const prompt = useCustom && customPrompt.trim() ? customPrompt.trim() : scenario.prompt;

    try {
      // Get the active robot to call robot-chat
      const { data: robots } = await supabase
        .from('robots')
        .select('id')
        .eq('active', true)
        .limit(1);
      if (!robots || robots.length === 0) {
        setError('No active robot found. Add one in the database first.');
        setGenerating(false);
        return;
      }
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error: invokeError } = await supabase.functions.invoke('robot-chat', {
        body: {
          robot_id: robots[0].id,
          user_id: user?.id,
          message: prompt,
          history: [],
        },
      });
      if (invokeError) throw invokeError;
      if (data?.error) throw new Error(data.error);
      setOutput(data?.response || '(empty response)');
      setMeta(data?.meta || null);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:'18px',maxWidth:'820px'}}>
      <div>
        <h3 style={{margin:'0 0 4px',fontSize:'16px',color:'var(--text-1)'}}>Validate the voice</h3>
        <p style={{margin:0,fontSize:'13px',color:'var(--text-2)'}}>
          Generate a sample response and confirm it reads as The Concierge — warm, savvy, coach-like, professional. If it sounds generic or AI-flat, the voice card needs tightening.
        </p>
      </div>

      <div style={{padding:'12px 14px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'8px'}}>
        <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'4px',fontWeight:600}}>Current foundation</div>
        <div style={{fontSize:'13px',color:'var(--text-1)'}}>
          Voice card: <strong>{voiceCard?.name || '(none loaded)'}</strong>
          {voiceCard && <span style={{color:'var(--text-2)'}}> · {voiceCard.is_active ? 'active' : 'inactive'} · {voiceCard.body?.length || 0} chars</span>}
        </div>
        <div style={{fontSize:'13px',color:'var(--text-1)',marginTop:'4px'}}>
          Owner profile: <strong>{ownerProfile ? `${ownerProfile.primary_letter}${ownerProfile.secondary_letter ? '/' + ownerProfile.secondary_letter : ''}` : '(none loaded)'}</strong>
          {ownerProfile && <span style={{color:'var(--text-2)'}}> · confidence: {ownerProfile.confidence}</span>}
        </div>
      </div>

      <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
        <label style={{fontSize:'12px',color:'var(--text-2)',fontWeight:600,display:'flex',alignItems:'center',gap:'8px'}}>
          <input type="checkbox" checked={!useCustom} onChange={e => setUseCustom(!e.target.checked)} />
          Use a preset scenario
        </label>
        {!useCustom ? (
          <select
            value={selectedScenario}
            onChange={e => setSelectedScenario(e.target.value)}
            style={{padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px'}}
          >
            {SAMPLE_SCENARIOS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        ) : (
          <textarea
            value={customPrompt}
            onChange={e => setCustomPrompt(e.target.value)}
            rows={4}
            placeholder="Describe the situation you want the assistant to respond to…"
            style={{padding:'10px',background:'var(--bg-base)',border:'1px solid var(--border)',borderRadius:'6px',color:'var(--text-1)',fontSize:'14px',fontFamily:'inherit',resize:'vertical'}}
          />
        )}
      </div>

      <div>
        <button className="btn btn-primary" onClick={generate} disabled={generating}>
          {generating ? 'Generating…' : 'Generate sample'}
        </button>
      </div>

      {error && (
        <div style={{padding:'12px 14px',background:'rgba(239, 68, 68, 0.1)',border:'1px solid var(--red)',borderRadius:'8px',color:'var(--red)',fontSize:'13px'}}>
          {error}
        </div>
      )}

      {output && (
        <div style={{padding:'14px 16px',background:'var(--bg-base)',border:'1px solid var(--accent)',borderRadius:'8px'}}>
          <div style={{fontSize:'12px',color:'var(--text-2)',marginBottom:'8px',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.5px'}}>Sample output</div>
          <div style={{fontSize:'14px',color:'var(--text-1)',whiteSpace:'pre-wrap',lineHeight:1.6}}>{output}</div>
          {meta && (
            <div style={{marginTop:'12px',paddingTop:'10px',borderTop:'1px solid var(--border)',fontSize:'12px',color:'var(--text-3)'}}>
              Layers applied → voice: <strong style={{color:'var(--text-2)'}}>{meta.voice_card || 'none'}</strong>
              {' · '}
              owner: <strong style={{color:'var(--text-2)'}}>{meta.owner_primary || 'none'}</strong>
              {meta.owner_confidence && <> ({meta.owner_confidence})</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


export default PrismView;
