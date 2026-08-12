import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Icon } from '../icons';
import { supabase } from '../dataService';

/* ============================================================
   QUESTION BANK  (ported verbatim from Full Spectrum)
   ============================================================ */
const STYLE_TETRADS = [
  ['Bold|D','Charming|I','Loyal|S','Precise|C'],
  ['Driven|D','Optimistic|I','Patient|S','Careful|C'],
  ['Direct|D','Talkative|I','Steady|S','Analytical|C'],
  ['Competitive|D','Persuasive|I','Easygoing|S','Logical|C'],
  ['Decisive|D','Outgoing|I','Calm|S','Detailed|C'],
  ['Forceful|D','Inspiring|I','Predictable|S','Cautious|C'],
  ['Take-charge|D','Sociable|I','Reliable|S','Systematic|C'],
  ['Risk-taking|D','Enthusiastic|I','Consistent|S','Accurate|C'],
  ['Independent|D','Expressive|I','Cooperative|S','Reserved|C'],
  ['Self-reliant|D','Animated|I','Supportive|S','Disciplined|C'],
  ['Demanding|D','Friendly|I','Mellow|S','Methodical|C'],
  ['Restless|D','Trusting|I','Sympathetic|S','Diplomatic|C'],
  ['Pioneering|D','Magnetic|I','Modest|S','Conventional|C'],
  ['Impatient|D','Generous|I','Tolerant|S','Tactful|C'],
  ['Strong-willed|D','Open|I','Even-tempered|S','Restrained|C'],
  ['Daring|D','Cheerful|I','Accommodating|S','Particular|C'],
  ['Adventurous|D','Playful|I','Deliberate|S','Conservative|C'],
  ['Confident|D','Warm|I','Gentle|S','Disciplined|C'],
  ['Aggressive|D','Lively|I','Unhurried|S','Cautious|C'],
  ['Persistent|D','Spontaneous|I','Considerate|S','Orderly|C'],
  ['Outspoken|D','Engaging|I','Pleasant|S','Reflective|C'],
  ['Goal-focused|D','Encouraging|I','Harmonious|S','Standards-driven|C'],
  ['Resolute|D','Joyful|I','Calm-under-pressure|S','Procedural|C'],
  ['Action-oriented|D','People-oriented|I','Team-oriented|S','Detail-oriented|C'],
];
const NATURAL_TETRADS = [
  ['Bold|D','Charming|I','Loyal|S','Precise|C'],
  ['Direct|D','Talkative|I','Steady|S','Analytical|C'],
  ['Decisive|D','Outgoing|I','Calm|S','Detailed|C'],
  ['Independent|D','Expressive|I','Cooperative|S','Reserved|C'],
  ['Strong-willed|D','Open|I','Even-tempered|S','Restrained|C'],
  ['Action-oriented|D','People-oriented|I','Team-oriented|S','Detail-oriented|C'],
];
const DRIVE_ITEMS = [
  {id:'E1', dim:'E', type:'BE', prompt:'In the last 24 months, how many distinct business plans, niches, or "this is my focus now" pivots have you made?',
    options:[{text:'0–1 (held the line)',s:3},{text:'2 (one real pivot)',s:2},{text:'3 (notable churn)',s:1},{text:'4+ (chronic pivoting)',s:0}]},
  {id:'F1', dim:'F', type:'BE', prompt:'In the last 12 months, how many new lead sources, CRMs, marketing platforms, or coaching programs have you started and dropped within 90 days?',
    options:[{text:'0',s:3},{text:'1',s:2},{text:'2',s:1},{text:'3+',s:0}]},
  {id:'DX1', dim:'X', type:'DX', prompt:'I have occasionally let a follow-up slip past the deadline I set for myself.',
    options:[{text:'Never',s:1},{text:'Rarely',s:0},{text:'Sometimes',s:0},{text:'Often',s:0}]},
  {id:'R1', dim:'R', type:'BE', prompt:'Think of the last deal that fell apart late (under contract, then died). How long was it before you made your next prospecting call?',
    options:[{text:'Same day or next morning',s:3},{text:'Within 2–3 days',s:2},{text:'Within a week',s:1},{text:"More than a week / I'm not sure",s:0}]},
  {id:'D1', dim:'D', type:'BE', prompt:'In the last full week you worked, how many of your scheduled follow-up calls actually got made on the day they were scheduled?',
    options:[{text:'90%+',s:3},{text:'70–89%',s:2},{text:'50–69%',s:1},{text:"Under 50% / I don't track this",s:0}]},
  {id:'E2', dim:'E', type:'FC', prompt:'Which is more like you?',
    options:[{text:'I set 3-year income goals and let monthly results fluctuate without changing course.',s:3},{text:"I set 3-year income goals but adjust the plan every quarter based on what's working.",s:1}]},
  {id:'F2', dim:'F', type:'FC', prompt:'Which is more like you?',
    options:[{text:'When I hear about a new tactic working for another agent, I finish my current focus before testing it.',s:3},{text:'When I hear about a new tactic working for another agent, I test it within 2 weeks — winners stay, losers go.',s:1}]},
  {id:'DX2', dim:'X', type:'DX', prompt:"There have been days in the last 6 months where I didn't feel like prospecting at all.",
    options:[{text:'Never',s:1},{text:'Rarely',s:0},{text:'Sometimes',s:0},{text:'Often',s:0}]},
  {id:'R2', dim:'R', type:'FC', prompt:'Which is more like you?',
    options:[{text:'A buyer ghosting me after I spent 3 weekends with them makes me MORE determined the next week.',s:3},{text:'A buyer ghosting me after I spent 3 weekends with them makes me reassess my client-screening process.',s:1}]},
  {id:'D2', dim:'D', type:'FC', prompt:'Which is more like you?',
    options:[{text:"I do my CRM updates and follow-up calls even on days I'm not feeling it.",s:3},{text:'I save the routine work for days I have the energy and crush it then.',s:1}]},
  {id:'E3', dim:'E', type:'SC', prompt:"It's month 9 of working a new lead source. You've put in real effort. Results are below what you projected — about 60% of target. What's your actual probable behavior?",
    options:[{text:'Stay the course another 6 months and double down on execution',s:3},{text:'Stay the course but cut effort to 50% while testing one new channel in parallel',s:2},{text:'Pivot to a new lead source — 9 months is enough data',s:1},{text:'Honestly: I would have pivoted by month 4 or 5',s:0}]},
  {id:'F3', dim:'F', type:'SC', prompt:'A top agent at a conference shared a script that\'s "printing money" with cold expireds. You currently have a working farm strategy in month 7 of a 12-month commitment. Realistically:',
    options:[{text:'Take notes, finish my 12-month farm commitment, evaluate then',s:3},{text:'Add the new script as a small test (2hrs/week max) without disrupting the farm',s:2},{text:'Split my time 50/50 between the two starting Monday',s:1},{text:'Pause the farm to focus on the new opportunity — it sounds higher-yield',s:0}]},
  {id:'DX3', dim:'X', type:'DX', prompt:'I have started something in this business and not finished it the way I originally intended.',
    options:[{text:'Never',s:1},{text:'Once or twice',s:0},{text:'A handful of times',s:0},{text:'Multiple times',s:0}]},
  {id:'R3', dim:'R', type:'SC', prompt:'You lose 3 deals in 30 days — appraisal, inspection, financing, one each. Realistically:',
    options:[{text:"I'm back to normal output by week 2",s:3},{text:"I'm functional but a bit rattled for a month",s:2},{text:'I\'d take a real hit — maybe a quarter to fully bounce back',s:1},{text:'Honestly, a stretch like that would shake my confidence for longer',s:0}]},
  {id:'D3', dim:'D', type:'SC', prompt:"It's Friday 4pm. Your scheduled task list still has 6 follow-up calls on it. You're tired. You have weekend plans starting at 7. Honest probable behavior:",
    options:[{text:'Make all 6 calls before I leave the office',s:3},{text:'Make 3–4 of the higher-priority ones, push the rest to Monday',s:2},{text:'Push all 6 to Monday, justify it as "better energy then"',s:1},{text:'Push to Monday and they\'ll likely slide into Tuesday or later',s:0}]},
  {id:'E4', dim:'E', type:'BE', prompt:'Of the last 3 lead-generation strategies you committed to, how many did you work for 12+ months before judging them?',
    options:[{text:'All 3',s:3},{text:'2 of 3',s:2},{text:'1 of 3',s:1},{text:'0 of 3',s:0}]},
  {id:'R4', dim:'R', type:'BE', prompt:'In the last 12 months, name your worst 30-day stretch (revenue, deals, or morale). How would you describe your prospecting volume during that stretch vs. your normal?',
    options:[{text:'Higher than normal — I attacked it',s:3},{text:'Same as normal — I kept the routine',s:2},{text:'Lower — I dropped about 25%',s:1},{text:'Significantly lower — 50%+ drop',s:0}]},
  {id:'D4', dim:'D', type:'BE', prompt:'Think about your morning routine for business activities (prospecting, planning, content, whatever your "must-do" is). In the last 4 weeks, how many days did you actually execute it?',
    options:[{text:'24+ of 28 days',s:3},{text:'18–23 days',s:2},{text:'12–17 days',s:1},{text:"Under 12 / I don't have a fixed routine",s:0}]},
  {id:'DX4', dim:'X', type:'DX', prompt:"Looking back at the last 12 months, there's at least one decision I regret or would make differently.",
    options:[{text:'No regrets',s:1},{text:"One I'd revisit",s:0},{text:'A few',s:0},{text:'Several',s:0}]},
  {id:'F4', dim:'F', type:'BE', prompt:'Open your phone right now. How many real-estate "productivity" or coaching apps/subscriptions are you actively paying for that you haven\'t opened in the last 30 days?',
    options:[{text:'0',s:3},{text:'1',s:2},{text:'2',s:1},{text:'3+',s:0}]},
];
const VALIDITY_ANCHOR_OPTIONS = [
  { label: 'Essentially the same', value: 0 },
  { label: 'A little different', value: 1 },
  { label: 'Noticeably different', value: 2 },
  { label: 'A completely different person', value: 3 },
];
const TOTAL_STYLE = STYLE_TETRADS.length + NATURAL_TETRADS.length; // 30
const VALIDITY_INDEX = TOTAL_STYLE;
const TOTAL_STYLE_STEPS = TOTAL_STYLE + 1; // 31
const TOTAL_DRIVE = DRIVE_ITEMS.length;    // 20
const TOTAL_QUESTIONS = TOTAL_STYLE_STEPS + TOTAL_DRIVE;

