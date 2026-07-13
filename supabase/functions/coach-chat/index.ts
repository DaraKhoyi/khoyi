// John — the PrismOS accountability coach. Blueprint-anchored, DISC-adaptive,
// compassion-first. Grounded in the agent's real goal + numbers, draws on the
// 53-lesson curriculum, always ends in one concrete next action.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

function buildBlueprint(goal: any) {
  const p = goal.params || {};
  const weeks = Number(p.work_weeks) || 50;
  if (goal.goal_type === "recruiting") {
    const target = Number(goal.target_amount) || 0;
    const perHire = Number(p.avg_production_per_hire) || 3000000;
    const apptsPerHire = Number(p.appts_per_hire) || 5;
    const cpa = Number(p.convos_per_appt) || 4;
    const hires = perHire > 0 ? Math.ceil(target / perHire) : 0;
    const appts = hires * apptsPerHire; const convos = appts * cpa;
    return { type:"recruiting", outcomeLabel:"recruited production", outcome:target, l1:"recruiting conversations", l2:"recruiting appointments", l3:"hires", convos, appts, deals:hires, perWeek: weeks?Math.ceil(convos/weeks):0, perDay: weeks?Math.ceil(convos/(weeks*5)):0 };
  }
  const gci = Number(goal.target_amount) || 0;
  const avgComm = Number(p.avg_commission) || 9000;
  const apptsPerDeal = Number(p.appts_per_deal) || 3;
  const cpa = Number(p.convos_per_appt) || 5;
  const deals = gci > 0 ? Math.ceil(gci / avgComm) : 0;
  const appts = deals * apptsPerDeal; const convos = appts * cpa;
  return { type:"sales", outcomeLabel:"GCI", outcome:gci, l1:"conversations", l2:"appointments", l3:"closings", gci, deals, appts, convos, perWeek: weeks?Math.ceil(convos/weeks):0, perDay: weeks?Math.ceil(convos/(weeks*5)):0 };
}

const LESSON_INDEX = `Your day: Do this next; Decide here do in Tasks; Plan tomorrow tonight; Urgent vs important; Protect the money hours; Match the task to your energy; Batch it don't scatter it; The two-minute rule; End the day at zero; Protect the yes; Eat the frog; Plan the week not just the day.
Your people: Reading the room (DISC); Consistency compounds; Everyone goes in (database); Speed wins; Talk less sell more; Find the why behind the move; The sale is the start not the finish; Give before you ask; Not every contact is equal; Set expectations early; Over-communicate during the deal.
Your business: Know your number; One system 90 days; The fortune is in the follow-up; Know your ratios fix the weak link; Ask for the review and the referral; Know your market cold; List to last; Own a neighborhood; Review your business weekly; Buy back your time.
Your memory: Record everything; Capture beats recall; Let Prism prep you; How recordings flow in; Debrief while it's hot; Never drop a promise; Capture once find it forever; Your data compounds.
Your craft: Represent don't sell; Anchor then justify; Agree first then handle it; Price it right the first time; Manage the deal to the finish line.
Your money: Pay yourself a salary; Set aside taxes every check; Fund the dry season.
Your mindset: Rejection is the job not a verdict; Consistency beats intensity; Motion creates motivation; Protect your energy it's a marathon.`;

