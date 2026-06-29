import React, { useState, useEffect, useRef } from 'react';
import { Icon } from '../App';
import { supabase } from '../dataService';

const CALIBRATION_LINES = [
  'Hi Maria — following up on the three homes we saw Saturday.',
  'The Oak Street place is still the strongest fit on paper, but the layout gave you pause, and that matters.',
  'Two similar listings just came on that solve the layout issue.',
  'Want me to send them over tonight, or hold them for our call Tuesday?',
  "Either way, you're in a good spot — no need to rush this.",
];
const REWRITE_TARGET = CALIBRATION_LINES[3];

const SLIDERS = [
  { key: 'conciseDetailed', left: 'Concise', right: 'Detailed' },
  { key: 'warmMatter', left: 'Warm', right: 'Matter-of-fact' },
  { key: 'playfulSerious', left: 'Playful', right: 'Serious' },
  { key: 'directDiplomatic', left: 'Direct', right: 'Diplomatic' },
];

export default function MyVoiceView({ userId, user, voiceCards, setVoiceCards }) {
  const seedName = (user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? user.email.split('@')[0] : '') || '').replace(/\b\w/g, c => c.toUpperCase());
  const [phase, setPhase] = useState('loading'); // loading|intro|samples|questions|calibration|synth|review|saving
  const [name, setName] = useState(seedName);
  const [samples, setSamples] = useState(['', '', '']);
  const [answers, setAnswers] = useState({ opener:'', signoff:'', emoji:'rarely', punctuation:'', tells:'', banned:'', analogies:'', sliders:{ conciseDetailed:50, warmMatter:40, playfulSerious:50, directDiplomatic:50 }, humor:'warm', badNews:'cushion', why:'', feel:'', nonnegotiables:'', audience:'', region:'', languages:'' });
  const [calibration, setCalibration] = useState({ flagged: [], rewriteBefore: REWRITE_TARGET, rewriteAfter: '' });
  const [card, setCard] = useState(null);
  const [testDraft, setTestDraft] = useState('');
  const [testing, setTesting] = useState(false);
  const [existing, setExisting] = useState(null);
  const [err, setErr] = useState('');
  const scrollRef = useRef(null);
  const scrollTop = () => { try { scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_e) {} };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('voice_cards').select('*').eq('user_id', userId).eq('kind', 'agent').order('updated_at', { ascending: false }).limit(1);
        if (!alive) return;
        if (data && data[0]) { setExisting(data[0]); setCard({ body: data[0].body, persona_summary: data[0].persona_summary, do_examples: data[0].do_examples || [], dont_examples: data[0].dont_examples || [] }); setPhase('review'); }
        else setPhase('intro');
      } catch (_e) { if (alive) setPhase('intro'); }
    })();
    return () => { alive = false; };
  }, [userId]);

  const setA = (k, v) => setAnswers(p => ({ ...p, [k]: v }));
  const setSlider = (k, v) => setAnswers(p => ({ ...p, sliders: { ...p.sliders, [k]: Number(v) } }));
  const toggleFlag = (line) => setCalibration(p => ({ ...p, flagged: p.flagged.includes(line) ? p.flagged.filter(l => l !== line) : [...p.flagged, line] }));
  const sampleCount = samples.filter(s => s.trim()).length;

  async function synthesize() {
    setPhase('synth'); setErr(''); scrollTop();
    try {
      const { data, error } = await supabase.functions.invoke('myvoice-synthesize', { body: { mode: 'card', name, samples, answers, calibration } });
      if (error || !data || !data.body) throw new Error(error?.message || 'Synthesis failed');
      setCard(data);
      setPhase('review'); scrollTop();
      runTest(data.body);
    } catch (e) { setErr(String(e.message || e)); setPhase('calibration'); }
  }

  async function runTest(bodyText) {
    setTesting(true); setTestDraft('');
    try {
      const { data } = await supabase.functions.invoke('myvoice-synthesize', { body: { mode: 'test', cardBody: bodyText || card?.body || '' } });
      if (data?.draft) setTestDraft(data.draft);
    } catch (_e) {} finally { setTesting(false); }
  }

  async function activate() {
    if (!card) return;
    setPhase('saving');
    const payload = {
      name: `${name || 'My'} — Personal voice`, kind: 'agent', is_active: true,
      body: card.body, persona_summary: card.persona_summary || null,
      do_examples: card.do_examples || [], dont_examples: card.dont_examples || [],
      intake: { samples: samples.filter(s => s.trim()), answers, calibration }, updated_at: new Date().toISOString(),
    };
    try {
      let row = null;
      if (existing) { const { data } = await supabase.from('voice_cards').update(payload).eq('id', existing.id).select().single(); row = data; }
      else { const { data } = await supabase.from('voice_cards').insert({ ...payload, user_id: userId }).select().single(); row = data; }
      if (row) { setExisting(row); if (setVoiceCards) setVoiceCards(prev => { const others = (prev || []).filter(x => x.id !== row.id); return [...others, row]; }); }
      setPhase('review');
    } catch (e) { setErr(String(e.message || e)); setPhase('review'); }
  }

  function startOver() { setExisting(null); setCard(null); setTestDraft(''); setSamples(['', '', '']); setCalibration({ flagged: [], rewriteBefore: REWRITE_TARGET, rewriteAfter: '' }); setPhase('intro'); scrollTop(); }

  return (
    <div className="mv" ref={scrollRef}>
      <MvStyles />
      <div className="mv-wrap">
        <div className="mv-brand"><span className="mv-mark">MY VOICE <span>· rides on The Concierge</span></span></div>

        {phase === 'loading' && <div className="mv-load"><div className="mv-spin" /><span>Loading…</span></div>}

        {phase === 'intro' && (
          <div className="mv-intro">
            <div className="mv-eyebrow">Your personal voice</div>
            <h1>Make every Prism draft sound like <em>you</em>.</h1>
            <p className="mv-lead">The app already writes with a warm, sharp house voice (The Concierge). This adds <strong>your</strong> layer on top — your rhythm, your phrases, your sign-off. The most powerful input is real messages you've actually sent, so we start there. About 8 minutes.</p>
            <div className="mv-field"><label>Your name</label><input value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" /></div>
            <button className="mv-btn" disabled={!name.trim()} onClick={() => { setPhase('samples'); scrollTop(); }}>Start <span className="mv-arrow">→</span></button>
          </div>
        )}

        {phase === 'samples' && (
          <div className="mv-step">
            <div className="mv-step-h"><div className="mv-eyebrow">Step 1 · The real thing</div><h2>Show me your voice.</h2><p>Paste 2–3 real messages you've sent a client that felt like you — texts or emails. Wins, bad news, a quick follow-up. The messier and more real, the better. This teaches Prism more than any question.</p></div>
            {samples.map((s, i) => (
              <div className="mv-field" key={i}>
                <label>Message {i + 1}{i === 0 ? ' (required)' : ' (optional)'}</label>
                <textarea rows={4} value={s} onChange={e => setSamples(prev => prev.map((x, j) => j === i ? e.target.value : x))} placeholder={i === 0 ? 'Paste a real message here…' : 'Another one — a different mood if you can'} />
              </div>
            ))}
            <div className="mv-nav"><button className="mv-btn2" onClick={() => { setPhase('intro'); scrollTop(); }}>← Back</button><button className="mv-btn" disabled={sampleCount < 1} onClick={() => { setPhase('questions'); scrollTop(); }}>Next <span className="mv-arrow">→</span></button></div>
          </div>
        )}

        {phase === 'questions' && (
          <div className="mv-step">
            <div className="mv-step-h"><div className="mv-eyebrow">Step 2 · The details samples miss</div><h2>A few specifics.</h2><p>Short answers are perfect. Skip anything that doesn't apply.</p></div>

            <div className="mv-group">Signature mechanics</div>
            <div className="mv-field"><label>How you open a first message</label><input value={answers.opener} onChange={e => setA('opener', e.target.value)} placeholder="e.g. Hey [name]!" /></div>
            <div className="mv-field"><label>How you sign off</label><input value={answers.signoff} onChange={e => setA('signoff', e.target.value)} placeholder="your actual sign-off" /></div>
            <div className="mv-field"><label>Emoji</label><div className="mv-chips">{['never','rarely','part of how I talk'].map(o => <button key={o} className={`mv-chip ${answers.emoji === o ? 'on' : ''}`} onClick={() => setA('emoji', o)}>{o}</button>)}</div></div>
            <div className="mv-field"><label>Punctuation that's "you"</label><input value={answers.punctuation} onChange={e => setA('punctuation', e.target.value)} placeholder="em-dashes, ellipses, the occasional !" /></div>

            <div className="mv-group">Your lexicon</div>
            <div className="mv-field"><label>Words or phrases you say a lot (your tells)</label><input value={answers.tells} onChange={e => setA('tells', e.target.value)} placeholder="3–5, comma separated" /></div>
            <div className="mv-field"><label>Words/phrases you'd never use</label><input value={answers.banned} onChange={e => setA('banned', e.target.value)} placeholder="your banned list" /></div>
            <div className="mv-field"><label>Analogies — where from?</label><input value={answers.analogies} onChange={e => setA('analogies', e.target.value)} placeholder="sports, food, family, numbers, none" /></div>

            <div className="mv-group">Temperament</div>
            {SLIDERS.map(s => (
              <div className="mv-slider" key={s.key}>
                <div className="mv-slider-top"><span>{s.left}</span><span>{s.right}</span></div>
                <input type="range" min="0" max="100" value={answers.sliders[s.key]} onChange={e => setSlider(s.key, e.target.value)} />
              </div>
            ))}
            <div className="mv-field"><label>Humor</label><div className="mv-chips">{['none','dry','warm','playful'].map(o => <button key={o} className={`mv-chip ${answers.humor === o ? 'on' : ''}`} onClick={() => setA('humor', o)}>{o}</button>)}</div></div>
            <div className="mv-field"><label>Hard news</label><div className="mv-chips">{[['bandaid','Rip the bandaid'],['cushion','Cushion the landing']].map(([v, l]) => <button key={v} className={`mv-chip ${answers.badNews === v ? 'on' : ''}`} onClick={() => setA('badNews', v)}>{l}</button>)}</div></div>

            <div className="mv-group">What you stand for</div>
            <div className="mv-field"><label>Why do you do this work?</label><textarea rows={2} value={answers.why} onChange={e => setA('why', e.target.value)} placeholder="a line or two" /></div>
            <div className="mv-field"><label>What should a client feel after reading you?</label><input value={answers.feel} onChange={e => setA('feel', e.target.value)} /></div>
            <div className="mv-field"><label>What will you push back on? (non-negotiables)</label><input value={answers.nonnegotiables} onChange={e => setA('nonnegotiables', e.target.value)} /></div>

            <div className="mv-group">Who you talk to</div>
            <div className="mv-field"><label>Typical client</label><input value={answers.audience} onChange={e => setA('audience', e.target.value)} placeholder="first-timers, luxury, investors, relocations…" /></div>
            <div className="mv-field"><label>Market / region flavor</label><input value={answers.region} onChange={e => setA('region', e.target.value)} /></div>
            <div className="mv-field"><label>Other languages you write clients in</label><input value={answers.languages} onChange={e => setA('languages', e.target.value)} /></div>

            <div className="mv-nav"><button className="mv-btn2" onClick={() => { setPhase('samples'); scrollTop(); }}>← Back</button><button className="mv-btn" onClick={() => { setPhase('calibration'); scrollTop(); }}>Next <span className="mv-arrow">→</span></button></div>
          </div>
        )}

        {phase === 'calibration' && (
          <div className="mv-step">
            <div className="mv-step-h"><div className="mv-eyebrow">Step 3 · The calibration</div><h2>React, don't describe.</h2><p>Here's a follow-up written in the house voice. Tap any line that feels <strong>not you</strong> — then rewrite one line the way you'd actually say it. This single step teaches Prism more than everything above.</p></div>
            <div className="mv-draft">
              {CALIBRATION_LINES.map((line, i) => (
                <button key={i} className={`mv-line ${calibration.flagged.includes(line) ? 'flagged' : ''}`} onClick={() => toggleFlag(line)}>{line}{calibration.flagged.includes(line) ? <span className="mv-line-x">not me ✕</span> : null}</button>
              ))}
            </div>
            <div className="mv-field">
              <label>Now rewrite this line in your words</label>
              <div className="mv-before">“{REWRITE_TARGET}”</div>
              <textarea rows={2} value={calibration.rewriteAfter} onChange={e => setCalibration(p => ({ ...p, rewriteAfter: e.target.value }))} placeholder="The way you'd actually say it…" />
            </div>
            {err && <div className="mv-err">{err}</div>}
            <div className="mv-nav"><button className="mv-btn2" onClick={() => { setPhase('questions'); scrollTop(); }}>← Back</button><button className="mv-btn" onClick={synthesize}>Build my voice <span className="mv-arrow">→</span></button></div>
          </div>
        )}

        {phase === 'synth' && <div className="mv-load"><div className="mv-spin" /><span>Reading your samples and writing your voice card…</span></div>}
        {phase === 'saving' && <div className="mv-load"><div className="mv-spin" /><span>Activating…</span></div>}

        {phase === 'review' && card && (
          <div className="mv-review">
            <div className="mv-eyebrow">{existing ? 'Your active voice' : 'Your voice card — review &amp; edit'}</div>
            <h2 className="mv-h2">{name || 'My'} — Personal voice {existing?.is_active ? <span className="mv-active">● active</span> : null}</h2>
            {card.persona_summary && <div className="mv-persona">“{card.persona_summary}”</div>}

            <div className="mv-card">
              <div className="mv-card-h">The voice <span>edit anything — it's yours</span></div>
              <textarea className="mv-cardbody" rows={12} value={card.body} onChange={e => setCard(c => ({ ...c, body: e.target.value }))} />
            </div>

            {(card.do_examples?.length > 0 || card.dont_examples?.length > 0) && (
              <div className="mv-cols">
                <div className="mv-card"><div className="mv-card-h" style={{ color: '#5EC78C' }}>Do</div>{(card.do_examples || []).map((d, i) => <div className="mv-li" key={i}>{d}</div>)}</div>
                <div className="mv-card"><div className="mv-card-h" style={{ color: '#C75E5E' }}>Don't</div>{(card.dont_examples || []).map((d, i) => <div className="mv-li" key={i}>{d}</div>)}</div>
              </div>
            )}

            <div className="mv-card mv-test">
              <div className="mv-card-h">Live test <span>The Concierge + your voice</span></div>
              {testing ? <div className="mv-testing"><div className="mv-spin sm" /> Writing a sample in your voice…</div>
                : testDraft ? <p className="mv-testdraft">{testDraft}</p>
                : <p className="mv-muted">Tap “Re-test” to see a sample message in your voice.</p>}
              <button className="mv-btn2 sm" onClick={() => runTest(card.body)} disabled={testing}><Icon name="refresh" size={12} /> Re-test with my edits</button>
            </div>

            {err && <div className="mv-err">{err}</div>}
            <div className="mv-nav">
              <button className="mv-btn2" onClick={startOver}>Start over</button>
              <button className="mv-btn" onClick={activate}>{existing?.is_active ? 'Save changes' : 'Activate this voice'} <span className="mv-arrow">→</span></button>
            </div>
            {existing?.is_active && <div className="mv-note">Your voice is active and layered on top of The Concierge. Edit anytime.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function MvStyles() {
  return <style>{`
  .mv { height:100%; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; background:radial-gradient(ellipse at top, rgba(197,169,94,0.06) 0%, transparent 55%), var(--bg-base); }
  .mv-wrap { max-width:680px; margin:0 auto; padding:18px 16px 110px; }
  .mv-brand { padding:4px 0 16px; border-bottom:1px solid var(--border); margin-bottom:20px; }
  .mv-mark { font-size:12px; letter-spacing:0.16em; font-weight:700; color:var(--accent); }
  .mv-mark span { color:var(--text-3); font-weight:500; }
  .mv-eyebrow { font-size:11px; letter-spacing:0.2em; text-transform:uppercase; color:var(--accent); margin-bottom:10px; }
  .mv-intro h1 { font-size:clamp(30px,7.5vw,48px); line-height:1.04; letter-spacing:-0.02em; font-weight:700; color:var(--text-1); margin-bottom:6px; }
  .mv-intro h1 em { font-style:italic; color:var(--accent); font-weight:500; }
  .mv-lead { font-size:16px; line-height:1.55; color:var(--text-2); margin:20px 0 26px; }
  .mv-lead strong { color:var(--text-1); font-weight:600; }
  .mv-step-h { margin-bottom:18px; }
  .mv-step-h h2 { font-size:26px; font-weight:700; color:var(--text-1); margin:8px 0; }
  .mv-step-h p { font-size:14px; line-height:1.55; color:var(--text-2); }
  .mv-step-h strong { color:var(--text-1); }
  .mv-group { font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:var(--text-3); font-weight:700; margin:26px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--border); }
  .mv-field { margin-bottom:16px; }
  .mv-field label { display:block; font-size:12px; letter-spacing:0.04em; color:var(--text-3); margin-bottom:8px; }
  .mv-field input, .mv-field textarea { width:100%; background:var(--bg-card); border:1px solid var(--border); color:var(--text-1); padding:12px 14px; font-size:15px; line-height:1.5; border-radius:12px; outline:none; transition:border-color .2s; font-family:inherit; resize:vertical; }
  .mv-field input:focus, .mv-field textarea:focus { border-color:var(--accent); }
  .mv-chips { display:flex; gap:8px; flex-wrap:wrap; }
  .mv-chip { background:var(--bg-card); border:1px solid var(--border); color:var(--text-2); padding:9px 14px; border-radius:20px; font-size:13px; font-weight:600; cursor:pointer; transition:all .15s; }
  .mv-chip.on { background:rgba(197,169,94,0.14); border-color:var(--accent); color:var(--accent); }
  .mv-slider { margin-bottom:18px; }
  .mv-slider-top { display:flex; justify-content:space-between; font-size:12px; color:var(--text-2); font-weight:600; margin-bottom:6px; }
  .mv-slider input[type=range] { width:100%; accent-color:var(--accent); }
  .mv-draft { display:flex; flex-direction:column; gap:8px; margin-bottom:18px; }
  .mv-line { text-align:left; background:var(--bg-card); border:1px solid var(--border); color:var(--text-1); padding:13px 15px; border-radius:12px; font-size:14px; line-height:1.5; cursor:pointer; transition:all .15s; position:relative; }
  .mv-line.flagged { background:rgba(199,94,94,0.12); border-color:#C75E5E; color:var(--text-2); text-decoration:line-through; text-decoration-color:rgba(199,94,94,0.6); }
  .mv-line-x { display:block; font-size:10px; letter-spacing:0.1em; text-transform:uppercase; color:#C75E5E; margin-top:6px; text-decoration:none; font-weight:700; }
  .mv-before { font-size:14px; color:var(--text-3); font-style:italic; background:var(--bg-base); border-left:2px solid var(--border); padding:8px 12px; border-radius:6px; margin-bottom:8px; }
  .mv-btn { display:inline-flex; align-items:center; gap:9px; background:var(--accent); color:#1a1a1a; border:none; padding:13px 24px; font-weight:700; font-size:13px; letter-spacing:0.08em; text-transform:uppercase; cursor:pointer; border-radius:10px; transition:all .2s; }
  .mv-btn:hover { background:var(--accent-2,#d8bd78); } .mv-btn:disabled { background:var(--border); color:var(--text-3); cursor:not-allowed; }
  .mv-btn2 { display:inline-flex; align-items:center; gap:7px; background:transparent; color:var(--text-2); border:1px solid var(--border); padding:11px 18px; font-weight:600; font-size:12px; letter-spacing:0.05em; text-transform:uppercase; cursor:pointer; border-radius:10px; transition:all .2s; }
  .mv-btn2:hover { border-color:var(--accent); color:var(--accent); } .mv-btn2.sm { padding:8px 12px; font-size:11px; margin-top:12px; }
  .mv-arrow { font-size:15px; line-height:1; }
  .mv-nav { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:28px; }
  .mv-load { display:flex; flex-direction:column; align-items:center; gap:14px; padding:70px 20px; color:var(--text-2); text-align:center; font-size:14px; }
  .mv-spin { width:30px; height:30px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:mvspin .8s linear infinite; } .mv-spin.sm { width:16px; height:16px; }
  @keyframes mvspin { to { transform:rotate(360deg); } }
  .mv-review h2.mv-h2 { font-size:24px; font-weight:700; color:var(--text-1); margin:6px 0; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .mv-active { font-size:12px; color:#5EC78C; font-weight:600; }
  .mv-persona { font-size:16px; font-style:italic; color:var(--accent); line-height:1.5; margin-bottom:18px; }
  .mv-card { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:16px; margin-bottom:14px; }
  .mv-card-h { font-size:11px; letter-spacing:0.1em; text-transform:uppercase; color:var(--text-3); font-weight:700; margin-bottom:12px; display:flex; justify-content:space-between; align-items:baseline; }
  .mv-card-h span { color:var(--text-3); font-weight:500; text-transform:none; letter-spacing:0.02em; }
  .mv-cardbody { width:100%; background:var(--bg-base); border:1px solid var(--border); color:var(--text-1); padding:12px 14px; font-size:14px; line-height:1.65; border-radius:10px; outline:none; font-family:inherit; resize:vertical; }
  .mv-cardbody:focus { border-color:var(--accent); }
  .mv-cols { display:grid; grid-template-columns:1fr 1fr; gap:14px; } @media (max-width:560px){ .mv-cols { grid-template-columns:1fr; } }
  .mv-li { font-size:13px; line-height:1.5; color:var(--text-2); padding:7px 0; border-bottom:1px solid var(--border); } .mv-li:last-child { border-bottom:none; }
  .mv-test { border-color:var(--accent); }
  .mv-testdraft { font-size:15px; line-height:1.6; color:var(--text-1); white-space:pre-wrap; }
  .mv-testing { display:flex; align-items:center; gap:10px; color:var(--text-2); font-size:14px; }
  .mv-muted { font-size:14px; color:var(--text-3); }
  .mv-note { font-size:12px; color:var(--text-3); margin-top:12px; text-align:center; }
  .mv-err { background:rgba(199,94,94,0.12); border:1px solid #C75E5E; color:#e6b0b0; border-radius:10px; padding:12px; font-size:13px; margin-top:14px; }
  `}</style>;
}