/* ============================================================
   SCORING  (ported verbatim)
   ============================================================ */
function computeStyleScores(styleAnswers) {
  const adaptive = { D:0, I:0, S:0, C:0 };
  const natural = { D:0, I:0, S:0, C:0 };
  for (let i = 0; i < STYLE_TETRADS.length; i++) {
    const a = styleAnswers[i]; if (!a) continue;
    if (a.most) adaptive[a.most] += 1;
    if (a.least) adaptive[a.least] -= 1;
  }
  for (let i = STYLE_TETRADS.length; i < TOTAL_STYLE; i++) {
    const a = styleAnswers[i]; if (!a) continue;
    if (a.most) natural[a.most] += 1;
    if (a.least) natural[a.least] -= 1;
  }
  const normA = v => Math.round(((v + 24) / 48) * 100);
  const normN = v => Math.round(((v + 6) / 12) * 100);
  return {
    adaptive: { D:normA(adaptive.D), I:normA(adaptive.I), S:normA(adaptive.S), C:normA(adaptive.C) },
    natural:  { D:normN(natural.D),  I:normN(natural.I),  S:normN(natural.S),  C:normN(natural.C) },
  };
}
function computeDriveScores(driveAnswers) {
  const dims = { E:[], R:[], D:[], F:[] };
  let distortionHits = 0;
  for (let i = 0; i < TOTAL_DRIVE; i++) {
    const item = DRIVE_ITEMS[i]; const ans = driveAnswers[i];
    if (!ans) continue;
    if (item.dim === 'X') { if (ans.score === 1) distortionHits++; }
    else dims[item.dim].push(ans.score);
  }
  const sub = {};
  for (const k of ['E','R','D','F']) {
    const sum = dims[k].reduce((a,b)=>a+b,0);
    const max = dims[k].length * 3;
    sub[k] = max > 0 ? Math.round((sum / max) * 100) : 0;
  }
  const weighted = (sub.E*1.0 + sub.R*1.0 + sub.D*1.25 + sub.F*1.25);
  const overall = Math.round(weighted / 4.5);
  return { sub, overall, distortionHits };
}
function computeValidityFlag(style, anchor) {
  if (anchor === null || anchor === undefined) return null;
  const gaps = ['D','I','S','C'].map(k => Math.abs(style.adaptive[k] - style.natural[k]));
  const maxGap = Math.max(...gaps);
  if (anchor === 0 && maxGap >= 25) return { type:'stress', headline:'Stress signal — unrecognized adaptation', detail:`You reported being "essentially the same" at work vs. off-duty, but the data shows a ${maxGap}-point gap on at least one DISC dimension. You're operating in a significantly adapted mode without fully realizing it — a textbook burnout precursor worth surfacing in coaching.` };
  if (anchor === 3 && maxGap < 10) return { type:'coaching', headline:'Self-perception mismatch — overstated adaptation', detail:`You reported being "a completely different person" at work, but the data shows only a ${maxGap}-point max gap. Either you feel more strain than the role requires, or the work/off-duty line blurred while answering. Worth a short conversation to clarify.` };
  if (anchor === 1 && maxGap >= 30) return { type:'stress', headline:'Underreported adaptation', detail:`You reported being "a little different" at work, but the data shows a ${maxGap}-point gap. The strain is bigger than you recognize — worth noting.` };
  if ((anchor === 3 && maxGap >= 25) || (anchor === 0 && maxGap < 10) || (anchor === 2 && maxGap >= 15 && maxGap < 30) || (anchor === 1 && maxGap < 20))
    return { type:'aligned', headline:'Self-awareness aligned', detail:`Your self-report (${VALIDITY_ANCHOR_OPTIONS[anchor].label.toLowerCase()}) matches the measured gap (${maxGap} points max). That accurate self-perception is itself a strength.` };
  return null;
}
function styleLabel(adaptive) {
  const arr = Object.entries(adaptive).sort((a,b)=>b[1]-a[1]);
  const top1 = arr[0][0], top2 = arr[1][0];
  const labels = {DI:'Decisive Influencer',ID:'Inspiring Driver',DC:'Strategic Achiever',CD:'Analytical Driver',DS:'Determined Steady',SD:'Stable Driver',IS:'Warm Connector',SI:'Steady Encourager',IC:'Refined Persuader',CI:'Precise Communicator',SC:'Methodical Supporter',CS:'Careful Steady'};
  return labels[top1+top2] || `${top1}/${top2} Profile`;
}
const DIM_NAME = { E:'Endurance', R:'Recovery', D:'Discipline', F:'Focus' };
const DIM_DESC = { E:'long-arc commitment', R:'bounce-back after losses', D:'effort when unmotivated', F:'anti-shiny-object focus' };
const LETTER_NAME = { D:'Dominance', I:'Influence', S:'Steadiness', C:'Conscientiousness' };
function typeLabel(t){ return {BE:'Behavioral evidence', FC:'Forced choice', SC:'Scenario', DX:'Self-awareness'}[t] || ''; }