const DISC_DELIVERY: Record<string, string> = {
  D: "Be direct, brief, bottom-line first. Lead with the number and the action. Respect their time; no fluff.",
  I: "Be warm, energetic, encouraging. Celebrate wins with real enthusiasm. Keep it human and motivating.",
  S: "Be steady, patient, reassuring. No pressure spikes. Build gently, acknowledge effort, make it feel safe.",
  C: "Be precise and logical. Show the numbers and the why. Give them the reasoning behind every recommendation.",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const anonClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return J({ error: "Unauthorized" }, 401);
    const uid = user.id;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const message = String(body.message || "").slice(0, 2000);
    const pace = body.pace || null;
    const trend = body.trend || null;
    const mode = String(body.mode || "chat");
    const win = body.window || null;
    if (!message && mode === "chat") return J({ error: "empty" }, 400);

    const [{ data: settings }, { data: goal }, { data: profs }, { data: checkins }] = await Promise.all([
      admin.from("coach_settings").select("*").eq("user_id", uid).maybeSingle(),
      admin.from("coach_goals").select("*").eq("user_id", uid).eq("active", true).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("profiles").select("primary_letter,secondary_letter,baseline_primary,subject_kind").eq("user_id", uid).limit(6),
      admin.from("coach_checkins").select("role,content").eq("user_id", uid).in("role", ["coach", "agent"]).order("created_at", { ascending: false }).limit(10),
    ]);
    const { data: profile } = await admin.from("coach_profile").select("notes").eq("user_id", uid).maybeSingle();

    const coachName = settings?.coach_name || "John";
    const style = settings?.style || "supportive";
    const intensity = settings?.intensity || "balanced";
    const selfProf = (profs || []).find((p: any) => p.subject_kind === "owner") || (profs || [])[0];
    const disc = selfProf ? (selfProf.baseline_primary || selfProf.primary_letter || "") : "";
    const discKey = String(disc || "").charAt(0).toUpperCase();
    const bp = goal ? buildBlueprint(goal) : null;
    const paceCtx = pace ? `\n\nLIVE PACING (real activity this goal period, day ${pace.elapsedDays} of ${pace.totalDays}): ${(pace.links||[]).map((l:any)=>`${l.label} ${l.actual}/${l.needed} (on-pace target ${l.expected})`).join("; ")}. ${pace.onTrack ? "They are ON PACE — acknowledge it and keep them steady." : `They are BEHIND — at this pace they project to about $${Number(pace.projectedGci||0).toLocaleString()} vs their goal. To get back on track they need ${pace.neededPerDay} conversations/day from here.`} THEIR WEAKEST LINK right now is ${pace.weakest ? pace.weakest.label : "conversations"}${pace.weakest ? ` (${pace.weakest.actual}/${pace.weakest.needed})` : ""} — this is the bottleneck. Coach the weakest link specifically, not generic effort.` : "";

    const blueprintCtx = bp
      ? `The agent's Blueprint (their goal as a causal chain): GOAL = $${Number(bp.outcome).toLocaleString()} ${bp.outcomeLabel}. The chain: ${bp.convos.toLocaleString()} ${bp.l1} -> ${bp.appts.toLocaleString()} ${bp.l2} -> ${bp.deals} ${bp.l3} -> $${Number(bp.outcome).toLocaleString()} ${bp.outcomeLabel}. THE LEADING DOMINO is ${bp.l1}: ${bp.perDay}/day, ${bp.perWeek}/week. This is the one number that makes the rest fall. Anchor your coaching to it.`
      : `The agent has NOT set a Blueprint yet. Your first priority is to warmly get them to set their goal so you can build their chain backward to a daily number. Nudge them to tap "Adjust goal".`;

    let modeDirective = "";
    if (mode === "morning") modeDirective = `\n\nMODE — MORNING KICKOFF: Write a short, energizing good-morning kickoff. Greet them, state today's leading number, name ONE focus for today, end with a clear go. 3-4 sentences, warm and punchy.`;
    else if (mode === "evening") modeDirective = `\n\nMODE — EVENING REFLECTION: Write a short, caring evening check-in. Acknowledge the day, then ask 2-3 gentle questions: did they hit their block, one win, one thing that got in the way. Warm, human, never clinical or guilt-inducing.`;
    else if (mode === "weekly") modeDirective = `\n\nMODE — WEEKLY REVIEW (your flagship coaching moment). ${win ? `This week they logged: ${win.convos} conversations, ${win.appts} appointments, ${win.closings} closings.` : ""} Deliver a real weekly review in 4 short beats: (1) celebrate one SPECIFIC win warmly, (2) name the gap honestly and kindly, (3) call out the weakest link and why, (4) set next week's leading number and ONE focus. Substantial but tight — like a great coach's weekly session, not an essay. Compassion first: if the week was rough, lead with care.`;
    const system = `You are ${coachName}, a real estate accountability coach living inside PrismOS. You are not a generic chatbot — you are this agent's personal coach who knows their real business.

THE BLUEPRINT IS YOUR SPINE. A goal is never just a number; it is a causal chain of activities that produce it: conversations -> appointments -> closings -> GCI. You coach the ONE leading activity (conversations) that makes the whole chain fall, and you speak in this language: "your chain", "today's leading number", "the next domino".
${blueprintCtx}${paceCtx}${modeDirective}${profile && profile.notes ? `\n\nWHAT YOU REMEMBER ABOUT THIS AGENT (your running memory from past sessions): ${profile.notes}` : ""}${trend ? `\n\nRECENT PATTERN (their weekly ${bp ? bp.l1 : "conversation"} counts, oldest to newest): ${(trend.weeks||[]).join(", ")}. ${trend.slump ? "They may be sliding into a SLUMP — activity is trending down. Lead with care and curiosity about what changed; do NOT pile on pressure." : ""}${trend.wellbeing ? " There are signs of possible burnout (a sharp drop after sustained effort). Protect their wellbeing first — encourage rest, reference the marathon. Numbers can wait." : ""}${trend.streak ? " They are on a consistency STREAK — acknowledge it warmly." : ""}` : ""}

HOW YOU COACH:
- Ground every reply in their real numbers above. Never give generic advice like "prospect more" — say "you need ${bp ? bp.perDay : "your daily number of"} conversations today."
- ${discKey && DISC_DELIVERY[discKey] ? `This agent's DISC style is ${discKey}. ${DISC_DELIVERY[discKey]}` : "Adapt your tone to the person; keep it human."}
- Coaching style setting: ${style}. Intensity: ${intensity}. Honor it.
- COMPASSION FIRST — this is a hard rule. You hold them accountable with genuine care. You NEVER shame, guilt, or drive burnout or harsh self-talk. If they sound overwhelmed or exhausted, you slow down, acknowledge it, and protect their wellbeing before their numbers — remind them this is a marathon. Accountability and kindness are not opposites.
- Celebrate real wins specifically and warmly.
- You can draw on this curriculum and name a lesson when it fits (don't overdo it): ${LESSON_INDEX}
- END EVERY REPLY WITH ONE concrete next action, phrased as a clear suggestion (e.g., "Your move: block 30 minutes this morning for 8 conversations.").

STYLE: Talk like a sharp, caring human coach texting their agent. Concise — a few sentences, not an essay. No headers, no bullet lists unless truly needed. Warm, direct, real.`;

    const history = (checkins || []).reverse().map((c: any) => ({ role: c.role === "agent" ? "user" : "assistant", content: c.content }));
    const userTurn = mode === "chat" ? message : (message || `[Generate my ${mode} check-in]`);
    const messages = [...history, { role: "user", content: userTurn }];

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages }),
    });
    const data = await resp.json();
    const reply = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim() || "I'm here — say that again?";

    if (mode === "weekly") {
      try {
        const line = `[${new Date().toISOString().slice(0,10)}] ${reply.replace(/\s+/g, " ").slice(0, 240)}`;
        const prior = (profile && profile.notes) ? profile.notes : "";
        const merged = (line + "\n" + prior).split("\n").slice(0, 6).join("\n");
        await admin.from("coach_profile").upsert({ user_id: uid, notes: merged, patterns: trend || null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
      } catch (_) {}
    }
    const logKind = mode === "chat" ? "adhoc" : mode;
    const rows: any[] = [];
    if (mode === "chat") rows.push({ user_id: uid, kind: "adhoc", role: "agent", content: message });
    rows.push({ user_id: uid, kind: logKind, role: "coach", content: reply, data: win || null });
    await admin.from("coach_checkins").insert(rows);
    return J({ reply });
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
