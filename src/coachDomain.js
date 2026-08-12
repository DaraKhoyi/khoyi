// coachDomain — the behaviour-driven coaching engine.
// Extracted from App.js (strangle the monolith, step 24). Pure logic + constants
// shared by CoachNudge (the dashboard nudge) and CoachView (the Coach screen);
// no JSX lives here. coachSeen/coachLast read localStorage and stay module-level,
// exactly as they were in App.js, so pacing behaviour is unchanged.

// ── Phase 4: behavior-driven coaching ──────────────────────────────
// Reads the agent's real data, finds one meaningful gap, teaches the why,
// offers a one-tap fix. Paced: at most one nudge per 2 days, and a given
// nudge won't repeat for 5 days (or until the gap closes on its own).
export const COACH_GLOBAL_GAP = 48 * 60 * 60 * 1000;
export const COACH_COOLDOWN = 5 * 24 * 60 * 60 * 1000;
export function coachSeen(){ try { return JSON.parse(localStorage.getItem('prism_coach_seen') || '{}'); } catch(_){ return {}; } }
export function coachLast(){ try { return parseInt(localStorage.getItem('prism_coach_last') || '0', 10) || 0; } catch(_){ return 0; } }
export function coachLastTouch(c){ const a = [c.last_contact_at, c.last_inbound_at, c.last_outbound_at].filter(Boolean).map(t => new Date(t).getTime()); return a.length ? Math.max(...a) : null; }

export const BEHAVIORS = [
  { id:'going_cold', priority:6, view:'contacts', min:8,
    test:(x)=>{ const n=Date.now(); return x.contacts.filter(c=>{ const t=coachLastTouch(c); return t && (n - t) > 75*86400000; }).length; },
    title:(x)=>{ const n=Date.now(); const c=x.contacts.filter(cc=>{ const t=coachLastTouch(cc); return t && (n - t) > 75*86400000; }).length; return c + ' people haven\'t heard from you in months'; },
    why:'The deal goes to whoever is top-of-mind the moment someone decides to move — not the best agent, the remembered one. A quick, genuine touch now keeps a warm relationship from quietly going cold on you.',
    cta:'See who\'s cold' },
  { id:'cadence_gap', priority:5, view:'contacts', min:1,
    test:(x)=>{ const total=x.contacts.length; const cad=x.contacts.filter(c=>c.cadence_days).length; return (total >= 15 && cad < Math.max(3, Math.round(total*0.1))) ? 1 : 0; },
    title:()=>'Most of your contacts have no cadence',
    why:'A cadence turns a name in your phone into a relationship that sends referrals. Set one on your key people and Prism reminds you when it\'s time to reach out — so staying top-of-mind runs on rhythm instead of memory.',
    cta:'Set cadences' },
  { id:'review_backlog', priority:7, view:'review', min:4,
    test:(x)=> x.reviewCount || 0,
    title:(x)=> x.reviewCount + ' items are waiting in Review',
    why:'Review is where recordings get labeled and suggested to-dos get confirmed. Let it stack up and Prism can\'t research the people you met or surface the right next step. Two minutes clearing it keeps the whole engine sharp.',
    cta:'Clear Review' },
  { id:'owe_replies', priority:8, view:'contacts', min:4,
    test:(x)=> Object.keys(x.oweReplyMap || {}).length,
    title:(x)=> 'You owe ' + Object.keys(x.oweReplyMap || {}).length + ' people a reply',
    why:'Speed is the cheapest edge in this business — the first agent to respond usually wins. When people are left waiting, some go find someone who answers. Knock these out and protect the deals sitting inside them.',
    cta:'See who\'s waiting' },
  { id:'overdue_tasks', priority:4, view:'tasks', min:6,
    test:(x)=>{ const t=new Date().toISOString().slice(0,10); return x.tasks.filter(tk=>!tk.completed && tk.due_date && tk.due_date < t).length; },
    title:(x)=>{ const t=new Date().toISOString().slice(0,10); return x.tasks.filter(tk=>!tk.completed && tk.due_date && tk.due_date < t).length + ' tasks are past due'; },
    why:'A task list you don\'t trust is a list you stop looking at. When overdue items pile up, reschedule or clear them so the list reflects reality again — a clean list is one you\'ll actually work.',
    cta:'Review tasks' },
];