/* ============================================================
   DETERMINISTIC READOUT  (no API key; honest + tailored)
   ============================================================ */
const LETTER_BLURB = {
  D:'you push for results, move fast, and want the bottom line',
  I:'you lead with relationship, energy, and persuasion',
  S:'you bring steadiness, patience, and follow-through',
  C:'you bring rigor, accuracy, and standards',
};
const DRIVE_LOW_COACH = {
  E:['Endurance — staying with a strategy long enough to judge it', 'You likely pivot before a lead source has had time to prove itself. Pick one channel and commit to a 12-month, non-negotiable runway; judge it on leading indicators monthly, but do not change the channel until the year is up.'],
  R:['Recovery — getting back to output after a loss', 'A dead deal or a cold streak pulls your prospecting volume down right when it needs to go up. Build a "bad-day floor": a minimum set of dials/touches you make no matter what, so a setback can dent your mood but not your pipeline.'],
  D:['Discipline — doing the work on low-motivation days', "Your routine holds on good days and slips on tired ones, which is where most of the revenue leaks. Anchor the must-do block to a fixed time and make it the first thing, before the day can negotiate with you."],
  F:['Focus — resisting the next shiny tactic', 'New scripts and tools pull you off whatever is already working. Adopt a one-in-one-out rule: nothing new starts until something current is finished or formally retired, and cap experiments at a few hours a week.'],
};
function buildReadout({ name, style, drive, styleLbl, validityFlag }){
  const arr = Object.entries(style.adaptive).sort((a,b)=>b[1]-a[1]);
  const t1 = arr[0][0], t2 = arr[1][0];
  const gaps = ['D','I','S','C'].map(k => ({k, g: style.adaptive[k]-style.natural[k]}));
  const maxGapObj = gaps.slice().sort((a,b)=>Math.abs(b.g)-Math.abs(a.g))[0];
  const maxGap = Math.abs(maxGapObj.g);
  const subs = Object.entries(drive.sub).sort((a,b)=>a[1]-b[1]);
  const low1 = subs[0], low2 = subs[1];

  let p1 = `You read as a ${styleLbl}. At work, your strongest gears are ${LETTER_NAME[t1]} and ${LETTER_NAME[t2]} — ${LETTER_BLURB[t1]}, and ${LETTER_BLURB[t2]}. `;
  if (maxGap >= 15) {
    p1 += `There's a real gap between how you show up at work and who you are off-duty — about ${maxGap} points on ${LETTER_NAME[maxGapObj.k]}. That much adaptation is effort you're spending every day, and over time it taxes you. `;
  } else {
    p1 += `Your work self and your off-duty self line up closely, which means the way you operate costs you very little to sustain — a quiet advantage. `;
  }
  if (validityFlag && validityFlag.type !== 'aligned') p1 += validityFlag.detail + ' ';
  else if (validityFlag && validityFlag.type === 'aligned') p1 += validityFlag.detail;

  let p2 = `Your overall Drive sits at ${drive.overall} out of 100. The honest pressure point is ${DIM_NAME[low1[0]]} (${low1[1]}) — your ${DIM_DESC[low1[0]]}. `;
  p2 += {
    E:'On a Tuesday at 2pm that looks like a half-worked strategy you\'re already itching to replace. ',
    R:'On a Tuesday at 2pm after a rough week, that looks like a quiet phone and a to-do list you keep "getting to." ',
    D:'On a Tuesday at 2pm when motivation dips, that looks like the calls that were scheduled but never dialed. ',
    F:'On a Tuesday at 2pm that looks like a new tool open in a tab while last month\'s plan goes cold. ',
  }[low1[0]];
  p2 += `${DIM_NAME[low2[0]]} (${low2[1]}) is the second thing to watch. `;
  if (drive.distortionHits >= 3) p2 += `Note: your self-awareness answers came back unusually flawless — that often means a little self-protection crept in, so read these scores as a floor, not a ceiling. `;

  let p3 = `Put together: as a ${styleLbl} you win where your top gears do — `;
  p3 += (t1==='D'||t2==='D') ? 'taking decisive action and driving deals to a close' : (t1==='I'||t2==='I') ? 'opening doors and winning people quickly' : (t1==='S'||t2==='S') ? 'earning trust and keeping clients for the long haul' : 'getting the details right and being the agent who never drops the ball';
  p3 += `. Where you'll leak revenue is exactly the Drive gap above: ${DIM_NAME[low1[0]].toLowerCase()}. Your style gets you the at-bats; building that one habit is what converts them. Fix it and the rest of your profile compounds.`;

  const coaching = `PRIORITY 1: ${DRIVE_LOW_COACH[low1[0]][0]}\n${DRIVE_LOW_COACH[low1[0]][1]}\n\nPRIORITY 2: ${DRIVE_LOW_COACH[low2[0]][0]}\n${DRIVE_LOW_COACH[low2[0]][1]}`;
  return { readout: [p1.trim(), p2.trim(), p3.trim()].join('\n\n'), coaching };
}

