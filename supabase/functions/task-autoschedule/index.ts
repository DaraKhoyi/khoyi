// task-autoschedule — deterministic auto-scheduler (Motion-style) for PrismOS
// Ranks auto-schedulable tasks, places them into working-hours gaps around
// existing calendar events, chunks long tasks, reschedules missed tasks, and
// writes task_block events that render inline on the calendar.
//
// Auth model (verify_jwt = false):
//   - service_role JWT  -> trusted; processes body.user_id, or ALL users if omitted (cron)
//   - user JWT          -> scoped to that user only (body.user_id ignored)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: {
    persistSession: false
  }
});
const HORIZON_DAYS = 45; // furthest out we place anything
const UNDATED_HORIZON_DAYS = 14; // window for tasks with no due date
const DAY_DOW = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat"
];
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function decodeJwt(token) {
  try {
    const p = token.split(".")[1];
    const json = atob(p.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch  {
    return null;
  }
}
// Convert a wall-clock time in `tz` to the correct UTC Date (DST-safe).
function zonedTimeToUtc(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = {};
  for (const p of fmt.formatToParts(new Date(guess)))parts[p.type] = p.value;
  const hh = parts.hour === "24" ? 0 : +parts.hour;
  const localAsUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, hh, +parts.minute);
  const offset = localAsUtc - guess;
  return new Date(guess - offset);
}
// Get local Y/M/D/dow for a UTC instant in tz.
function localParts(date, tz) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
  const parts = {};
  for (const p of fmt.formatToParts(date))parts[p.type] = p.value;
  return {
    y: +parts.year,
    mo: +parts.month,
    d: +parts.day,
    dow: parts.weekday.toLowerCase().slice(0, 3)
  };
}
function subtractBusy(free, busy) {
  let out = free.slice();
  for (const b of busy){
    const next = [];
    for (const f of out){
      if (b.end <= f.start || b.start >= f.end) {
        next.push(f);
        continue;
      }
      if (b.start > f.start) next.push({
        start: f.start,
        end: Math.min(b.start, f.end)
      });
      if (b.end < f.end) next.push({
        start: Math.max(b.end, f.start),
        end: f.end
      });
    }
    out = next.filter((i)=>i.end - i.start > 60_000); // drop sub-minute slivers
  }
  return out.sort((a, b)=>a.start - b.start);
}
function priorityWeight(t) {
  const p = (t.schedule_priority || t.priority || "medium").toLowerCase();
  if (p === "asap") return 0; // handled separately as override
  if (p === "high") return 300;
  if (p === "low") return 100;
  return 200; // medium
}
function rankScore(t, now) {
  let s = 0;
  const p = (t.schedule_priority || t.priority || "medium").toLowerCase();
  if (p === "asap") s += 1e9;
  if (t.is_hard_deadline) s += 1e7;
  if (t.due_date) {
    const due = new Date(t.due_date + "T23:59:59Z").getTime();
    const days = Math.max(0, (due - now) / 86_400_000);
    s += Math.max(0, 100_000 - days * 1000); // sooner = higher
  }
  s += priorityWeight(t);
  if (t.recurring) s += 25;
  s -= Math.min(50, (t.duration_minutes || 30) / 30); // tiny: shorts slot ahead of equals
  return s;
}
// Build free working-hour intervals for one user across the horizon.
function buildFreeIntervals(schedule, flexByDate, fromMs, toMs) {
  const tz = schedule.timezone || "America/New_York";
  const hours = schedule.hours || {};
  const free = [];
  // iterate local days from fromMs to toMs
  let cursor = new Date(fromMs);
  const end = new Date(toMs);
  // step day by day using local date
  for(let i = 0; i < HORIZON_DAYS + 2 && cursor.getTime() <= end.getTime(); i++){
    const lp = localParts(cursor, tz);
    const dateKey = `${lp.y}-${String(lp.mo).padStart(2, "0")}-${String(lp.d).padStart(2, "0")}`;
    let windows = (hours[lp.dow] || []).map((w)=>[
        w[0],
        w[1]
      ]);
    // apply flexible-hours rules for this date
    const rules = flexByDate[dateKey] || [];
    for (const r of rules){
      if (r.type === "block_day") windows = [];
      else if (r.type === "start_later" && r.time) {
        const hStart = parseInt(r.time.split(":")[0]) + parseInt(r.time.split(":")[1] || "0") / 60;
        windows = windows.map((w)=>[
            Math.max(w[0], hStart),
            w[1]
          ]).filter((w)=>w[1] > w[0]);
      } else if (r.type === "stop_early" && r.time) {
        const hEnd = parseInt(r.time.split(":")[0]) + parseInt(r.time.split(":")[1] || "0") / 60;
        windows = windows.map((w)=>[
            w[0],
            Math.min(w[1], hEnd)
          ]).filter((w)=>w[1] > w[0]);
      }
    }
    // build this day's free intervals locally, then subtract any "block" rules
    let dayFree = [];
    for (const w of windows){
      const sH = Math.floor(w[0]);
      const sM = Math.round((w[0] - sH) * 60);
      const eH = Math.floor(w[1]);
      const eM = Math.round((w[1] - eH) * 60);
      let s = zonedTimeToUtc(lp.y, lp.mo, lp.d, sH, sM, tz).getTime();
      let e = zonedTimeToUtc(lp.y, lp.mo, lp.d, eH, eM, tz).getTime();
      s = Math.max(s, fromMs);
      e = Math.min(e, toMs);
      if (e > s) dayFree.push({
        start: s,
        end: e
      });
    }
    const blocks = [];
    for (const r of rules){
      if (r.type === "block" && r.start && r.end) {
        const [bsH, bsM] = r.start.split(":").map(Number);
        const [beH, beM] = r.end.split(":").map(Number);
        blocks.push({
          start: zonedTimeToUtc(lp.y, lp.mo, lp.d, bsH, bsM || 0, tz).getTime(),
          end: zonedTimeToUtc(lp.y, lp.mo, lp.d, beH, beM || 0, tz).getTime()
        });
      }
    }
    if (blocks.length) dayFree = subtractBusy(dayFree, blocks);
    for (const iv of dayFree)free.push(iv);
    // advance one local day
    cursor = new Date(zonedTimeToUtc(lp.y, lp.mo, lp.d, 12, 0, tz).getTime() + 24 * 3600_000);
  }
  return free.sort((a, b)=>a.start - b.start);
}
async function scheduleUser(userId, now) {
  // Respect the per-user "Auto-schedule tasks on calendar" setting (default ON).
  // When OFF, clear any existing auto-scheduled blocks and do nothing else.
  try {
    const { data: us } = await admin.from("user_settings").select("auto_schedule_tasks").eq("user_id", userId).maybeSingle();
    if (us && us.auto_schedule_tasks === false) {
      await admin.from("events").delete().eq("user_id", userId).eq("event_kind", "task_block");
      return { user_id: userId, scheduled_tasks: 0, blocks_written: 0, skipped: "auto_schedule_off" };
    }
  } catch (_e) { /* if the check fails, default to scheduling */ }
  // load default schedule
  const { data: scheds } = await admin.from("schedules").select("*").eq("user_id", userId);
  let defaultSched = (scheds || []).find((s)=>s.is_default) || (scheds || [])[0];
  if (!defaultSched) {
    // auto-provision a sane default so the feature works out of the box
    const { data: created } = await admin.from("schedules").insert({
      user_id: userId,
      name: "Work hours",
      is_default: true,
      hours: {
        mon: [
          [
            9,
            17
          ]
        ],
        tue: [
          [
            9,
            17
          ]
        ],
        wed: [
          [
            9,
            17
          ]
        ],
        thu: [
          [
            9,
            17
          ]
        ],
        fri: [
          [
            9,
            17
          ]
        ]
      },
      timezone: "America/New_York"
    }).select().single();
    defaultSched = created;
  }
  const schedById = {};
  for (const s of scheds || [])schedById[s.id] = s;
  if (defaultSched) schedById[defaultSched.id] = defaultSched;
  // Standard gap kept around real calendar appointments (default 30 min).
  const bufferMs = Math.max(0, defaultSched?.buffer_minutes ?? 30) * 60000;
  // load tasks — exclude completed (boolean) AND status-based done/rejected
  // (project-tracker tasks complete via status, personal tasks via the boolean)
  const { data: rawTasks } = await admin.from("tasks").select("*").eq("user_id", userId).eq("completed", false);
  const allTasks = (rawTasks || []).filter((t)=>t.status !== "done" && t.status !== "rejected");
  const schedTasks = allTasks.filter((t)=>t.auto_schedule && t.duration_minutes && t.duration_minutes > 0);
  // CLEANUP: remove task_block events whose task is done / no longer auto-scheduled / deleted
  const liveTaskIds = new Set(schedTasks.map((t)=>t.id));
  const { data: existingBlocks } = await admin.from("events").select("id,task_id,start_at,end_at").eq("user_id", userId).eq("event_kind", "task_block");
  const staleBlockIds = (existingBlocks || []).filter((b)=>!b.task_id || !liveTaskIds.has(b.task_id)).map((b)=>b.id);
  if (staleBlockIds.length) await admin.from("events").delete().in("id", staleBlockIds);
  // pinned tasks keep their blocks; unpinned get regenerated
  const pinned = schedTasks.filter((t)=>t.pin_at);
  const unpinned = schedTasks.filter((t)=>!t.pin_at);
  // delete future blocks for unpinned tasks (regenerate). keep past blocks history-free: delete all their blocks.
  const unpinnedIds = unpinned.map((t)=>t.id);
  if (unpinnedIds.length) {
    await admin.from("events").delete().eq("user_id", userId).eq("event_kind", "task_block").in("task_id", unpinnedIds);
  }
  // BUSY: all non-task_block events in horizon + pinned task blocks
  const horizonEnd = now + HORIZON_DAYS * 86_400_000;
  const { data: obstacles } = await admin.from("events").select("start_at,end_at,event_kind,all_day,task_id").eq("user_id", userId).lte("start_at", new Date(horizonEnd).toISOString()).gte("start_at", new Date(now - 86_400_000).toISOString());
  const busy = [];
  const pinnedWithBlock = new Set();
  for (const e of obstacles || []){
    if (e.all_day) continue; // all-day events don't block hour slots
    if (e.event_kind === "task_block" && (!e.task_id || unpinnedIds.includes(e.task_id))) continue; // being regenerated
    if (e.event_kind === "task_block" && e.task_id) pinnedWithBlock.add(e.task_id);
    const s = new Date(e.start_at).getTime();
    const en = e.end_at ? new Date(e.end_at).getTime() : s + 3600_000;
    // Keep a buffer around real calendar appointments (meetings) so tasks aren't
    // scheduled flush against them. Task blocks themselves may sit back-to-back.
    if (e.event_kind !== "task_block") busy.push({
      start: s - bufferMs,
      end: en + bufferMs
    });
    else busy.push({
      start: s,
      end: en
    });
  }
  // flexible hours
  const { data: flex } = await admin.from("flexible_hours").select("*").eq("user_id", userId).gte("date", new Date(now - 86_400_000).toISOString().slice(0, 10));
  const flexByDate = {};
  for (const f of flex || [])flexByDate[f.date] = f.rules || [];
  // Pinned tasks: their real blocks are already in `busy` above. Only reserve a
  // synthetic interval if a pinned task somehow has no surviving block.
  for (const t of pinned){
    if (pinnedWithBlock.has(t.id)) continue;
    const s = new Date(t.pin_at).getTime();
    busy.push({
      start: s,
      end: s + (t.duration_minutes || 30) * 60000
    });
  }
  // rank unpinned
  const ranked = unpinned.slice().sort((a, b)=>rankScore(b, now) - rankScore(a, now));
  const blockRows = [];
  const taskUpdates = [];
  const placedBusy = busy.slice();
  for (const t of ranked){
    const sched = t.schedule_id && schedById[t.schedule_id] || defaultSched;
    const startFloor = Math.max(now, t.schedule_start_date ? new Date(t.schedule_start_date + "T00:00:00Z").getTime() : 0);
    const isHard = !!(t.is_hard_deadline && t.due_date);
    const dueMs = t.due_date ? new Date(t.due_date + "T23:59:59Z").getTime() : null;
    // Hard deadlines constrain the window (must finish before due). Soft/undated
    // tasks can be placed anywhere in the horizon — the due date only affects
    // ranking — so past-due and soon-due tasks get scheduled ASAP, not dropped.
    const windowEnd = isHard ? Math.min(dueMs, horizonEnd) : horizonEnd;
    let free = buildFreeIntervals(sched, flexByDate, startFloor, windowEnd);
    free = subtractBusy(free, placedBusy);
    const durMs = t.duration_minutes * 60000;
    const chunkable = !!(t.min_chunk_minutes && t.min_chunk_minutes > 0);
    const chunkMs = chunkable ? Math.max(15, t.min_chunk_minutes) * 60000 : durMs;
    let remaining = durMs;
    const placements = [];
    if (!chunkable) {
      // single contiguous block: first slot that fits the whole duration
      for (const slot of free){
        if (slot.end - slot.start >= durMs) {
          placements.push({
            start: slot.start,
            end: slot.start + durMs
          });
          remaining = 0;
          break;
        }
      }
    } else {
      // chunked: fill greedily in chunk-sized pieces across slots
      for (const slot of free){
        if (remaining <= 0) break;
        let slotStart = slot.start;
        while(remaining > 0 && slotStart < slot.end){
          const want = Math.min(remaining, chunkMs);
          const avail = slot.end - slotStart;
          if (avail < Math.min(want, 15 * 60000)) break; // too small to bother
          const take = Math.min(want, avail);
          placements.push({
            start: slotStart,
            end: slotStart + take
          });
          slotStart += take;
          remaining -= take;
        }
      }
    }
    // hard-deadline override: place outside working hours, before due, if still unmet
    if (remaining > 0 && t.is_hard_deadline && t.due_date) {
      const lastBusy = placements.length ? placements[placements.length - 1].end : startFloor;
      let cur = Math.max(lastBusy, now);
      const overrideFree = subtractBusy([
        {
          start: cur,
          end: dueMs
        }
      ], placedBusy);
      for (const slot of overrideFree){
        if (remaining <= 0) break;
        const take = Math.min(remaining, slot.end - slot.start);
        if (take < 15 * 60000) continue;
        placements.push({
          start: slot.start,
          end: slot.start + take
        });
        remaining -= take;
      }
    }
    if (remaining > 0 || placements.length === 0) {
      let reason;
      if (placements.length === 0 && !chunkable) {
        reason = "No single open block long enough — turn on 'split into chunks' or shorten the estimate";
      } else if (placements.length === 0) {
        reason = t.due_date ? "No free working-hours slot before the deadline" : "No free working-hours slot in horizon";
      } else {
        reason = "Only partially fit before the deadline";
      }
      taskUpdates.push({
        id: t.id,
        schedule_state: "could_not_fit",
        eta: null,
        last_scheduled_at: new Date(now).toISOString(),
        could_not_fit_reason: reason
      });
    // still emit whatever partial placements we made so the user sees progress
    } else {
      taskUpdates.push({
        id: t.id,
        schedule_state: "scheduled",
        eta: new Date(placements[placements.length - 1].end).toISOString(),
        last_scheduled_at: new Date(now).toISOString(),
        could_not_fit_reason: null
      });
    }
    const total = placements.length;
    placements.forEach((p, idx)=>{
      placedBusy.push(p);
      const overdue = p.end < now;
      blockRows.push({
        user_id: userId,
        title: t.title,
        start_at: new Date(p.start).toISOString(),
        end_at: new Date(p.end).toISOString(),
        all_day: false,
        event_kind: "task_block",
        task_id: t.id,
        category: overdue ? "task_overdue" : "task",
        color: overdue ? "#ef4444" : "#C5A95E",
        description: total > 1 ? `Auto-scheduled · part ${idx + 1} of ${total}` : "Auto-scheduled",
        sync_status: sched?.mirror_to_google ? "pending_push" : "local",
        status: "confirmed"
      });
    });
    placedBusy.sort((a, b)=>a.start - b.start);
  }
  // write blocks
  if (blockRows.length) await admin.from("events").insert(blockRows);
  // write task updates (one by one — small N)
  for (const u of taskUpdates){
    const { id, ...fields } = u;
    await admin.from("tasks").update(fields).eq("id", id);
  }
  // tasks that were auto_schedule but excluded (no duration) -> mark unscheduled w/ reason
  const noDuration = (allTasks || []).filter((t)=>t.auto_schedule && (!t.duration_minutes || t.duration_minutes <= 0));
  for (const t of noDuration){
    await admin.from("tasks").update({
      schedule_state: "could_not_fit",
      could_not_fit_reason: "Set an estimated duration to schedule this task",
      last_scheduled_at: new Date(now).toISOString()
    }).eq("id", t.id);
  }
  return {
    user_id: userId,
    scheduled_tasks: schedTasks.length,
    blocks_written: blockRows.length,
    could_not_fit: taskUpdates.filter((u)=>u.schedule_state === "could_not_fit").length
  };
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  try {
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    const claims = decodeJwt(token);
    if (!claims) return new Response(JSON.stringify({
      error: "unauthorized"
    }), {
      status: 401,
      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    });
    const isService = claims.role === "service_role";
    let body = {};
    try {
      body = await req.json();
    } catch  {}
    const now = Date.now();
    let targets;
    if (isService) {
      if (body.user_id) targets = [
        body.user_id
      ];
      else {
        const { data } = await admin.from("tasks").select("user_id").eq("auto_schedule", true).eq("completed", false);
        targets = [
          ...new Set((data || []).map((r)=>r.user_id))
        ];
      }
    } else {
      if (!claims.sub) return new Response(JSON.stringify({
        error: "no subject"
      }), {
        status: 401,
        headers: {
          ...cors,
          "Content-Type": "application/json"
        }
      });
      targets = [
        claims.sub
      ]; // user-scoped: ignore body.user_id
    }
    const results = [];
    for (const uid of targets)results.push(await scheduleUser(uid, now));
    return new Response(JSON.stringify({
      ok: true,
      ran: results.length,
      results
    }), {
      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    });
  } catch (e) {
    return new Response(JSON.stringify({
      error: String(e)
    }), {
      status: 500,
      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    });
  }
});