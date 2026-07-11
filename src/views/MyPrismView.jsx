import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../dataService';
import { Tip } from '../App';

const PRIMARY_WORD = { D: 'decisiveness', I: 'connection', S: 'steadiness', C: 'precision' };
const PRIMARY_LINE = {
  D: 'You move fast and lead with the outcome. Direct, decisive, and confident — you say the thing and drive to the close.',
  I: 'You connect through energy and warmth. Expressive, optimistic, and persuasive — people feel your enthusiasm and come along.',
  S: 'You build trust through steadiness. Patient, dependable, and personable — you make people feel safe and heard.',
  C: 'You lead with precision and proof. Careful, accurate, and credible — you back what you say with the receipts.',
};
const DIMS = [
  { k: 'D', word: 'Drive' }, { k: 'I', word: 'Influence' },
  { k: 'S', word: 'Steadiness' }, { k: 'C', word: 'Precision' },
];

const CSS = `
.mp{font-family:Manrope,sans-serif;color:#F6F1E7;background:#100D09;min-height:100%;
  background-image:radial-gradient(120% 55% at 50% -8%, rgba(203,163,92,.10), transparent 60%);-webkit-font-smoothing:antialiased}
.mp *{box-sizing:border-box}
.mp .wrap{max-width:520px;margin:0 auto;padding:6px 22px 72px}
.mp .serif{font-family:Fraunces,serif;font-weight:300;letter-spacing:-.02em;line-height:1.05}
.mp .eyebrow{font-size:11px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#CBA35C;margin-bottom:14px}
.mp .reveal{opacity:0;transform:translateY(16px);animation:mpRise .9s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes mpRise{to{opacity:1;transform:none}}
.mp .top{display:flex;align-items:center;gap:12px;padding:20px 0 26px}
.mp .mark{font-family:Fraunces,serif;font-weight:400;font-size:15px;letter-spacing:.02em}
.mp .mark b{color:#CBA35C;font-weight:500}
.mp .who{margin-left:auto;font-size:12px;color:#8C8475}
.mp .hero{padding:6px 0 30px}
.mp .hero h1{font-size:42px;margin:10px 0 16px}
.mp .hero h1 .em{font-style:italic;color:#EBCB82}
.mp .hero p{color:#C8BFAE;font-size:15.5px;max-width:40ch}
.mp .read{border-top:1px solid rgba(203,163,92,.20);border-bottom:1px solid rgba(203,163,92,.20);padding:28px 0 24px;margin:4px 0 30px}
.mp .read .cap{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:24px}
.mp .read .sharp{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#C8BFAE}
.mp .read .sharp b{color:#EBCB82;font-weight:700}
.mp .bars{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;height:200px}
.mp .bar{flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end}
.mp .bar .num{font-family:Fraunces,serif;font-weight:300;font-size:28px;line-height:1;margin-bottom:12px}
.mp .bar .track{width:100%;flex:1;display:flex;align-items:flex-end;border-radius:100px;background:linear-gradient(180deg,rgba(255,255,255,.02),rgba(0,0,0,.25));position:relative;overflow:hidden}
.mp .bar .fill{width:100%;border-radius:100px;background:linear-gradient(180deg,rgba(203,163,92,.32),rgba(203,163,92,.12));transform-origin:bottom;animation:mpGrow 1.1s cubic-bezier(.2,.7,.2,1) forwards;transform:scaleY(0)}
@keyframes mpGrow{to{transform:scaleY(1)}}
.mp .bar.primary .fill{background:linear-gradient(180deg,#EBCB82,#946F2C);box-shadow:0 0 34px rgba(203,163,92,.42)}
.mp .bar.primary .num{color:#EBCB82}
.mp .bar .let{font-family:Fraunces,serif;font-size:15px;margin-top:13px;color:#8C8475}
.mp .bar.primary .let{color:#CBA35C;font-weight:500}
.mp .bar .word{font-size:10px;letter-spacing:.09em;text-transform:uppercase;color:#8C8475;margin-top:5px}
.mp .bar.primary .track::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,transparent,rgba(235,203,130,.14),transparent);animation:mpRing 3.4s ease-in-out infinite}
@keyframes mpRing{0%,100%{transform:translateY(30%);opacity:0}50%{opacity:1}}
.mp .card{background:linear-gradient(180deg,#18130D,#100D09);border:1px solid rgba(203,163,92,.20);border-radius:20px;padding:26px 24px;margin-bottom:18px;position:relative;overflow:hidden}
.mp .card h2{font-size:25px;margin:8px 0 12px}
.mp .card p{color:#C8BFAE;font-size:14.5px}
.mp .card em{color:#F6F1E7;font-style:italic}
.mp .card .rule{width:34px;height:1px;background:rgba(203,163,92,.42);margin:18px 0}
.mp .tune{background:radial-gradient(90% 120% at 100% 0%, rgba(203,163,92,.10), transparent 55%),linear-gradient(180deg,#18130D,#100D09)}
.mp .fork{position:absolute;top:22px;right:24px;opacity:.75}
.mp .cta-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:20px}
.mp .cta{display:inline-flex;align-items:center;gap:9px;background:#EBCB82;color:#1a1409;font-weight:700;font-size:13.5px;padding:13px 20px;border-radius:100px;border:none;cursor:pointer;letter-spacing:.01em;font-family:Manrope,sans-serif}
.mp .cta.ghost{background:transparent;color:#F6F1E7;border:1px solid rgba(203,163,92,.42)}
.mp .dd{display:grid;gap:10px;margin-top:16px}
.mp .dd .row{display:flex;gap:11px;align-items:flex-start;font-size:13.5px;color:#C8BFAE}
.mp .dd .k{font-family:Fraunces,serif;font-size:13px;color:#CBA35C;flex:none;width:16px;text-align:center;margin-top:1px}
.mp .chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.mp .chip{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#C8BFAE;border:1px solid rgba(203,163,92,.20);border-radius:100px;padding:7px 12px}
.mp .progress{display:flex;align-items:center;gap:12px;margin-top:20px;font-size:12px;color:#8C8475}
.mp .dots{display:flex;gap:5px}.mp .dots i{width:7px;height:7px;border-radius:50%;background:rgba(203,163,92,.42)}.mp .dots i.on{background:#EBCB82}
.mp .note{margin-top:14px;font-size:12.5px;color:#EBCB82;opacity:.9}
.mp .foot{text-align:center;color:#8C8475;font-size:11px;letter-spacing:.05em;margin-top:32px}
`;