/* ============================================================
   COMPONENT
   ============================================================ */
export default function DiscAssessmentView({ userId, user, profiles, setProfiles }) {
  const seedName = (user?.user_metadata?.full_name || user?.user_metadata?.name || (user?.email ? user.email.split('@')[0] : '') || '').replace(/\b\w/g, c => c.toUpperCase());
  const [phase, setPhase] = useState('loading');     // loading|intro|style|drive|computing|results
  const [name, setName] = useState(seedName);
  const [styleIndex, setStyleIndex] = useState(0);
  const [driveIndex, setDriveIndex] = useState(0);
  const [styleAnswers, setStyleAnswers] = useState({});
  const [validityAnchor, setValidityAnchor] = useState(null);
  const [driveAnswers, setDriveAnswers] = useState({});
  const [results, setResults] = useState(null);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef(null);

  // Load latest saved assessment on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.from('disc_assessments').select('*').eq('user_id', userId).order('taken_at', { ascending:false }).limit(1);
        if (!alive) return;
        if (data && data[0]) {
          const r = data[0];
          setResults({ name:r.agent_name, style:{ adaptive:r.adaptive, natural:r.natural_scores }, drive:r.drive, styleLabel:r.style_label, validityFlag:r.validity?.flag || null, validityAnchorLabel:r.validity?.anchorLabel || null, readout:r.readout, coaching:r.coaching, taken_at:r.taken_at });
          setPhase('results');
        } else { setPhase('intro'); }
      } catch (_e) { if (alive) setPhase('intro'); }
    })();
    return () => { alive = false; };
  }, [userId]);

  const scrollTop = () => { try { scrollRef.current && scrollRef.current.scrollTo({ top:0, behavior:'smooth' }); } catch(_e){} };
  const answeredCount = useMemo(() => Object.keys(styleAnswers).filter(k => { const a = styleAnswers[k]; return a && a.most && a.least && a.most !== a.least; }).length + (validityAnchor !== null ? 1 : 0) + Object.keys(driveAnswers).length, [styleAnswers, validityAnchor, driveAnswers]);
  const progress = phase === 'results' ? 100 : phase === 'intro' || phase === 'loading' ? 0 : Math.round((answeredCount / TOTAL_QUESTIONS) * 100);

  function pickStyle(idx, which, code) {
    setStyleAnswers(prev => {
      const next = { ...prev };
      const cur = { ...(next[idx] || {}) };
      if (cur[which] === code) delete cur[which];
      else { if (which === 'most' && cur.least === code) delete cur.least; if (which === 'least' && cur.most === code) delete cur.most; cur[which] = code; }
      next[idx] = cur; return next;
    });
  }

  async function syncOwnerProfile(natural, adaptive, drive) {
    // Feed the natural baseline into the agent's own ('owner') Prism profile so the
    // rest of the app (DISC-aware tools) knows their stable behavioral baseline.
    try {
      const arr = Object.entries(natural).sort((a,b)=>b[1]-a[1]);
      const primary = arr[0][0];
      const secondary = arr[1] && arr[1][0] !== primary ? arr[1][0] : null;
      const nowIso = new Date().toISOString();
      const base = {
        d_score: natural.D, i_score: natural.I, s_score: natural.S, c_score: natural.C,
        primary_letter: primary, secondary_letter: secondary,
        baseline_d_score: natural.D, baseline_i_score: natural.I, baseline_s_score: natural.S, baseline_c_score: natural.C,
        baseline_primary: primary, baseline_secondary: secondary,
        baseline_locked: true, baseline_source: 'self_assessment', baseline_taken_at: nowIso,
        source: 'self_assessment', confidence: 'high', confidence_pct: 90,
        signal_snapshot: { adaptive, drive }, updated_at: nowIso,
      };
      const { data: existing } = await supabase.from('profiles').select('id').eq('user_id', userId).eq('subject_kind', 'owner').limit(1);
      let row = null;
      if (existing && existing[0]) {
        const { data } = await supabase.from('profiles').update(base).eq('id', existing[0].id).select().single();
        row = data;
      } else {
        const { data } = await supabase.from('profiles').insert({ ...base, user_id: userId, subject_kind: 'owner' }).select().single();
        row = data;
      }
      if (row && setProfiles) setProfiles(prev => { const others = (prev || []).filter(x => x.id !== row.id); return [...others, row]; });
    } catch (_e) {}
  }

  async function computeAndShow() {
    setPhase('computing'); scrollTop();
    const style = computeStyleScores(styleAnswers);
    const drive = computeDriveScores(driveAnswers);
    const styleLbl = styleLabel(style.adaptive);
    const validityFlag = computeValidityFlag(style, validityAnchor);
    const anchorLabel = validityAnchor !== null ? VALIDITY_ANCHOR_OPTIONS[validityAnchor].label : null;

    // Claude-authored readout via the disc-readout edge function; deterministic local fallback.
    const local = buildReadout({ name, style, drive, styleLbl, validityFlag });
    let readout = local.readout, coaching = local.coaching, readoutSource = 'local';
    try {
      const { data, error } = await supabase.functions.invoke('disc-readout', {
        body: { name, style: { adaptive: style.adaptive, natural: style.natural }, drive, validity: { anchorLabel, flag: validityFlag }, styleLabel: styleLbl },
      });
      if (!error && data && data.readout) { readout = data.readout; if (data.coaching) coaching = data.coaching; readoutSource = 'ai'; }
    } catch (_e) {}

    const res = { name, style, drive, styleLabel: styleLbl, validityFlag, validityAnchorLabel: anchorLabel, readout, coaching, readoutSource, taken_at: new Date().toISOString() };
    setResults(res); setPhase('results'); scrollTop();
    try {
      setSaving(true);
      await supabase.from('disc_assessments').insert({
        user_id: userId, agent_name: name, adaptive: style.adaptive, natural_scores: style.natural,
        drive, validity: { anchor: validityAnchor, anchorLabel, flag: validityFlag }, style_label: styleLbl, readout, coaching,
      });
      await syncOwnerProfile(style.natural, style.adaptive, drive);
    } catch (_e) {} finally { setSaving(false); }
  }

  function retake() {
    setStyleAnswers({}); setDriveAnswers({}); setValidityAnchor(null); setStyleIndex(0); setDriveIndex(0); setResults(null); setPhase('intro'); scrollTop();
  }

  /* ---------- RENDER ---------- */
  return (
    <div className="fsa" ref={scrollRef}>
      <FsaStyles />
      <div className="fsa-wrap">
        <div className="fsa-brand">
          <span className="fsa-mark">FULL SPECTRUM <span>· DISC + Grit</span></span>
          <span className="fsa-pill">{phase === 'results' ? 'Complete' : phase === 'intro' || phase === 'loading' ? 'Ready' : `${progress}%`}</span>
        </div>
        <div className="fsa-progress"><div className="fsa-progress-fill" style={{ width:`${progress}%` }} /></div>

        {phase === 'loading' && <div className="fsa-loading"><div className="fsa-spinner" /><p>Loading…</p></div>}

        {phase === 'intro' && (
          <div className="fsa-intro">
            <div className="fsa-eyebrow">The behavioral baseline</div>
            <h1>Know how you <em>actually</em> operate.</h1>
            <p className="fsa-lead">Two parts. Your <strong>Style</strong> (DISC) shows how you work and where your at-work self differs from the real you. Your <strong>Drive</strong> measures the grit that decides whether your style ever pays off — endurance, recovery, discipline, and focus.</p>
            <div className="fsa-meta">
              <div><div className="fsa-meta-l">Time</div><div className="fsa-meta-v">~<span>8</span> min</div></div>
              <div><div className="fsa-meta-l">Questions</div><div className="fsa-meta-v"><span>{TOTAL_QUESTIONS}</span></div></div>
              <div><div className="fsa-meta-l">Output</div><div className="fsa-meta-v">Full <span>readout</span></div></div>
            </div>
            <div className="fsa-field">
              <label>Your name</label>
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="First and last name" />
            </div>
            <button className="fsa-btn" disabled={!name.trim()} onClick={()=>{ setPhase('style'); scrollTop(); }}>Begin <span className="fsa-arrow">→</span></button>
          </div>
        )}

        {phase === 'style' && <StyleScreen {...{ styleIndex, setStyleIndex, styleAnswers, pickStyle, validityAnchor, setValidityAnchor, goDrive:()=>{ setPhase('drive'); scrollTop(); }, scrollTop }} />}

        {phase === 'drive' && <DriveScreen {...{ driveIndex, setDriveIndex, driveAnswers, setDriveAnswers, backStyle:()=>{ setPhase('style'); setStyleIndex(VALIDITY_INDEX); scrollTop(); }, finish:computeAndShow, scrollTop }} />}

        {phase === 'computing' && (
          <div className="fsa-loading"><div className="fsa-spinner" /><p>Reading the spectrum…</p></div>
        )}

        {phase === 'results' && results && <Results res={results} onRetake={retake} saving={saving} />}
      </div>
    </div>
  );
}

