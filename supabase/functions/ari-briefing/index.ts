import "../_shared/aiGuard.ts";   // no SSN, tax ID, card or bank number reaches an AI model (30 Sep)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";
import { isImpersonatedRequest, supportSessionResponse } from "../_shared/impersonation.ts";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON = Deno.env.get("SUPABASE_ANON_KEY");
const DISC_LABEL = {
  D: "Driver — direct, results-first, values brevity and the bottom line",
  I: "Influencer — warm, social, energized by enthusiasm and people",
  S: "Steady — patient, relationship-first, values reassurance and low pressure",
  C: "Conscientious — precise, analytical, values data, accuracy, and detail"
};
function normAddr(v) {
  if (!v) return [];
  const arr = Array.isArray(v) ? v : [
    v
  ];
  return arr.map((x)=>{
    if (typeof x === "string") return x;
    if (x && typeof x === "object") return x.name ? `${x.name} <${x.email || x.address || ""}>` : x.email || x.address || "";
    return String(x);
  }).filter(Boolean);
}
function daysSince(ts) {
  if (!ts) return null;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
}
async function draftWithClaude(voice, candidates, insights) {
  const voiceBlock = voice ? `The agent's writing voice:\n- Persona: ${voice.persona_summary || voice.name || "warm, professional"}\n${(voice.do_examples || []).length ? "- Do: " + (voice.do_examples || []).join("; ") + "\n" : ""}${(voice.dont_examples || []).length ? "- Don't: " + (voice.dont_examples || []).join("; ") + "\n" : ""}${voice.body ? "- Notes: " + String(voice.body).slice(0, 600) + "\n" : ""}` : "The agent's voice is warm, concise, and personable.";
  const list = candidates.map((c, i)=>{
    let line = `${i + 1}. id=${c.id} | ${c.name} | reason: ${c.reason} | behavioral style: ${c.discLabel || "unknown"} | last touch: ${c.lastTouch}`;
    if (c.source && c.source.text) {
      const k = c.source.label === "Their message" || c.source.label === "Their last message" ? "MESSAGE YOU ARE RESPONDING TO" : "context";
      line += ` | ${k}: "${String(c.source.text).slice(0, 500)}"`;
    } else if (c.context) {
      line += ` | context: ${c.context}`;
    }
    return line;
  }).join("\n");
  const sys = "You are Ari, the AI partner inside a real estate agent's platform. You write outreach messages in the AGENT'S voice, adapted to each CONTACT'S behavioral style. " + "Messages must be short (2-4 sentences), specific to the reason for reaching out, natural, never salesy or templated, and ready to send as-is. Adapt tone to the contact's DISC style. " + "If a 'MESSAGE YOU ARE RESPONDING TO' is provided, write a direct, specific reply that acknowledges what they actually said \u2014 not a generic check-in. " + "Respond ONLY with compact JSON, no markdown, no preamble. " + 'Schema: {"summary":"one or two sentences framing the day for the agent","items":[{"id":"<contact id>","subject":"short email subject","message":"the drafted message"}]}';
  const user = `${voiceBlock}\n\nReach-out list for today:\n${list}\n\n${insights ? `What has worked for THIS agent historically (use as silent guidance for phrasing, length, and tone \u2014 do NOT mention it):\n${insights}\n\n` : ""}Write one message per contact (match the id exactly), plus a brief, energizing one-to-two sentence summary of the day for the agent.`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1800,
      system: sys,
      messages: [
        {
          role: "user",
          content: user
        }
      ]
    })
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  let txt = (j.content || []).filter((b)=>b.type === "text").map((b)=>b.text).join("").trim();
  txt = txt.replace(/```json|```/g, "").trim();
  // Usage travels WITH the result (not in a module variable): an isolate can
  // serve two users at once, and a shared variable would bill the wrong one.
  return Object.assign(JSON.parse(txt), { __usage: j?.usage || null });
}
serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response("ok", {
    headers: cors
  });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const authClient = createClient(SUPABASE_URL, ANON, {
      global: {
        headers: {
          Authorization: authHeader
        }
      }
    });
    const body = await req.json().catch(()=>({}));
    let uid;
    // Internal calls: the exact service key, OR the shared QCP token. Two service
    // key formats are live on this project (legacy JWT and sb_secret_), so a bare
    // string compare breaks the moment caller and callee hold different ones —
    // which is how ari-briefing-deliver lost 7 of 10 morning emails (26 Sep).
    const qcp = Deno.env.get("QCP_TOKEN") || "";
    const internal = token === SERVICE || (qcp && (req.headers.get("x-qcp-token") || "") === qcp);
    if (internal && body.user_id) {
      uid = body.user_id; // trusted internal call (cron delivery)
    } else {
      const { data: ures } = await authClient.auth.getUser(token);
      const user = ures?.user;
      if (!user) return new Response(JSON.stringify({
        error: "Not authenticated"
      }), {
        status: 401,
        headers: {
          ...cors,
          "Content-Type": "application/json"
        }
      });
      uid = user.id;
    }
    // Act-as support sessions never reach the agent's Google data (_shared/impersonation.ts).
    if (await isImpersonatedRequest(createClient(SUPABASE_URL, SERVICE), req.headers.get("Authorization"))) return supportSessionResponse(cors);
    const today = body.today || new Date().toISOString().slice(0, 10);
    const regenerate = !!body.regenerate;
    const db = createClient(SUPABASE_URL, SERVICE);
    // Return cached briefing unless regenerating
    if (!regenerate) {
      const { data: existing } = await db.from("ari_briefings").select("*").eq("user_id", uid).eq("briefing_date", today).maybeSingle();
      if (existing) return new Response(JSON.stringify({
        briefing: existing,
        cached: true
      }), {
        headers: {
          ...cors,
          "Content-Type": "application/json"
        }
      });
    }
    const startOfDay = `${today}T00:00:00`;
    const endOfDay = `${today}T23:59:59`;
    // ---- Today's tasks (due today or overdue, open) ----
    const { data: tasks } = await db.from("tasks").select("id,title,due_date,priority,eisenhower_quadrant,status,completed").eq("user_id", uid).eq("completed", false).not("due_date", "is", null).lte("due_date", today).order("due_date", {
      ascending: true
    }).limit(8);
    // ---- Today's events ----
    const { data: events } = await db.from("events").select("id,title,start_at,all_day,location,contact_id").eq("user_id", uid).gte("start_at", startOfDay).lte("start_at", endOfDay).order("start_at", {
      ascending: true
    }).limit(10);
    // ---- Active deals ----
    const { data: deals } = await db.from("deals").select("id,client_name,address,status,close_date").eq("user_id", uid).not("status", "in", "(closed,lost,dead,archived)").limit(12);
    const dealNames = new Set((deals || []).map((d)=>(d.client_name || "").trim().toLowerCase()).filter(Boolean));
    // ---- Candidate contacts ----
    const cand = {};
    const add = (c, reason, score, sortKey)=>{
      if (!c) return;
      if (c.reachout_snooze_until && new Date(c.reachout_snooze_until) > new Date()) return; // snoozed reach-outs stay hidden until the chosen date
      if (!cand[c.id]) cand[c.id] = {
        ...c,
        reason,
        score,
        sortKey
      };
      else if (score > cand[c.id].score) {
        cand[c.id].reason = reason;
        cand[c.id].score = score;
        cand[c.id].sortKey = sortKey;
      }
    };
    // (A) Explicit follow-ups owed (interactions with follow_up_at due)
    const { data: fups } = await db.from("contact_interactions").select("contact_id,follow_up_at,brief,occurred_at").eq("user_id", uid).not("follow_up_at", "is", null).lte("follow_up_at", endOfDay).order("follow_up_at", {
      ascending: true
    }).limit(40);
    const fupIds = [
      ...new Set((fups || []).map((f)=>f.contact_id).filter(Boolean))
    ];
    // (B) Replied, awaiting your response
    const { data: awaiting } = await db.from("contacts").select("id,name,email,phone,type,status,priority,notes,last_contact_at,last_inbound_at,reachout_snooze_until").eq("user_id", uid).not("last_inbound_at", "is", null).order("last_inbound_at", {
      ascending: false
    }).limit(40);
    // (C) Overdue sphere touch
    const cutoff = new Date(Date.now() - 45 * 86400000).toISOString();
    const { data: overdue } = await db.from("contacts").select("id,name,email,phone,type,status,priority,notes,last_contact_at,last_inbound_at,reachout_snooze_until").eq("user_id", uid).not("email", "is", null).in("type", [
      "lead",
      "client",
      "partner",
      "sphere",
      "recruit",
      "agent",
      "personal"
    ]).or(`last_contact_at.is.null,last_contact_at.lt.${cutoff}`).order("last_contact_at", {
      ascending: true,
      nullsFirst: false
    }).limit(40);
    // hydrate follow-up contacts
    let fupContacts = [];
    if (fupIds.length) {
      const { data } = await db.from("contacts").select("id,name,email,phone,type,status,priority,notes,last_contact_at,last_inbound_at,reachout_snooze_until").in("id", fupIds);
      fupContacts = data || [];
    }
    const fupBrief = {};
    (fups || []).forEach((f)=>{
      if (f.contact_id && f.brief && !fupBrief[f.contact_id]) fupBrief[f.contact_id] = f.brief;
    });
    for (const c of fupContacts)add(c, "A follow-up you scheduled is due", 100, "A");
    for (const c of awaiting || []){
      const owed = !c.last_contact_at || c.last_inbound_at && new Date(c.last_inbound_at) > new Date(c.last_contact_at);
      if (owed) add(c, "They reached out — you owe a reply", 80, "B");
    }
    for (const c of overdue || []){
      const d = daysSince(c.last_contact_at);
      const score = 30 + Math.min(d ?? 120, 120) / 3;
      add(c, d ? `It has been ${d} days since you connected` : "You have not connected yet", score, "C");
    }
    // ---- outcome learning (refinement #2 flywheel) ----
    let learnInsights = "";
    const byContact = {};
    try {
      const since = new Date(Date.now() - 120 * 864e5).toISOString();
      const { data: hist } = await db.from("ari_outreach").select("contact_id,disc,word_count,send_hour,replied,meeting_booked,deal_moved").eq("user_id", uid).eq("status", "sent").gte("sent_at", since);
      const H = hist || [];
      for (const h of H){
        if (h.contact_id) {
          const b = byContact[h.contact_id] || (byContact[h.contact_id] = {
            sent: 0,
            replied: 0,
            deal: 0,
            meeting: 0
          });
          b.sent++;
          if (h.replied) b.replied++;
          if (h.deal_moved) b.deal++;
          if (h.meeting_booked) b.meeting++;
        }
      }
      if (H.length >= 8) {
        const disc = {}, len = {
          short: {
            s: 0,
            r: 0
          },
          long: {
            s: 0,
            r: 0
          }
        }, hour = {};
        for (const h of H){
          if (h.disc) {
            const d = disc[h.disc] || (disc[h.disc] = {
              s: 0,
              r: 0
            });
            d.s++;
            if (h.replied) d.r++;
          }
          const lk = (h.word_count || 0) < 60 ? "short" : "long";
          len[lk].s++;
          if (h.replied) len[lk].r++;
          if (h.send_hour != null) {
            const hh = hour[h.send_hour] || (hour[h.send_hour] = {
              s: 0,
              r: 0
            });
            hh.s++;
            if (h.replied) hh.r++;
          }
        }
        const pct = (r, sN)=>sN ? Math.round(r / sN * 100) : 0;
        const tips = [];
        const discRanked = Object.entries(disc).filter(([, v])=>v.s >= 3).sort((a, b)=>b[1].r / b[1].s - a[1].r / a[1].s);
        for (const [d, v] of discRanked.slice(0, 4))tips.push(`${DISC_LABEL[d] || d}: ${pct(v.r, v.s)}% reply rate over ${v.s} sent`);
        if (len.short.s >= 3 && len.long.s >= 3) {
          const sp = pct(len.short.r, len.short.s), lp = pct(len.long.r, len.long.s);
          tips.push(sp >= lp ? `Short messages under 60 words reply ${sp}% vs ${lp}% for longer \u2014 keep it tight.` : `Longer, more detailed messages reply ${lp}% vs ${sp}% \u2014 substance converts for this agent.`);
        }
        const hourRanked = Object.entries(hour).filter(([, v])=>v.s >= 3).sort((a, b)=>b[1].r / b[1].s - a[1].r / a[1].s);
        if (hourRanked.length) {
          const hb = hourRanked[0];
          tips.push(`Best send window so far: ${hb[0]}:00 (${pct(hb[1].r, hb[1].s)}% replies).`);
        }
        if (tips.length) learnInsights = tips.join(" ");
      }
    } catch (_e) {}
    // ---- propensity-to-transact scores (refinement #3) ----
    const scoreMap = {};
    try {
      const ids0 = Object.keys(cand);
      if (ids0.length) {
        const { data: scs } = await db.from("contact_scores").select("contact_id,score").in("contact_id", ids0);
        (scs || []).forEach((r)=>{
          scoreMap[r.contact_id] = r.score;
        });
      }
    } catch (_e) {}
    // boosts + finalize candidate context
    let candidates = Object.values(cand);
    for (const c of candidates){
      if (dealNames.has((c.name || "").trim().toLowerCase())) {
        c.score += 50;
        c.reason = "Active deal in motion — keep them warm";
      }
      if (c.priority === "high") c.score += 15;
      const bc = byContact[c.id];
      if (bc) {
        if (bc.deal) c.score += 40; // touches to this contact preceded deal movement
        else if (bc.replied) c.score += 20; // this contact replies to you
        else if (bc.sent >= 2 && bc.replied === 0) c.score -= 10; // repeatedly no response
      }
      const ps = scoreMap[c.id] || 0;
      if (ps >= 70) c.score += 25;
      else if (ps >= 45) c.score += 12;
      else if (ps >= 25) c.score += 5; // propensity to transact
      const d = daysSince(c.last_contact_at);
      c.lastTouch = d == null ? "no prior contact logged" : `${d} days ago`;
      c.context = fupBrief[c.id] || (c.notes ? String(c.notes).slice(0, 160) : "");
    }
    candidates.sort((a, b)=>b.score - a.score);
    candidates = candidates.slice(0, 6);
    // ---- DISC per candidate ----
    if (candidates.length) {
      const ids = candidates.map((c)=>c.id);
      const { data: disc } = await db.from("disc_evidence").select("contact_id,signals_d,signals_i,signals_s,signals_c,weight").in("contact_id", ids);
      const agg = {};
      (disc || []).forEach((e)=>{
        const w = Number(e.weight) || 1;
        const a = agg[e.contact_id] || (agg[e.contact_id] = {
          D: 0,
          I: 0,
          S: 0,
          C: 0
        });
        a.D += (e.signals_d || 0) * w;
        a.I += (e.signals_i || 0) * w;
        a.S += (e.signals_s || 0) * w;
        a.C += (e.signals_c || 0) * w;
      });
      for (const c of candidates){
        const a = agg[c.id];
        if (a) {
          const top = Object.entries(a).sort((x, y)=>y[1] - x[1])[0];
          if (top && top[1] > 0) {
            c.disc = top[0];
            c.discLabel = DISC_LABEL[top[0]];
          }
        }
      }
    }
    // ---- source message each reach-out is responding to ----
    for (const c of candidates){
      try {
        if (c.sortKey === "A" && c.context) {
          c.source = {
            label: "Your follow-up note",
            text: c.context,
            channel: "note"
          };
        } else if (c.sortKey === "B" && c.email) {
          const { data: em } = await db.from("email_messages").select("subject,body_text,snippet,internal_date,from_address,to_addresses,cc_addresses").ilike("from_address", `%${c.email}%`).order("internal_date", {
            ascending: false
          }).limit(1);
          const m = em && em[0];
          if (m) {
            const txt = String(m.snippet || m.body_text || "").replace(/\r/g, "").split(/\nOn .*wrote:/)[0].trim().slice(0, 900);
            c.source = {
              label: "Their message",
              subject: m.subject || "",
              text: txt,
              dated_at: m.internal_date,
              channel: "email",
              from: m.from_address || "",
              to: normAddr(m.to_addresses),
              cc: normAddr(m.cc_addresses)
            };
          }
        }
        if (!c.source) {
          const { data: li } = await db.from("contact_interactions").select("brief,body,channel,occurred_at,direction").eq("contact_id", c.id).order("occurred_at", {
            ascending: false
          }).limit(1);
          const it = li && li[0];
          if (it && (it.brief || it.body)) {
            c.source = {
              label: it.direction === "inbound" ? "Their last message" : "Last interaction",
              text: String(it.body || it.brief).slice(0, 700),
              channel: it.channel || "note",
              dated_at: it.occurred_at
            };
          }
        }
      } catch (_e) {}
    }
    // ---- voice card ----
    const { data: vcs } = await db.from("voice_cards").select("*").eq("user_id", uid).eq("is_active", true).limit(1);
    const voice = vcs && vcs[0];
    // ---- draft messages ----
    let summary = "";
    const drafted = {};
    if (candidates.length) {
      try {
        const ai = await draftWithClaude(voice, candidates, learnInsights);
        await logAiUsage(db, { userId: uid, fn: "ari-briefing", model: MODEL, usage: ai.__usage, usedOwn: false });
        summary = ai.summary || "";
        (ai.items || []).forEach((it)=>{
          if (it.id) drafted[String(it.id)] = it;
        });
      } catch (_e) {
        summary = "";
      }
    }
    const reachouts = candidates.map((c)=>{
      const d = drafted[c.id] || {};
      const first = (c.name || "there").split(" ")[0];
      return {
        contact_id: c.id,
        name: c.name,
        email: c.email || null,
        phone: c.phone || null,
        reason: c.reason,
        disc: c.disc || null,
        disc_label: c.discLabel || null,
        last_touch: c.lastTouch,
        subject: d.subject || `Hi ${first}`,
        message: d.message || `Hi ${first}, you crossed my mind today — wanted to check in and see how things are going. Always here if I can help with anything.`,
        source: c.source || null,
        status: "pending"
      };
    });
    if (!summary) {
      summary = reachouts.length ? `${reachouts.length} relationship${reachouts.length > 1 ? "s" : ""} worth your attention today, plus ${(tasks || []).length} task${(tasks || []).length === 1 ? "" : "s"} due. Let's make it count.` : `No outreach flagged today — a clear runway. ${(tasks || []).length} task${(tasks || []).length === 1 ? "" : "s"} due.`;
    }
    const payload = {
      generated_at: new Date().toISOString(),
      tasks: (tasks || []).map((t)=>({
          id: t.id,
          title: t.title,
          due_date: t.due_date,
          priority: t.priority,
          quadrant: t.eisenhower_quadrant
        })),
      events: (events || []).map((e)=>({
          id: e.id,
          title: e.title,
          start_at: e.start_at,
          all_day: e.all_day,
          location: e.location
        })),
      deals: (deals || []).map((d)=>({
          id: d.id,
          client_name: d.client_name,
          address: d.address,
          status: d.status,
          close_date: d.close_date
        })),
      reachouts
    };
    const { data: saved, error: upErr } = await db.from("ari_briefings").upsert({
      user_id: uid,
      briefing_date: today,
      summary,
      payload,
      updated_at: new Date().toISOString()
    }, {
      onConflict: "user_id,briefing_date"
    }).select("*").single();
    if (upErr) throw upErr;
    return new Response(JSON.stringify({
      briefing: saved,
      cached: false
    }), {
      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: String(err)
    }), {
      status: 500,
      headers: {
        ...cors,
        "Content-Type": "application/json"
      }
    });
  }
});