export const TRIGGER_TEMPLATES = {
  cold_contacts: { defaultView:'contacts', test:(x,t)=>{ const n=Date.now(); return x.contacts.filter(c=>{ const ts=coachLastTouch(c); return ts && (n-ts) > ((t.days||75))*86400000; }).length; } },
  no_cadence:    { defaultView:'contacts', test:(x,t)=>{ const total=x.contacts.length; const cad=x.contacts.filter(c=>c.cadence_days).length; return (total >= (t.threshold||15) && cad < Math.max(3, Math.round(total*0.1))) ? 1 : 0; } },
  review_backlog:{ defaultView:'review', test:(x)=> x.reviewCount || 0 },
  owe_replies:   { defaultView:'contacts', test:(x)=> Object.keys(x.oweReplyMap||{}).length },
  overdue_tasks: { defaultView:'tasks', test:(x)=>{ const d=new Date().toISOString().slice(0,10); return x.tasks.filter(tk=>!tk.completed && tk.due_date && tk.due_date < d).length; } },
};

export function buildBlueprint(goal){
  if (!goal) return null;
  if (goal.goal_type === 'recruiting') return buildRecruitingBlueprint(goal);
  return buildSalesBlueprint(goal);
}
export function buildSalesBlueprint(goal){
  const p = goal.params || {};
  const gci = Number(goal.target_amount) || 0;
  const avgComm = Number(p.avg_commission) || 9000;
  const apptsPerDeal = Number(p.appts_per_deal) || 3;
  const convosPerAppt = Number(p.convos_per_appt) || 5;
  const weeks = Number(p.work_weeks) || 50;
  const deals = gci > 0 ? Math.ceil(gci / avgComm) : 0;
  const appts = deals * apptsPerDeal;
  const convos = appts * convosPerAppt;
  return {
    outcome: { label: goal.outcome_label || 'GCI', amount: gci, isMoney: true },
    links: [
      { key:'conversations', label:'Conversations', needed: convos, leading: true },
      { key:'appointments',  label:'Appointments',  needed: appts },
      { key:'closings',      label:'Closings',      needed: deals },
    ],
    leading: { metric:'conversations', label:'conversations', total: convos, perWeek: weeks ? Math.ceil(convos / weeks) : 0, perDay: weeks ? Math.ceil(convos / (weeks * 5)) : 0 },
    ratios: { avgComm, apptsPerDeal, convosPerAppt, weeks },
  };
}
// ── Pace: plan vs. reality ───────────────────────────────────────────────────
// Referenced at the Coach screen but never written, and the call sits inside a
// bare try/catch — so setPace() never ran, `pace &&` was always falsy, and the
// entire actual-vs-plan half of Coach silently rendered nothing. It failed
// quietly instead of loudly, which is exactly why it went unnoticed.
//
// Returns null when it cannot say anything honest, so callers keep their
// plan-only rendering rather than showing invented numbers.
export function computePace(goal, bp, actuals) {
  if (!goal || !bp || !bp.links || !bp.links.length) return null;
  const DAY = 86400000;
  const start = new Date(goal.start_date || goal.created_at || Date.now());
  if (isNaN(start.getTime())) return null;
  const weeks = (bp.ratios && bp.ratios.weeks) || 50;
  const end = goal.end_date ? new Date(goal.end_date) : new Date(start.getTime() + weeks * 7 * DAY);
  const totalDays = Math.max(1, Math.round((end - start) / DAY));
  // Clamp both ends: before the start there is no pace, after the end the goal
  // is simply over — neither should produce a divide-by-zero or a >100% "pace".
  const elapsedDays = Math.min(totalDays, Math.max(1, Math.round((Date.now() - start.getTime()) / DAY)));
  const through = elapsedDays / totalDays;

  const actualFor = { conversations: Number(actuals?.convos) || 0,
                      appointments:  Number(actuals?.appts) || 0,
                      closings:      Number(actuals?.closings) || 0 };
  const links = bp.links.map(l => {
    const actual = actualFor[l.key] || 0;
    const expected = Math.round((Number(l.needed) || 0) * through);
    // With nothing expected yet, you cannot be behind. Ratio 1 = exactly on plan.
    const paceRatio = expected > 0 ? actual / expected : 1;
    return { ...l, actual, expected, paceRatio };
  });

  // The weakest link is the lowest ratio — but a link is only judged once the
  // plan meaningfully expects something of it. On day one the plan expects ~1
  // conversation, and telling someone they are "1 behind" before they have had
  // their coffee is technically true and completely useless.
  const JUDGE_FLOOR = 3;
  const judged = links.filter(l => l.expected >= JUDGE_FLOOR);
  const tooEarly = judged.length === 0;
  const weakest = (judged.length ? judged : links).reduce((a, b) => (b.paceRatio < a.paceRatio ? b : a));

  // Project from the LEADING metric, not from closed GCI. Commission arrives
  // months after the conversation that caused it, so extrapolating closings in
  // month two reads as catastrophe no matter how well someone is working.
  const r = bp.ratios || {};
  const perDeal = (Number(r.convosPerAppt) || 5) * (Number(r.apptsPerDeal) || 3);
  const avgComm = Number(r.avgComm) || 9000;
  const convos = actualFor.conversations;
  const projectedConvos = elapsedDays > 0 ? (convos / elapsedDays) * totalDays : 0;
  const projectedGci = perDeal > 0 ? Math.round((projectedConvos / perDeal) * avgComm) : 0;

  const target = Number(bp.outcome && bp.outcome.amount) || 0;
  const onTrack = target <= 0 ? true : projectedGci >= target * 0.98;

  // What it takes from HERE — over remaining WORK days, not calendar days.
  const neededTotal = Number((bp.links[0] || {}).needed) || 0;
  const remainingConvos = Math.max(0, neededTotal - convos);
  const daysLeft = totalDays - elapsedDays;
  const finished = daysLeft <= 0;
  const remainingWorkDays = Math.max(1, Math.round(daysLeft * 5 / 7));
  // A finished goal has no catch-up rate. Demanding "55/day from here" when the
  // period already ended is worse than saying nothing.
  const neededPerDay = finished ? 0 : Math.ceil(remainingConvos / remainingWorkDays);

  // One status the UI branches on. Deriving this in the render from three
  // separate booleans is how "0 conversations today to get back on track"
  // happens on a goal whose period already ended.
  const status = finished ? 'finished' : tooEarly ? 'early' : onTrack ? 'ontrack' : 'behind';

  return {
    onTrack, projectedGci, neededPerDay, elapsedDays, totalDays, status,
    gciActual: Number(actuals?.gciActual) || 0,
    links, weakest, tooEarly, finished,
  };
}