export default function MyPrismView({ userId, user }) {
  const [profile, setProfile] = useState(undefined); // undefined=loading, null=none
  const [voice, setVoice] = useState(null);
  const [lessonNote, setLessonNote] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: p } = await supabase.from('profiles').select('*').eq('user_id', userId).eq('subject_kind', 'owner').maybeSingle();
      if (!alive) return; setProfile(p || null);
      const { data: v } = await supabase.from('voice_cards').select('*').eq('user_id', userId).eq('is_active', true).order('created_at', { ascending: false }).limit(1);
      if (alive) setVoice((v && v[0]) || null);
    })();
    return () => { alive = false; };
  }, [userId]);

  const scores = useMemo(() => profile ? { D: profile.d_score, I: profile.i_score, S: profile.s_score, C: profile.c_score } : null, [profile]);
  const hasRead = scores && [scores.D, scores.I, scores.S, scores.C].every(v => typeof v === 'number');
  const maxScore = hasRead ? Math.max(scores.D, scores.I, scores.S, scores.C) : 0;
  const primary = profile?.primary_letter || (hasRead ? DIMS.map(d => d.k).reduce((a, b) => scores[b] > scores[a] ? b : a, 'D') : null);
  const firstName = (user?.user_metadata?.name || user?.email || 'there').split(/[ @]/)[0];
  const confLabel = (profile?.confidence || (profile?.confidence_pct >= 70 ? 'high' : profile?.confidence_pct >= 45 ? 'medium' : 'low') || 'building');
  const persona = voice?.persona_summary || '';
  const dos = Array.isArray(voice?.do_examples) ? voice.do_examples.slice(0, 2) : [];
  const donts = Array.isArray(voice?.dont_examples) ? voice.dont_examples.slice(0, 1) : [];

  const go = (v) => { try { window.__setView && window.__setView(v); } catch (_) {} };
  const attachRecording = () => { try { window.__attachRecording && window.__attachRecording(); } catch (_) {} };

  return (
    <div className="mp">
      <style>{CSS}</style>
      <div className="wrap">
        <div className="top reveal">
          <div className="mark">REALTY <b>ONE</b> GROUP · Prism</div>
          <div className="who">{user?.user_metadata?.name || firstName}</div>
        </div>

        <section className="hero reveal" style={{ animationDelay: '.05s' }}>
          <div className="eyebrow">Your Prism read</div>
          {hasRead ? (
            <>
              <h1 className="serif">You lead with <span className="em">{PRIMARY_WORD[primary] || 'your own signal'}.</span></h1>
              <p>{PRIMARY_LINE[primary] || 'A distinct read of how you naturally communicate.'}</p>
            </>
          ) : (
            <>
              <h1 className="serif">Your read is <span className="em">still forming.</span></h1>
              <p>Prism hasn't heard enough from you yet. The more you communicate — especially recorded conversations — the sharper your read becomes.</p>
            </>
          )}
        </section>

        {hasRead && (
          <section className="read reveal" style={{ animationDelay: '.12s' }}>
            <div className="cap">
              <div className="eyebrow" style={{ margin: 0 }}>The read</div>
              <div className="sharp">Sharpening · <b>{confLabel} confidence</b></div>
            </div>
            <div className="bars">
              {DIMS.map((d, i) => {
                const val = scores[d.k]; const isPrimary = val === maxScore;
                const h = Math.round(22 + Math.max(0, Math.min(100, val)) * 0.70);
                return (
                  <div className={'bar' + (isPrimary ? ' primary' : '')} key={d.k}>
                    <div className="num">{val}</div>
                    <div className="track"><div className="fill" style={{ height: h + '%', animationDelay: (i * 0.1) + 's' }} /></div>
                    <div className="let">{d.k}</div>
                    <div className="word">{d.word}</div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="card tune reveal" style={{ animationDelay: '.16s' }}>
          <svg className="fork" width="20" height="26" viewBox="0 0 20 26" fill="none" stroke="#CBA35C" strokeWidth="1.3" strokeLinecap="round"><path d="M5 1.5v8.5a5 5 0 0 0 10 0V1.5" /><path d="M10 15v9.5" /><path d="M7 24.5h6" /></svg>
          <div className="eyebrow">How this gets sharper</div>
          <h2 className="serif">Your assistant is a tuning fork.</h2>
          <p>It starts from your assessment — a strong first read of how you naturally communicate — and it sharpens every time you talk to a client, automatically, without you lifting a finger. The more it hears you, the more it sounds like <em>you at your best</em>.</p>
          <div className="rule" />
          <p>Recorded conversations carry far richer signal than written words — your tone, your pacing, how you build rapport and close lives in your <em>voice</em>, not your emails. Record everything you legally can and feed it in.</p>
          <div className="cta-row">
            <button className="cta" onClick={() => go('quo')}>Connect Quo — capture calls</button>
            <button className="cta ghost" onClick={attachRecording}>Import a recording</button>
          </div>
        </section>

        <Tip id="record" label="Record everything">Your assistant only sharpens from what it <b>hears</b>. Record every call and meeting you legally can — Quo announces it for you — because your <b>voice</b> carries tone, pacing, and instinct your typing never will. The more it hears you, the more it sounds like you at your best.</Tip>

        {(persona || dos.length) && (
          <section className="card reveal" style={{ animationDelay: '.2s' }}>
            <div className="eyebrow">Your voice</div>
            <h2 className="serif">How Prism writes as you.</h2>
            {persona && <p>{persona}</p>}
            {(dos.length || donts.length) ? (
              <div className="dd">
                {dos.map((x, i) => <div className="row" key={'do' + i}><span className="k">✓</span><span>{x}</span></div>)}
                {donts.map((x, i) => <div className="row" key={'dont' + i}><span className="k">✕</span><span>{x}</span></div>)}
              </div>
            ) : null}
          </section>
        )}

        <section className="card reveal" style={{ animationDelay: '.24s' }}>
          <div className="eyebrow">Learn as you go</div>
          <h2 className="serif">Read people the way Prism does.</h2>
          <p>Two-minute lessons on your own contacts. See a real message, call the type, learn the tell. No textbook — just reps that make you sharper on every call.</p>
          <div className="chips"><span className="chip">Spot a D</span><span className="chip">Warm up an S</span><span className="chip">Prove it to a C</span></div>
          <div className="cta-row"><button className="cta" onClick={() => setLessonNote(true)}>Start a 2-minute lesson</button></div>
          {lessonNote
            ? <div className="note">Your first lessons are being built right now — they'll appear here this week.</div>
            : <div className="progress"><div className="dots"><i className="on" /><i /><i /><i /><i /></div><span>Lesson 1 of 5 · earn your Reader badge</span></div>}
        </section>

        <div className="foot reveal">GREATNESS IS THE MINIMUM · POWERED BY PRISM</div>
      </div>
    </div>
  );
}