/* ---------- Style screen ---------- */
function StyleScreen({ styleIndex, setStyleIndex, styleAnswers, pickStyle, validityAnchor, setValidityAnchor, goDrive, scrollTop }) {
  const idx = styleIndex;
  const isValidity = idx === VALIDITY_INDEX;
  const isNatural = !isValidity && idx >= STYLE_TETRADS.length;
  const heading = isValidity ? 'One last check.' : isNatural ? 'Off-duty.' : 'At work.';
  const sub = isValidity ? 'A calibration question before we move to Drive.'
    : isNatural ? 'Same instructions — but answer as you are OUTSIDE of work. The real you, weekends and all.'
    : 'For each set of four, pick the word that is MOST like you at work — and the one that is LEAST. Trust your gut.';
  const cur = styleAnswers[idx] || {};
  const answered = isValidity ? validityAnchor !== null : (cur.most && cur.least && cur.most !== cur.least);
  const tetrad = isValidity ? null : (isNatural ? NATURAL_TETRADS[idx - STYLE_TETRADS.length] : STYLE_TETRADS[idx]);

  const next = () => { if (idx < TOTAL_STYLE_STEPS - 1) { setStyleIndex(idx + 1); scrollTop(); } else goDrive(); };
  const back = () => { if (idx > 0) { setStyleIndex(idx - 1); scrollTop(); } };

  return (
    <div className="fsa-q">
      <div className="fsa-q-head"><div className="fsa-eyebrow">Style · DISC</div><h2>{heading}</h2><p>{sub}</p></div>
      {isValidity ? (
        <div className="fsa-mcq">
          <div className="fsa-frame">Validity anchor · Calibration</div>
          <div className="fsa-prompt">Overall, how different are you at work vs. outside of work?</div>
          <div className="fsa-opts">
            {VALIDITY_ANCHOR_OPTIONS.map(o => (
              <button key={o.value} className={`fsa-opt ${validityAnchor === o.value ? 'sel' : ''}`} onClick={()=>setValidityAnchor(o.value)}>{o.label}</button>
            ))}
          </div>
        </div>
      ) : (
        <div className="fsa-tetrad">
          <div className="fsa-frame">{isNatural ? 'Off-duty framing' : 'Work framing'} · Set {(isNatural ? idx - STYLE_TETRADS.length + 1 : idx + 1)} of {isNatural ? NATURAL_TETRADS.length : STYLE_TETRADS.length}</div>
          <div className="fsa-prompt">Which is MOST like you, and which is LEAST?</div>
          <div className="fsa-tetrad-opts">
            {tetrad.map(opt => {
              const [word, code] = opt.split('|');
              return (
                <div className="fsa-trow" key={code}>
                  <div className="fsa-word">{word}</div>
                  <div className="fsa-picks">
                    <button className={`fsa-pick ${cur.most === code ? 'most' : ''}`} onClick={()=>pickStyle(idx,'most',code)}>Most</button>
                    <button className={`fsa-pick ${cur.least === code ? 'least' : ''}`} onClick={()=>pickStyle(idx,'least',code)}>Least</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="fsa-nav">
        <button className="fsa-btn2" style={{ visibility: idx === 0 ? 'hidden':'visible' }} onClick={back}>← Back</button>
        <span className="fsa-counter">{idx + 1} / {TOTAL_STYLE_STEPS}</span>
        <button className="fsa-btn" disabled={!answered} onClick={next}>{isValidity ? 'Continue to Drive' : 'Next'} <span className="fsa-arrow">→</span></button>
      </div>
    </div>
  );
}

/* ---------- Drive screen ---------- */
function DriveScreen({ driveIndex, setDriveIndex, driveAnswers, setDriveAnswers, backStyle, finish, scrollTop }) {
  const idx = driveIndex;
  const item = DRIVE_ITEMS[idx];
  const sel = driveAnswers[idx];
  const pick = (optionIdx, score) => setDriveAnswers(prev => ({ ...prev, [idx]: { optionIdx, score } }));
  const next = () => { if (idx < TOTAL_DRIVE - 1) { setDriveIndex(idx + 1); scrollTop(); } else finish(); };
  const back = () => { if (idx > 0) { setDriveIndex(idx - 1); scrollTop(); } else backStyle(); };
  return (
    <div className="fsa-q">
      <div className="fsa-q-head"><div className="fsa-eyebrow">Drive · Grit</div><h2>How you hold the line.</h2><p>Answer honestly — this section only works if you do.</p></div>
      <div className="fsa-mcq">
        <div className="fsa-frame">{typeLabel(item.type)} · Item {idx + 1} of {TOTAL_DRIVE}</div>
        <div className="fsa-prompt">{item.prompt}</div>
        <div className="fsa-opts">
          {item.options.map((o, i) => (
            <button key={i} className={`fsa-opt ${sel && sel.optionIdx === i ? 'sel' : ''}`} onClick={()=>pick(i, o.s)}>{o.text}</button>
          ))}
        </div>
      </div>
      <div className="fsa-nav">
        <button className="fsa-btn2" onClick={back}>← Back</button>
        <span className="fsa-counter">{idx + 1} / {TOTAL_DRIVE}</span>
        <button className="fsa-btn" disabled={sel === undefined} onClick={next}>{idx === TOTAL_DRIVE - 1 ? 'Compute Spectrum' : 'Next'} <span className="fsa-arrow">→</span></button>
      </div>
    </div>
  );
}

/* ---------- Results ---------- */
function Bar({ letter, adapt, nat }) {
  return (
    <div className="fsa-bar">
      <div className="fsa-bar-top"><span className="fsa-bar-letter">{letter} · {LETTER_NAME[letter]}</span><span className="fsa-bar-nums">{adapt}<span className="fsa-bar-nat"> / {nat}</span></span></div>
      <div className="fsa-track"><div className="fsa-fill nat" style={{ width:`${nat}%` }} /></div>
      <div className="fsa-track"><div className="fsa-fill adapt" style={{ width:`${adapt}%` }} /></div>
    </div>
  );
}
function DriveBar({ code, val }) {
  return (
    <div className="fsa-dbar">
      <div className="fsa-bar-top"><span className="fsa-bar-letter">{DIM_NAME[code]}</span><span className="fsa-bar-nums">{val}</span></div>
      <div className="fsa-track"><div className="fsa-fill drive" style={{ width:`${val}%` }} /></div>
    </div>
  );
}
function Results({ res, onRetake, saving }) {
  const a = res.style.adaptive, n = res.style.natural;
  const flag = res.validityFlag;
  return (
    <div className="fsa-results">
      <div className="fsa-eyebrow">Full Spectrum readout</div>
      <h2 className="fsa-name">{res.name || 'Your'} Profile</h2>
      <div className="fsa-label">{res.styleLabel} <span>· Drive {res.drive?.overall}/100</span></div>

      <div className="fsa-card">
        <div className="fsa-card-h">Style — DISC <span>natural · adaptive</span></div>
        {['D','I','S','C'].map(L => <Bar key={L} letter={L} adapt={a[L]} nat={n[L]} />)}
      </div>

      {flag && (
        <div className={`fsa-flag ${flag.type}`}>
          <div className="fsa-flag-h">{flag.type === 'aligned' ? '✓ ' : '⚠ '}{flag.headline}</div>
          <p>{flag.detail}</p>
        </div>
      )}

      <div className="fsa-card">
        <div className="fsa-card-h">Drive — Grit <span>{res.drive?.overall}/100 overall</span></div>
        {['E','R','D','F'].map(k => <DriveBar key={k} code={k} val={res.drive?.sub?.[k]} />)}
        {res.drive?.distortionHits >= 3 && <div className="fsa-distort">Self-awareness answers came back unusually flawless ({res.drive.distortionHits}/4) — read the Drive scores as a floor.</div>}
      </div>

      <div className="fsa-card">
        <div className="fsa-card-h">The read{res.readoutSource === "ai" ? <span>written by Prism · Claude</span> : null}</div>
        {String(res.readout || '').split('\n\n').map((p,i)=><p className="fsa-prose" key={i}>{p}</p>)}
      </div>

      <div className="fsa-card">
        <div className="fsa-card-h">Coaching priorities</div>
        {String(res.coaching || '').split('\n\n').map((blk,i)=>{
          const lines = blk.split('\n');
          return <div className="fsa-coach" key={i}><div className="fsa-coach-h">{lines[0]}</div><p className="fsa-prose">{lines.slice(1).join(' ')}</p></div>;
        })}
      </div>

      <div className="fsa-results-foot">
        <span className="fsa-saved">{saving ? 'Saving…' : res.taken_at ? `Saved ${new Date(res.taken_at).toLocaleDateString()}` : ''}</span>
        <button className="fsa-btn2" onClick={onRetake}><Icon name="refresh" size={13} /> Retake</button>
      </div>
    </div>
  );
}

/* ---------- Scoped styles ---------- */
function FsaStyles() {
  return <style>{`
  .fsa { height:100%; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; background:
    radial-gradient(ellipse at top, rgba(197,169,94,0.07) 0%, transparent 55%), var(--bg-base); }
  .fsa-wrap { max-width:680px; margin:0 auto; padding:18px 16px 96px; }
  .fsa-brand { display:flex; align-items:center; justify-content:space-between; padding:4px 0 16px; border-bottom:1px solid var(--border); margin-bottom:18px; }
  .fsa-mark { font-size:12px; letter-spacing:0.16em; font-weight:700; color:var(--accent); }
  .fsa-mark span { color:var(--text-3); font-weight:500; }
  .fsa-pill { font-size:11px; letter-spacing:0.08em; color:var(--text-3); text-transform:uppercase; font-variant-numeric:tabular-nums; }
  .fsa-progress { height:2px; background:var(--border); border-radius:1px; overflow:hidden; margin-bottom:28px; }
  .fsa-progress-fill { height:100%; background:linear-gradient(90deg,#9A8344,#D4BC75); transition:width .4s cubic-bezier(.4,0,.2,1); }
  .fsa-eyebrow { font-size:11px; letter-spacing:0.2em; text-transform:uppercase; color:var(--accent); margin-bottom:10px; }
  .fsa-intro h1 { font-size:clamp(32px,8vw,52px); line-height:1.02; letter-spacing:-0.02em; font-weight:700; color:var(--text-1); margin-bottom:6px; }
  .fsa-intro h1 em { font-style:italic; color:var(--accent); font-weight:500; }
  .fsa-lead { font-size:16px; line-height:1.55; color:var(--text-2); margin:22px 0; }
  .fsa-lead strong { color:var(--text-1); font-weight:600; }
  .fsa-meta { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; margin:26px 0; padding:16px 0; border-top:1px solid var(--border); border-bottom:1px solid var(--border); }
  .fsa-meta-l { font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:var(--text-3); margin-bottom:4px; }
  .fsa-meta-v { font-size:17px; font-weight:600; color:var(--text-1); }
  .fsa-meta-v span { color:var(--accent); }
  .fsa-field { margin:24px 0; }
  .fsa-field label { display:block; font-size:11px; letter-spacing:0.12em; text-transform:uppercase; color:var(--text-3); margin-bottom:8px; }
  .fsa-field input { width:100%; background:transparent; border:none; border-bottom:1px solid var(--border); color:var(--text-1); padding:8px 0; font-size:20px; outline:none; transition:border-color .2s; }
  .fsa-field input:focus { border-bottom-color:var(--accent); }
  .fsa-btn { display:inline-flex; align-items:center; gap:10px; background:var(--accent); color:#1a1a1a; border:none; padding:14px 26px; font-weight:700; font-size:13px; letter-spacing:0.1em; text-transform:uppercase; cursor:pointer; border-radius:10px; transition:all .2s; }
  .fsa-btn:hover { background:var(--accent-2,#d8bd78); }
  .fsa-btn:disabled { background:var(--border); color:var(--text-3); cursor:not-allowed; }
  .fsa-btn2 { display:inline-flex; align-items:center; gap:7px; background:transparent; color:var(--text-2); border:1px solid var(--border); padding:11px 18px; font-weight:600; font-size:12px; letter-spacing:0.06em; text-transform:uppercase; cursor:pointer; border-radius:10px; transition:all .2s; }
  .fsa-btn2:hover { border-color:var(--accent); color:var(--accent); }
  .fsa-arrow { font-size:16px; line-height:1; }
  .fsa-q-head { margin-bottom:24px; }
  .fsa-q-head h2 { font-size:28px; line-height:1.1; font-weight:700; color:var(--text-1); margin:8px 0; }
  .fsa-q-head p { font-size:14px; line-height:1.5; color:var(--text-2); }
  .fsa-frame { font-size:10px; letter-spacing:0.14em; text-transform:uppercase; color:var(--text-3); margin-bottom:14px; }
  .fsa-prompt { font-size:18px; line-height:1.45; color:var(--text-1); font-weight:600; margin-bottom:18px; }
  .fsa-tetrad-opts { display:flex; flex-direction:column; gap:10px; }
  .fsa-trow { display:flex; align-items:center; justify-content:space-between; gap:12px; background:var(--bg-card); border:1px solid var(--border); border-radius:12px; padding:12px 14px; }
  .fsa-word { font-size:16px; font-weight:600; color:var(--text-1); min-width:0; overflow-wrap:anywhere; }
  .fsa-picks { display:flex; gap:8px; flex-shrink:0; }
  .fsa-pick { background:transparent; border:1px solid var(--border); color:var(--text-3); padding:8px 12px; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; transition:all .15s; }
  .fsa-pick.most { background:rgba(94,199,140,0.16); border-color:#5EC78C; color:#5EC78C; }
  .fsa-pick.least { background:rgba(199,94,94,0.16); border-color:#C75E5E; color:#C75E5E; }
  .fsa-opts { display:flex; flex-direction:column; gap:10px; }
  .fsa-opt { text-align:left; background:var(--bg-card); border:1px solid var(--border); color:var(--text-1); padding:14px 16px; border-radius:12px; font-size:14px; line-height:1.45; cursor:pointer; transition:all .15s; }
  .fsa-opt:hover { border-color:var(--accent); }
  .fsa-opt.sel { background:rgba(197,169,94,0.12); border-color:var(--accent); color:var(--text-1); }
  .fsa-nav { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:26px; }
  .fsa-counter { font-size:12px; color:var(--text-3); font-variant-numeric:tabular-nums; }
  .fsa-loading { display:flex; flex-direction:column; align-items:center; gap:16px; padding:80px 0; color:var(--text-2); }
  .fsa-spinner { width:34px; height:34px; border:2px solid var(--border); border-top-color:var(--accent); border-radius:50%; animation:fsaspin 0.8s linear infinite; }
  @keyframes fsaspin { to { transform:rotate(360deg); } }
  .fsa-results h2.fsa-name { font-size:32px; font-weight:700; color:var(--text-1); margin:6px 0 4px; }
  .fsa-label { font-size:15px; color:var(--accent); font-weight:600; margin-bottom:22px; }
  .fsa-label span { color:var(--text-3); font-weight:500; }
  .fsa-card { background:var(--bg-card); border:1px solid var(--border); border-radius:16px; padding:18px; margin-bottom:16px; }
  .fsa-card-h { font-size:12px; letter-spacing:0.1em; text-transform:uppercase; color:var(--text-3); font-weight:700; margin-bottom:16px; display:flex; justify-content:space-between; align-items:baseline; }
  .fsa-card-h span { color:var(--text-3); font-weight:500; letter-spacing:0.04em; text-transform:none; }
  .fsa-bar { margin-bottom:16px; } .fsa-bar:last-child { margin-bottom:0; }
  .fsa-bar-top { display:flex; justify-content:space-between; align-items:baseline; margin-bottom:6px; }
  .fsa-bar-letter { font-size:13px; font-weight:600; color:var(--text-1); }
  .fsa-bar-nums { font-size:14px; font-weight:700; color:var(--accent); font-variant-numeric:tabular-nums; }
  .fsa-bar-nat { color:var(--text-3); font-weight:500; }
  .fsa-track { height:6px; background:var(--bg-base); border-radius:3px; overflow:hidden; margin-bottom:4px; }
  .fsa-fill { height:100%; border-radius:3px; transition:width .6s cubic-bezier(.4,0,.2,1); }
  .fsa-fill.adapt { background:linear-gradient(90deg,#9A8344,#D4BC75); }
  .fsa-fill.nat { background:var(--text-3); opacity:0.55; }
  .fsa-fill.drive { background:linear-gradient(90deg,#9A8344,#D4BC75); }
  .fsa-dbar { margin-bottom:14px; } .fsa-dbar:last-child { margin-bottom:0; }
  .fsa-flag { border-radius:14px; padding:16px; margin-bottom:16px; border:1px solid; }
  .fsa-flag.stress { background:rgba(199,94,94,0.10); border-color:#C75E5E; }
  .fsa-flag.coaching { background:rgba(197,169,94,0.10); border-color:var(--accent); }
  .fsa-flag.aligned { background:rgba(94,199,140,0.10); border-color:#5EC78C; }
  .fsa-flag-h { font-size:13px; font-weight:700; color:var(--text-1); margin-bottom:6px; }
  .fsa-flag p { font-size:13px; line-height:1.5; color:var(--text-2); }
  .fsa-distort { margin-top:12px; font-size:12px; line-height:1.5; color:#C75E5E; }
  .fsa-prose { font-size:14px; line-height:1.6; color:var(--text-2); margin-bottom:12px; } .fsa-prose:last-child { margin-bottom:0; }
  .fsa-coach { margin-bottom:14px; } .fsa-coach:last-child { margin-bottom:0; }
  .fsa-coach-h { font-size:13px; font-weight:700; color:var(--accent); margin-bottom:5px; }
  .fsa-results-foot { display:flex; align-items:center; justify-content:space-between; margin-top:8px; }
  .fsa-saved { font-size:12px; color:var(--text-3); }
  `}</style>;
}