// Names the one link to fix, and says why in the agent's own terms. Every branch
// returns a title AND a why — the caller renders both unconditionally.
export function weakestLinkCoaching(pace) {
  const w = (pace && pace.weakest) || null;
  if (!w) return { title: 'Not enough data yet', why: 'Once a few weeks of activity are logged, this will name the single link costing you the most.' };
  if (pace.finished) {
    return { title: 'This goal period has ended',
      why: 'The window for this goal is closed, so there is no catch-up pace left to set. Start a fresh goal and the chain will begin measuring again from day one.' };
  }
  if (pace.tooEarly) {
    return { title: 'Too early to call anything weak',
      why: 'The plan barely expects anything of you yet, so any gap right now is noise rather than a signal. Keep the daily conversation block and this will start naming a real weakest link within a couple of weeks.' };
  }
  const behind = w.paceRatio < 0.95;
  const short = Math.max(0, (w.expected || 0) - (w.actual || 0));

  if (!behind) {
    return {
      title: 'Nothing is lagging — protect the rhythm',
      why: 'Every link is at or ahead of plan. The risk now is not a weak step, it is a good week that quietly becomes a slow one. Keep the daily conversation block untouchable.',
    };
  }
  const copy = {
    conversations: {
      title: 'You are not talking to enough people',
      why: `You are ${short} conversation${short === 1 ? '' : 's'} behind where the plan says you should be. This is the only link you fully control — appointments and closings are downstream of it, so nothing else can be fixed until this one is.`,
    },
    appointments: {
      title: 'Conversations are not turning into appointments',
      why: `You are ${short} appointment${short === 1 ? '' : 's'} short. The volume is happening but the ask is not landing — that is usually a matter of asking directly for a specific time rather than leaving it open.`,
    },
    closings: {
      title: 'Appointments are not turning into closings',
      // Closings are the one link measured from a table the user has to keep
      // up by hand. Diagnosing a sales problem when the real problem is an
      // empty Deals tab would be a confident, wrong, and demoralising call.
      why: `You are ${short} closing${short === 1 ? '' : 's'} behind. Appointments are being set, so the gap is in what happens inside them — qualification, follow-through, or paperwork stalling after the yes.`
        + (w.actual <= 1 ? ' Worth checking first: this counts closed deals recorded in Deals, so if closings are not being logged there, this is a bookkeeping gap rather than a selling one.' : ''),
    },
  };
  return copy[w.key] || {
    title: `${w.label} is your weakest link`,
    why: `${w.label} is running behind plan — ${w.actual} against ${w.expected} expected by now.`,
  };
}

// Placeholder so the engine is pluggable; recruiting chain gets built when goal types expand.
export async function computeCoachTrend(userId){
  try {
    const since = new Date(Date.now() - 56 * 86400000).toISOString();
    const { data } = await supabase.from('contact_interactions').select('occurred_at').eq('user_id', userId).in('kind', ['call','meeting']).gte('occurred_at', since).limit(5000);
    const now = Date.now();
    const weeks = new Array(8).fill(0);
    (data || []).forEach(r => { const t = new Date(r.occurred_at).getTime(); const wk = Math.floor((now - t) / (7 * 86400000)); if (wk >= 0 && wk < 8) weeks[7 - wk]++; });
    const avg = weeks.slice(0, 7).reduce((a, b) => a + b, 0) / 7 || 0;
    const last = weeks[7], prev = weeks[6], prev2 = weeks[5];
    const slump = avg > 2 && last < avg * 0.6 && last <= prev && prev <= prev2;
    const streak = avg > 2 && weeks.slice(5, 8).every(v => v >= avg * 0.9);
    const priorHigh = (weeks[4] + weeks[5] + weeks[6]) / 3;
    const wellbeing = priorHigh > avg * 1.3 && last < priorHigh * 0.4;
    let insight = null;
    if (wellbeing) insight = { kind:'wellbeing', title:'You’ve been going hard — check in with yourself', body:'Your activity spiked and then dropped off sharply. That pattern often means you’re running on fumes. This is a marathon — a real rest day now protects the whole season.' };
    else if (slump) insight = { kind:'slump', title:'Your conversations have been sliding', body:'The last couple of weeks have trended down. It happens to everyone — the fix is small and early. Let’s figure out what changed and get one good block back on the board.' };
    else if (streak) insight = { kind:'streak', title:'You’re on a streak', body:'Three steady weeks of conversations — this is exactly how pipelines get built. Consistency compounding. Keep the rhythm going.' };
    return { weeks, avg: Math.round(avg * 10) / 10, slump, streak, wellbeing, insight };
  } catch(_){ return null; }
}

export function buildRecruitingBlueprint(goal){
  const p = goal.params || {};
  const target = Number(goal.target_amount) || 0;
  const perHire = Number(p.avg_production_per_hire) || 3000000;
  const apptsPerHire = Number(p.appts_per_hire) || 5;
  const convosPerAppt = Number(p.convos_per_appt) || 4;
  const weeks = Number(p.work_weeks) || 50;
  const hires = perHire > 0 ? Math.ceil(target / perHire) : 0;
  const appts = hires * apptsPerHire;
  const convos = appts * convosPerAppt;
  return {
    outcome: { label: goal.outcome_label || 'Recruited production', amount: target, isMoney: true },
    links: [
      { key:'conversations', label:'Recruiting conversations', needed: convos, leading: true },
      { key:'appointments',  label:'Recruiting appointments',  needed: appts },
      { key:'closings',      label:'Hires',                    needed: hires },
    ],
    leading: { metric:'conversations', label:'recruiting conversations', total: convos, perWeek: weeks ? Math.ceil(convos / weeks) : 0, perDay: weeks ? Math.ceil(convos / (weeks * 5)) : 0 },
    ratios: { avgComm: perHire, apptsPerDeal: apptsPerHire, convosPerAppt, weeks },
  };
}

