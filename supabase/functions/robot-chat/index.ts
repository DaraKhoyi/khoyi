import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const MAX_IMAGE_EDGE = 1568;
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 2048;
const MAX_HISTORY_TURNS = 20;
const MAX_TOOL_ITERS = 6;
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);

// Anthropic rejects any message whose content is empty (empty string, empty
// array, or a tool_result/text block with empty content) with a 400
// "messages.N: ... must have non-empty content". This normalizes every message
// so the agentic loop can never produce such a payload.
function sanitizeMessages(messages) {
  const PLACEHOLDER = "(no content)";
  return (messages || []).map((m) => {
    let content = m && m.content;
    if (typeof content === "string") {
      if (!content.trim()) content = PLACEHOLDER;
    } else if (Array.isArray(content)) {
      content = content.map((blk) => {
        if (!blk || typeof blk !== "object") return blk;
        if (blk.type === "tool_result") {
          const c = typeof blk.content === "string" ? blk.content : JSON.stringify(blk.content ?? {});
          return { ...blk, content: c && c.trim() ? c : "{}" };
        }
        if (blk.type === "text" && (!blk.text || !blk.text.trim())) {
          return { ...blk, text: PLACEHOLDER };
        }
        return blk;
      });
      if (content.length === 0) content = PLACEHOLDER;
    } else if (content == null) {
      content = PLACEHOLDER;
    }
    return { ...m, content };
  });
}

async function callClaude(system, messages, tools, maxAttempts = 4) {
  messages = sanitizeMessages(messages);
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let r = null;
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 45000); // don't let a hung call kill the whole turn — abort & retry
    try {
      const payload = { model: MODEL, max_tokens: MAX_TOKENS, system, messages };
      if (tools && tools.length) payload.tools = tools;
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal
      });
    } catch (e) { lastErr = e; }
    finally { clearTimeout(to); }
    if (r) {
      if (r.ok) {
        const j = await r.json();
        const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
        return { content: j.content || [], text, stop_reason: j.stop_reason, usage: j.usage };
      }
      const t = await r.text().catch(() => "");
      lastErr = new Error(`Anthropic ${r.status}: ${t.slice(0, 300)}`);
      if (!RETRYABLE_STATUS.has(r.status)) throw lastErr;
    }
    if (attempt === maxAttempts) break;
    const backoff = Math.round(400 * Math.pow(2, attempt - 1) + Math.random() * 300);
    await new Promise((res) => setTimeout(res, backoff));
  }
  throw lastErr || new Error("Anthropic call failed");
}

function mimeFromPath(path) {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "heic" || ext === "heif") return "image/heic";
  return "image/jpeg";
}
function bytesToBase64(bytes) {
  let binary = ""; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    for (let j = 0; j < slice.length; j++) binary += String.fromCharCode(slice[j]);
  }
  return btoa(binary);
}
async function loadImageAsBase64(supabase, imagePath) {
  try {
    const { data, error } = await supabase.storage.from("receipts").download(imagePath);
    if (error || !data) return null;
    const ab = await data.arrayBuffer();
    let bytes = new Uint8Array(ab);
    if (bytes.length === 0) return null;
    let mediaType = mimeFromPath(imagePath);
    if (mediaType === "image/jpeg" || mediaType === "image/png") {
      try {
        const img = await Image.decode(bytes);
        const longest = Math.max(img.width, img.height);
        if (longest > MAX_IMAGE_EDGE) { const scale = MAX_IMAGE_EDGE / longest; img.resize(Math.round(img.width * scale), Math.round(img.height * scale)); }
        bytes = await img.encodeJPEG(82); mediaType = "image/jpeg";
      } catch (_e) {}
    }
    if (bytes.length > 6 * 1024 * 1024) return null;
    return { data: bytesToBase64(bytes), media_type: mediaType };
  } catch (_e) { return null; }
}
async function parseReceiptInternal(receiptPath, jwt) {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/parse-receipt`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" },
      body: JSON.stringify({ receipt_path: receiptPath })
    });
    if (!r.ok) return null;
    const j = await r.json();
    if (j?.error) return null;
    return j;
  } catch (_e) { return null; }
}

// Fire-and-forget after creating a contact: identify the person from public
// data and, only if we get a confident single match, research them and run a
// DISC read. Safe by default — ambiguous identity means no research (the user
// can run a manual Prism Read and pick the right person).
async function autoReadContact(contactId, jwt, matchedBy) {
  const hdr = { "Authorization": `Bearer ${jwt}`, "Content-Type": "application/json" };
  try {
    const ir = await fetch(`${SUPABASE_URL}/functions/v1/contact-identify`, { method: "POST", headers: hdr, body: JSON.stringify({ contact_id: contactId }) });
    const idd = ir.ok ? await ir.json() : null;
    const cands = (idd && idd.candidates) || [];
    if (idd && idd.confidence === "locked" && cands.length === 1) {
      await fetch(`${SUPABASE_URL}/functions/v1/contact-research`, { method: "POST", headers: hdr, body: JSON.stringify({ contact_id: contactId, candidate: cands[0], scope: "both", matched_by: matchedBy || "manual" }) });
    }
    // Run the DISC read regardless; it folds in the research prior when present.
    await fetch(`${SUPABASE_URL}/functions/v1/disc-analyze`, { method: "POST", headers: hdr, body: JSON.stringify({ contact_id: contactId, force: true }) });
  } catch (_e) { /* background best-effort */ }
}

// ───────────────────────── TOOLS ─────────────────────────
// Each spec: { perm, confirm, server, def }. Only tools whose `perm` is enabled
// in robot.permissions are exposed to the model. `confirm:true` write tools
// return needs_confirmation until called again with confirm:true.
function buildToolSpecs() {
  return [
    { perm: "tasks_read", def: { name: "list_tasks", description: "List the user's tasks. Use filter to scope.", input_schema: { type: "object", properties: { filter: { type: "string", enum: ["open", "today", "overdue", "all"] }, limit: { type: "integer" } } } } },
    { perm: "tasks_write", confirm: true, def: { name: "manage_task", description: "Create, complete, or update a task. Creating/updating requires confirm:true.", input_schema: { type: "object", properties: { action: { type: "string", enum: ["create", "complete", "update"] }, task_id: { type: "string" }, title: { type: "string" }, notes: { type: "string" }, due_date: { type: "string", description: "YYYY-MM-DD" }, priority: { type: "string", enum: ["high", "medium", "low"] }, confirm: { type: "boolean" } }, required: ["action"] } } },
    { perm: "calendar_read", def: { name: "list_events", description: "List calendar events in a date range. Use to check schedule and availability.", input_schema: { type: "object", properties: { start: { type: "string", description: "ISO date/datetime" }, end: { type: "string", description: "ISO date/datetime" }, limit: { type: "integer" } } } } },
    { perm: "calendar_write", confirm: true, def: { name: "create_event", description: "Create a calendar event. Requires confirm:true.", input_schema: { type: "object", properties: { title: { type: "string" }, start_at: { type: "string", description: "ISO datetime" }, end_at: { type: "string", description: "ISO datetime" }, all_day: { type: "boolean" }, location: { type: "string" }, description: { type: "string" }, confirm: { type: "boolean" } }, required: ["title", "start_at"] } } },
    { perm: "prospecting_control", def: { name: "prospecting", description: "Control prospecting: start_timer/stop_timer for a lead-gen system, or complete_task. Live actions, no confirm needed.", input_schema: { type: "object", properties: { action: { type: "string", enum: ["start_timer", "stop_timer", "complete_task"] }, system: { type: "string", description: "system name" }, task: { type: "string", description: "task description to match" } }, required: ["action"] } } },
    { perm: "contacts_read", def: { name: "find_contacts", description: "Search the user's contacts by name, company, or email.", input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } } } } },
    { perm: "contacts_read", def: { name: "research_contact", description: "Call this when the user asks you to look up, research, find info on, or 'who is' a specific PERSON. It checks whether that person is one of the user's contacts and surfaces a one-tap button that runs PrismOS's full web research on them. Pass the person's name plus any identifiers the user mentioned (email, phone, company). Do NOT web-search the person yourself — this hands off to the dedicated research flow, which is more thorough and saves the result to the contact.", input_schema: { type: "object", properties: { name: { type: "string" }, email: { type: "string" }, phone: { type: "string" }, company: { type: "string" }, force: { type: "boolean", description: "Set true ONLY after the user says they don't know any identifier — proceeds with just the name." } }, required: ["name"] } } },
    { perm: "contacts_write", confirm: true, def: { name: "update_contact", description: "Update a contact. Requires confirm:true.", input_schema: { type: "object", properties: { contact_id: { type: "string" }, name: { type: "string", description: "used to find the contact if no id" }, notes: { type: "string" }, phone: { type: "string" }, email: { type: "string" }, priority: { type: "string" }, status: { type: "string" }, cadence_days: { type: "integer" }, confirm: { type: "boolean" } } } } },
    { perm: "contacts_write", confirm: true, def: { name: "create_contact", description: "Create a NEW contact. Use this when the user shares a business card photo, a screenshot, or typed details and wants the person saved. Read every field you can from the image/text and pass them in. Requires confirm:true.", input_schema: { type: "object", properties: {
      name: { type: "string", description: "Full name (required)" },
      company: { type: "string" },
      role: { type: "string", description: "job title or role" },
      email: { type: "string" },
      phone: { type: "string" },
      type: { type: "string", description: "contact type, e.g. lead, vendor, agent, partner, client, recruit; default 'lead'" },
      business_address: { type: "string", description: "street address" },
      business_city: { type: "string" },
      business_state: { type: "string" },
      business_zip: { type: "string" },
      website: { type: "string" },
      notes: { type: "string", description: "anything else worth keeping, e.g. where you met" },
      confirm: { type: "boolean" }
    }, required: ["name"] } } },
    { perm: "inbox_read", def: { name: "read_inbox", description: "Read recent inbox email (subjects, senders, snippets). Optional query to search.", input_schema: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer" } } } } },
    { perm: "inbox_read", def: { name: "read_thread", description: "Read the messages in one email thread by thread_id.", input_schema: { type: "object", properties: { thread_id: { type: "string" } }, required: ["thread_id"] } } },
    { perm: "email_send", confirm: true, def: { name: "send_email", description: "Send an email from the user's connected account. Requires confirm:true.", input_schema: { type: "object", properties: { to: { type: "string" }, subject: { type: "string" }, body: { type: "string" }, confirm: { type: "boolean" } }, required: ["to", "subject", "body"] } } },
    { perm: "recruiting", confirm: true, def: { name: "recruiting", description: "Recruiting pipeline. action 'list' (read) or 'update_stage' (write, needs confirm).", input_schema: { type: "object", properties: { action: { type: "string", enum: ["list", "update_stage"] }, contact: { type: "string" }, stage: { type: "string" }, confirm: { type: "boolean" } }, required: ["action"] } } },
    { perm: "finance_read", def: { name: "read_finance", description: "Read the user's finance snapshot: GCI goal, hourly rate, YTD income/expense/net, and per-system spend.", input_schema: { type: "object", properties: {} } } },
    { perm: "transactions_write", confirm: true, def: { name: "add_transaction", description: "Record a transaction. Requires confirm:true.", input_schema: { type: "object", properties: { amount: { type: "number", description: "positive dollar amount" }, type: { type: "string", enum: ["expense", "income"] }, scope: { type: "string", enum: ["business", "personal"] }, date: { type: "string", description: "YYYY-MM-DD" }, payee: { type: "string" }, description: { type: "string" }, confirm: { type: "boolean" } }, required: ["amount", "type"] } } },
    { perm: "portfolio_read", def: { name: "read_portfolio", description: "Read deals, properties, investments, or mileage entries.", input_schema: { type: "object", properties: { kind: { type: "string", enum: ["deals", "properties", "investments", "mileage"] }, limit: { type: "integer" } }, required: ["kind"] } } },
    { perm: "memory", def: { name: "remember", description: "Save a durable fact about the user for future conversations.", input_schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } } },
    { perm: "journal", def: { name: "read_journal", description: "Read the user's daily journal entries. Use scope 'today', 'day' (with date), or 'range' (with start+end YYYY-MM-DD). Returns timestamped entries and what each is linked to.", input_schema: { type: "object", properties: { scope: { type: "string", enum: ["today", "day", "range"] }, date: { type: "string", description: "YYYY-MM-DD for scope=day" }, start: { type: "string", description: "YYYY-MM-DD for scope=range" }, end: { type: "string", description: "YYYY-MM-DD for scope=range" }, query: { type: "string", description: "optional keyword filter" } } } } },
    { perm: "journal", def: { name: "add_journal_entry", description: "Append a timestamped entry to TODAY's journal on the user's behalf. It will be auto-linked to people/projects/deals and may surface action items. Use when the user asks you to log/note something.", input_schema: { type: "object", properties: { content: { type: "string" } }, required: ["content"] } } },
    { perm: "web_search", server: true, def: { type: "web_search_20250305", name: "web_search", max_uses: 5 } }
  ];
}

function todayET() {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date());
}

async function findContact(supabase, userId, idOrName) {
  if (!idOrName) return null;
  if (/^[0-9a-f-]{36}$/i.test(idOrName)) {
    const { data } = await supabase.from("contacts").select("*").eq("user_id", userId).eq("id", idOrName).maybeSingle();
    if (data) return data;
  }
  const { data } = await supabase.from("contacts").select("*").eq("user_id", userId).ilike("name", `%${idOrName}%`).limit(1);
  return (data && data[0]) || null;
}

// Execute one tool. Returns a JSON-serializable result.
async function execTool(name, input, ctx) {
  const { supabase, userId, token, robotId } = ctx;
  input = input || {};
  try {
    switch (name) {
      case "search_knowledge": {
        const passages = await retrieveKnowledge(input.query || "", token);
        if (!passages.length) return { results: "Nothing relevant found in the user's saved knowledge." };
        return { results: passages.map((p, i) => `[${i + 1}] ${p.title || "untitled"}: ${p.content}`).join("\n\n") };
      }
      case "list_tasks": {
        const filter = input.filter || "open";
        const lim = Math.min(50, input.limit || 25);
        let q = supabase.from("tasks").select("id,title,notes,due_date,priority,status,completed,completed_at").eq("user_id", userId);
        const t = todayET();
        if (filter === "open") q = q.eq("completed", false);
        else if (filter === "today") q = q.eq("completed", false).eq("due_date", t);
        else if (filter === "overdue") q = q.eq("completed", false).lt("due_date", t);
        const { data } = await q.order("due_date", { ascending: true, nullsFirst: false }).limit(lim);
        return { tasks: data || [] };
      }
      case "manage_task": {
        const action = input.action;
        if (action === "create") {
          if (input.confirm !== true) return { needs_confirmation: true, action_preview: `Create task "${input.title}"${input.due_date ? " due " + input.due_date : ""}${input.priority ? " (" + input.priority + ")" : ""}` };
          const { data, error } = await supabase.from("tasks").insert({ user_id: userId, title: input.title, notes: input.notes || null, due_date: input.due_date || null, priority: input.priority || "medium", completed: false }).select("id,title").single();
          if (error) throw error;
          return { created: data };
        }
        // resolve task by id or title
        let task = null;
        if (input.task_id) { const { data } = await supabase.from("tasks").select("*").eq("user_id", userId).eq("id", input.task_id).maybeSingle(); task = data; }
        else if (input.title) { const { data } = await supabase.from("tasks").select("*").eq("user_id", userId).ilike("title", `%${input.title}%`).limit(1); task = data && data[0]; }
        if (!task) return { error: "Task not found" };
        if (action === "complete") {
          await supabase.from("tasks").update({ completed: true, completed_at: new Date().toISOString() }).eq("id", task.id);
          return { completed: { id: task.id, title: task.title } };
        }
        if (action === "update") {
          if (input.confirm !== true) return { needs_confirmation: true, action_preview: `Update "${task.title}": ${["title", "notes", "due_date", "priority"].filter((k) => input[k] != null).map((k) => `${k}=${input[k]}`).join(", ")}` };
          const upd = {};
          ["title", "notes", "due_date", "priority"].forEach((k) => { if (input[k] != null) upd[k] = input[k]; });
          await supabase.from("tasks").update(upd).eq("id", task.id);
          return { updated: { id: task.id, ...upd } };
        }
        return { error: "Unknown action" };
      }
      case "list_events": {
        const start = input.start || new Date(Date.now() - 86400000).toISOString();
        const end = input.end || new Date(Date.now() + 14 * 86400000).toISOString();
        const { data } = await supabase.from("events").select("title,start_at,end_at,all_day,location").eq("user_id", userId).gte("start_at", start).lte("start_at", end).order("start_at").limit(Math.min(50, input.limit || 30));
        return { events: data || [] };
      }
      case "create_event": {
        if (input.confirm !== true) return { needs_confirmation: true, action_preview: `Create event "${input.title}" at ${input.start_at}${input.location ? " @ " + input.location : ""}` };
        const { data, error } = await supabase.from("events").insert({ user_id: userId, title: input.title, start_at: input.start_at, end_at: input.end_at || input.start_at, all_day: !!input.all_day, location: input.location || null, description: input.description || null, sync_status: "pending_push", event_kind: "event" }).select("id,title").single();
        if (error) throw error;
        return { created: data, note: "Open the Calendar tab to sync this to Google." };
      }
      case "prospecting": {
        const act = input.action;
        const t = todayET();
        const { data: fs } = await supabase.from("finance_settings").select("active_timer_system_id,active_timer_started_at").eq("user_id", userId).maybeSingle();
        async function logRunning() {
          if (fs?.active_timer_system_id && fs?.active_timer_started_at) {
            const mins = Math.min(480, Math.round((Date.now() - new Date(fs.active_timer_started_at).getTime()) / 60000));
            if (mins >= 1) await supabase.from("time_entries").insert({ user_id: userId, lead_gen_system_id: fs.active_timer_system_id, minutes: mins, occurred_at: new Date().toISOString(), description: "⏱ Timer (Ari)" });
          }
        }
        if (act === "start_timer") {
          const { data: sys } = await supabase.from("lead_gen_systems").select("id,name").eq("user_id", userId).eq("is_active", true).ilike("name", `%${input.system || ""}%`).limit(1);
          if (!sys || !sys[0]) return { error: "Active system not found" };
          await logRunning();
          await supabase.from("finance_settings").update({ active_timer_system_id: sys[0].id, active_timer_started_at: new Date().toISOString() }).eq("user_id", userId);
          return { started: sys[0].name };
        }
        if (act === "stop_timer") {
          await logRunning();
          await supabase.from("finance_settings").update({ active_timer_system_id: null, active_timer_started_at: null }).eq("user_id", userId);
          return { stopped: true };
        }
        if (act === "complete_task") {
          const { data: sys } = await supabase.from("lead_gen_systems").select("id,name,daily_tasks").eq("user_id", userId).eq("is_active", true).ilike("name", `%${input.system || ""}%`).limit(1);
          if (!sys || !sys[0]) return { error: "Active system not found" };
          const dt = Array.isArray(sys[0].daily_tasks) ? sys[0].daily_tasks : [];
          const match = dt.find((x) => (x.desc || "").toLowerCase().includes((input.task || "").toLowerCase())) || dt[0];
          if (!match) return { error: "No matching task" };
          const { data: existing } = await supabase.from("prospecting_completions").select("id").eq("user_id", userId).eq("system_id", sys[0].id).eq("task_id", match.id).eq("date", t).maybeSingle();
          const target = match.daily_target || 1;
          if (existing) await supabase.from("prospecting_completions").update({ count_done: target }).eq("id", existing.id);
          else await supabase.from("prospecting_completions").insert({ user_id: userId, system_id: sys[0].id, task_id: match.id, date: t, count_done: target, target });
          return { completed_task: match.desc, system: sys[0].name };
        }
        return { error: "Unknown action" };
      }
      case "find_contacts": {
        let q = supabase.from("contacts").select("id,name,email,phone,company,type,notes,last_contact_at").eq("user_id", userId);
        if (input.query) q = q.or(`name.ilike.%${input.query}%,company.ilike.%${input.query}%,email.ilike.%${input.query}%`);
        const { data } = await q.order("last_contact_at", { ascending: false, nullsFirst: false }).limit(Math.min(25, input.limit || 15));
        return { contacts: data || [] };
      }
      case "research_contact": {
        const nm = String(input.name || "").trim();
        if (!nm) return { error: "A name is required." };
        let q = supabase.from("contacts").select("id,name,company").eq("user_id", userId);
        const ors = [`name.ilike.%${nm}%`];
        if (input.email) ors.push(`email.ilike.%${input.email}%`);
        if (input.company) ors.push(`company.ilike.%${input.company}%`);
        q = q.or(ors.join(","));
        const { data: matches } = await q.limit(6);
        const list = matches || [];
        if (list.length === 1) {
          if (ctx.actionRef) ctx.actionRef.value = { kind: "research", contact_id: list[0].id, name: list[0].name };
          return { found: true, contact: { id: list[0].id, name: list[0].name, company: list[0].company || null }, note: "A Research button will appear under your reply. Tell the user you found them and to tap it — do NOT describe the person yourself." };
        }
        if (list.length > 1) {
          return { found: "multiple", matches: list.map((c) => ({ name: c.name, company: c.company || null })), note: "Ask which one they mean, then call research_contact again with more detail." };
        }
        const hasIdentifier = !!(input.email || input.phone || input.company);
        if (!hasIdentifier && input.force !== true) {
          return { found: false, need_identifier: true, name: nm, note: "Not a saved contact, and no identifier was given. Do NOT offer any button yet. First ask the user for at least one of: email, phone, or employer/company — it makes the research accurate. If they say they don't know, call research_contact again with force:true to attempt the match and run it anyway." };
        }
        if (ctx.actionRef) ctx.actionRef.value = { kind: "create", name: nm, email: input.email || null, phone: input.phone || null, company: input.company || null };
        return { found: false, name: nm, note: "A 'Create contact & research' button will appear under your reply. Offer it." };
      }
      case "update_contact": {
        const c = await findContact(supabase, userId, input.contact_id || input.name);
        if (!c) return { error: "Contact not found" };
        const upd = {};
        ["notes", "phone", "email", "priority", "status", "cadence_days"].forEach((k) => { if (input[k] != null) upd[k] = input[k]; });
        if (!Object.keys(upd).length) return { error: "No fields to update" };
        if (input.confirm !== true) return { needs_confirmation: true, action_preview: `Update ${c.name}: ${Object.entries(upd).map(([k, v]) => `${k}=${v}`).join(", ")}` };
        await supabase.from("contacts").update(upd).eq("id", c.id);
        return { updated: { id: c.id, name: c.name, ...upd } };
      }
      case "create_contact": {
        const name = (input.name || "").trim();
        if (!name) return { error: "A name is required to create a contact." };
        const type = (input.type || "lead").trim();
        const noteParts = [];
        if (input.notes) noteParts.push(input.notes);
        if (input.website) noteParts.push(`Website: ${input.website}`);
        const notes = noteParts.join("\n") || null;
        if (input.confirm !== true) {
          const head = [name, input.role, input.company ? "@ " + input.company : null].filter(Boolean).join(" ");
          const contactBits = [input.phone, input.email].filter(Boolean).join(", ");
          return { needs_confirmation: true, action_preview: `Create contact: ${head}${contactBits ? " — " + contactBits : ""}` };
        }
        // Soft duplicate guard: same name already on file with a matching phone or email
        if (input.phone || input.email) {
          const { data: dupes } = await supabase.from("contacts").select("id,name,phone,email").eq("user_id", userId).ilike("name", name).limit(5);
          const d10 = (s) => String(s || "").replace(/[^0-9]/g, "").slice(-10);
          const hit = (dupes || []).find((c) => (input.email && c.email && c.email.toLowerCase() === String(input.email).toLowerCase()) || (input.phone && d10(c.phone) && d10(c.phone) === d10(input.phone)));
          if (hit) return { error: `A contact named ${hit.name} with that ${input.email && hit.email ? "email" : "phone"} already exists. Use update_contact instead, or change the details if this is a different person.` };
        }
        // Insert WITHOUT phone/email — the BEFORE INSERT trigger syncs the jsonb
        // arrays and blanks the scalar phone, so set those in a second step.
        const row = {
          user_id: userId, name, type,
          company: input.company || null,
          role: input.role || null,
          business_address: input.business_address || null,
          business_city: input.business_city || null,
          business_state: input.business_state || null,
          business_zip: input.business_zip || null,
          notes,
          origin: "manual",
          origin_detail: "Added via Ari",
        };
        const { data, error } = await supabase.from("contacts").insert(row).select("id,name").single();
        if (error) throw error;
        const post = {};
        if (input.phone) post.phone = input.phone;
        if (input.email) post.email = input.email;
        if (Object.keys(post).length) await supabase.from("contacts").update(post).eq("id", data.id);
        // Kick off a background Prism read (identify → research → DISC) so a brand
        // new contact gets a behavioral read without blocking this reply.
        const matchedBy = input.email ? "email" : (input.phone ? "phone" : "manual");
        try {
          if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(autoReadContact(data.id, token, matchedBy));
          else autoReadContact(data.id, token, matchedBy);
        } catch (_e) { /* ignore */ }
        return { created: { id: data.id, name: data.name, company: input.company || null, role: input.role || null, phone: input.phone || null, email: input.email || null }, note: "Contact saved. I'm running a Prism read in the background to infer their DISC style — check the contact in a minute (it completes only if I can confidently identify them online; otherwise run a manual Prism Read and pick the right person)." };
      }
      case "read_inbox": {
        let q = supabase.from("email_messages").select("from_name,from_address,subject,snippet,is_read,internal_date,thread_id,direction").eq("user_id", userId);
        if (input.query) q = q.or(`subject.ilike.%${input.query}%,from_address.ilike.%${input.query}%,snippet.ilike.%${input.query}%`);
        const { data } = await q.order("internal_date", { ascending: false }).limit(Math.min(20, input.limit || 12));
        return { messages: data || [] };
      }
      case "read_thread": {
        const { data } = await supabase.from("email_messages").select("from_name,from_address,subject,body_text,internal_date,direction").eq("user_id", userId).eq("thread_id", input.thread_id).order("internal_date").limit(20);
        return { thread: (data || []).map((m) => ({ ...m, body_text: (m.body_text || "").slice(0, 700) })) };
      }
      case "send_email": {
        if (input.confirm !== true) return { needs_confirmation: true, action_preview: `Send email to ${input.to} — subject: "${input.subject}"` };
        const { data: accts } = await supabase.from("email_accounts").select("id").eq("user_id", userId).limit(1);
        if (!accts || !accts[0]) return { error: "No connected email account" };
        const r = await fetch(`${SUPABASE_URL}/functions/v1/gmail-send`, {
          method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ account_id: accts[0].id, to: input.to, subject: input.subject, body_text: input.body })
        });
        const jr = await r.json().catch(() => ({}));
        if (!r.ok || jr?.error) return { error: "Send failed: " + (jr?.error || r.status) };
        return { sent: { to: input.to, subject: input.subject } };
      }
      case "recruiting": {
        if (input.action === "list") {
          const { data } = await supabase.from("contacts").select("id,name,recruiting_stage,recruiting_estimated_annual_gci,recruiting_notes").eq("user_id", userId).eq("type", "recruit").limit(40);
          return { recruits: data || [] };
        }
        if (input.action === "update_stage") {
          const c = await findContact(supabase, userId, input.contact);
          if (!c) return { error: "Recruit not found" };
          if (input.confirm !== true) return { needs_confirmation: true, action_preview: `Move ${c.name} to recruiting stage "${input.stage}"` };
          await supabase.from("contacts").update({ recruiting_stage: input.stage, recruiting_stage_changed_at: new Date().toISOString() }).eq("id", c.id);
          return { updated: { name: c.name, stage: input.stage } };
        }
        return { error: "Unknown action" };
      }
      case "read_finance": {
        const { data: fs } = await supabase.from("finance_settings").select("*").eq("user_id", userId).maybeSingle();
        const yearStart = todayET().slice(0, 4) + "-01-01";
        const { data: tx } = await supabase.from("transactions").select("amount,scope,lead_gen_system_id").eq("user_id", userId).eq("is_archived", false).gte("date", yearStart).limit(1000);
        let income = 0, expense = 0;
        (tx || []).forEach((t) => { const a = Number(t.amount) || 0; if (a > 0) income += a; else expense += -a; });
        return {
          gci_goal: fs?.annual_gci_goal || null, hourly_rate: fs?.hourly_rate || null,
          prospecting_hours_per_week: fs?.prospecting_hours_per_week || null,
          ytd_income: Math.round(income), ytd_expense: Math.round(expense), ytd_net: Math.round(income - expense),
          current_cash_balance: fs?.current_cash_balance ?? null
        };
      }
      case "add_transaction": {
        if (input.confirm !== true) return { needs_confirmation: true, action_preview: `Record ${input.type} of $${Number(input.amount).toFixed(2)}${input.payee ? " — " + input.payee : ""} (${input.scope || "business"})` };
        const amt = Math.abs(Number(input.amount) || 0);
        if (!amt) return { error: "Missing amount" };
        const signed = input.type === "income" ? amt : -amt;
        const { data, error } = await supabase.from("transactions").insert({ user_id: userId, date: input.date || todayET(), amount: signed, scope: input.scope || "business", payee: input.payee || null, description: input.description || null, entered_via: "ari" }).select("id").single();
        if (error) throw error;
        return { recorded: { id: data.id, amount: signed } };
      }
      case "read_portfolio": {
        const k = input.kind, lim = Math.min(30, input.limit || 15);
        if (k === "deals") { const { data } = await supabase.from("deals").select("name,client_name,address,status,sale_price,gross_commission,close_date").eq("user_id", userId).limit(lim); return { deals: data || [] }; }
        if (k === "properties") { const { data } = await supabase.from("properties").select("nickname,address,city,state,category,status,list_price,current_value").eq("user_id", userId).limit(lim); return { properties: data || [] }; }
        if (k === "investments") { const { data } = await supabase.from("investments").select("name,kind,stage,amount,income_ytd,expense_ytd").eq("user_id", userId).limit(lim); return { investments: data || [] }; }
        if (k === "mileage") { const { data } = await supabase.from("mileage_entries").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(lim); return { mileage: data || [] }; }
        return { error: "Unknown kind" };
      }
      case "remember": {
        if (!input.content) return { error: "Nothing to remember" };
        await supabase.from("ari_memory").insert({ user_id: userId, robot_id: robotId, content: input.content });
        return { saved: true };
      }
      case "read_journal": {
        const t = todayET();
        let q = supabase.from("journal_entries").select("id,day,occurred_at,content,kind").eq("user_id", userId);
        const scope = input.scope || "today";
        if (scope === "today") q = q.eq("day", t);
        else if (scope === "day") q = q.eq("day", input.date || t);
        else if (scope === "range") q = q.gte("day", input.start || t).lte("day", input.end || t);
        if (input.query) q = q.ilike("content", `%${input.query}%`);
        const { data: es } = await q.order("occurred_at", { ascending: true }).limit(120);
        const entries = es || [];
        let linkBy = {};
        if (entries.length) {
          const { data: ls } = await supabase.from("journal_links").select("entry_id,entity_type,label").in("entry_id", entries.map((e) => e.id)).eq("dismissed", false).eq("confirmed", true);
          (ls || []).forEach((l) => { (linkBy[l.entry_id] = linkBy[l.entry_id] || []).push(`${l.entity_type}:${l.label}`); });
        }
        return { entries: entries.map((e) => ({ day: e.day, time: e.occurred_at, content: e.content, linked_to: linkBy[e.id] || [] })) };
      }
      case "add_journal_entry": {
        if (!input.content || !input.content.trim()) return { error: "Nothing to log" };
        const day = todayET();
        const { data: entry, error } = await supabase.from("journal_entries").insert({ user_id: userId, day, occurred_at: new Date().toISOString(), kind: "text", content: input.content.trim(), source: "ari" }).select().single();
        if (error || !entry) return { error: "Save failed" };
        // analyze + link in the same way the app does
        let links = [], actions = [];
        try {
          const ar = await fetch(`${SUPABASE_URL}/functions/v1/journal-analyze`, { method: "POST", headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ entry_id: entry.id }) });
          const a = await ar.json().catch(() => ({}));
          if (a && !a.error) {
            actions = a.action_items || [];
            for (const l of (a.links || [])) {
              if (!l.id || !l.type || !l.label) continue;
              const confirmed = (Number(l.confidence) || 0) >= 0.8;
              const { data: row } = await supabase.from("journal_links").insert({ user_id: userId, entry_id: entry.id, entity_type: l.type, entity_id: l.id, label: l.label, confidence: l.confidence, confirmed, dismissed: false }).select("id").single();
              if (confirmed && (l.type === "contact" || l.type === "property" || l.type === "deal")) {
                const { data: ci } = await supabase.from("contact_interactions").insert({ user_id: userId, entity_type: l.type, entity_id: l.id, contact_id: l.type === "contact" ? l.id : null, kind: "note", channel: "note", body: entry.content, brief: entry.content.slice(0, 90), occurred_at: entry.occurred_at, journal_entry_id: entry.id }).select("id").single();
                if (ci && row) await supabase.from("journal_links").update({ interaction_id: ci.id }).eq("id", row.id);
              }
              links.push({ label: l.label, type: l.type, confirmed });
            }
          }
        } catch (_) {}
        return { logged: true, time: entry.occurred_at, linked: links, action_items: actions };
      }
      default:
        return { error: "Unknown tool: " + name };
    }
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

// Retrieve the user's own knowledge (Voyage embed -> RLS-scoped hybrid search -> rerank).
async function retrieveKnowledge(queryText, userToken) {
  try {
    const vk = Deno.env.get("VOYAGE_API_KEY");
    const URL = Deno.env.get("SUPABASE_URL"), ANON = Deno.env.get("SUPABASE_ANON_KEY");
    if (!vk || !queryText || !queryText.trim()) return [];
    const er = await fetch("https://api.voyageai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${vk}`, "Content-Type": "application/json" }, body: JSON.stringify({ input: [queryText.slice(0, 2000)], model: "voyage-3.5", input_type: "query", output_dimension: 1024 }) });
    if (!er.ok) return [];
    const emb = "[" + (await er.json()).data[0].embedding.join(",") + "]";
    const uc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${userToken}` } } });
    const { data: hits } = await uc.rpc("knowledge_search", { query_embedding: emb, query_text: queryText.slice(0, 500), match_count: 15 });
    if (!hits || !hits.length) return [];
    let order = hits.slice(0, 5);
    try {
      const rr = await fetch("https://api.voyageai.com/v1/rerank", { method: "POST", headers: { Authorization: `Bearer ${vk}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: queryText.slice(0, 2000), documents: hits.map((h) => h.content), model: "rerank-2.5", top_k: Math.min(5, hits.length) }) });
      if (rr.ok) { const rj = await rr.json(); order = rj.data.map((d) => hits[d.index]); }
    } catch (_) {}
    return order.map((h) => ({ title: h.title, content: h.content, source_id: h.source_id }));
  } catch (_) { return []; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { robot_id, message, history = [], image_path } = body || {};
    if (!robot_id || (typeof message !== "string" && !image_path)) {
      return new Response(JSON.stringify({ error: "robot_id and (message or image_path) required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userMessage = typeof message === "string" ? message : "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === SUPABASE_SERVICE_ROLE_KEY) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = user.id;

    const { data: robot, error: rErr } = await supabase.from("robots").select("id, name, role, system_prompt, active, user_id, permissions").eq("id", robot_id).maybeSingle();
    if (rErr || !robot || robot.user_id !== userId) return new Response(JSON.stringify({ error: "Robot not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!robot.active) return new Response(JSON.stringify({ error: "Robot is inactive" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (image_path) {
      if (typeof image_path !== "string" || !image_path.startsWith(`${userId}/`)) return new Response(JSON.stringify({ error: "Invalid image_path" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const cleanHistory = Array.isArray(history) ? history.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0).slice(-MAX_HISTORY_TURNS).map((m) => ({ role: m.role, content: m.content })) : [];

    let currentTurnContent = userMessage;
    let receiptParsePromise = Promise.resolve(null);
    if (image_path) {
      const imageData = await loadImageAsBase64(supabase, image_path);
      if (!imageData) return new Response(JSON.stringify({ response: "I couldn't read that image — it may be in a format I can't open (like an iPhone HEIC) or too large. Try taking the photo again, or upload a JPEG or PNG." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const blocks = [{ type: "image", source: { type: "base64", media_type: imageData.media_type, data: imageData.data } }];
      if (userMessage.trim()) blocks.push({ type: "text", text: userMessage });
      else blocks.push({ type: "text", text: "(The user shared this image without a caption — describe what you see briefly. If it's a receipt or invoice, mention what was extracted and offer to add it to accounting.)" });
      currentTurnContent = blocks;
      receiptParsePromise = parseReceiptInternal(image_path, token);
    }

    const messages = [...cleanHistory, { role: "user", content: currentTurnContent }];

    // ── Permissions → tools + capability description ──
    const perms = robot.permissions || {};
    const specs = buildToolSpecs().filter((s) => perms[s.perm] === true);
    specs.push({ perm: "knowledge_read", confirm: false, def: { name: "search_knowledge", description: "Search the user's own saved Knowledge base — their notes, documents, files, and links about their projects and know-how. Use this whenever they ask about their projects, properties, deals, clients, or anything they may have saved. Returns relevant passages with source titles.", input_schema: { type: "object", properties: { query: { type: "string", description: "what to look up" } }, required: ["query"] } } });
    // Safety net: Anthropic rejects any request containing duplicate tool names with a
    // hard 400, which silently kills the entire turn. Guarantee unique names before sending.
    const _seenToolNames = new Set();
    const tools = specs.map((s) => s.def).filter((d) => {
      if (!d || !d.name) return true;
      if (_seenToolNames.has(d.name)) return false;
      _seenToolNames.add(d.name);
      return true;
    });
    const confirmByName = {};
    specs.forEach((s) => { if (s.confirm) confirmByName[s.def.name] = true; });

    // Long-term memory recall
    let memoryBlock = "";
    if (perms.memory === true) {
      const { data: mem } = await supabase.from("ari_memory").select("content").eq("user_id", userId).order("created_at", { ascending: false }).limit(40);
      if (mem && mem.length) memoryBlock = "\n\nDurable facts you've saved about the user:\n" + mem.map((m) => "- " + m.content).join("\n");
    }

    const baseSystem = robot.system_prompt || `You are ${robot.name}, an AI assistant.`;
    const capLines = [
      "You can see and discuss images the user attaches.",
      "When the user sends a photo of a receipt/invoice, the app extracts it and shows a 'Push to accounting' button under your reply — just acknowledge what was found.",
    ];
    capLines.push("You can search the user's own saved Knowledge with search_knowledge (their notes, documents, files, links about their projects and know-how). Use it whenever they ask about their projects, properties, deals, or anything they might have saved; answer from what it returns, cite sources inline as [Knowledge: <title>], and never invent details it does not contain.");
    if (tools.length) {
      capLines.push("You have live tools to act inside PrismOS on the user's behalf — all scoped to this user only. Use them to fetch real data and take actions rather than guessing.");
      capLines.push("RESEARCH HANDOFF: When the user asks you to look up, research, find info on, or 'who is' a specific person, call research_contact — do NOT web-search them yourself. If found:true, say you found them in their contacts and to tap the Research button below; do not summarize the person. If found:'multiple', ask which one they mean. If it returns need_identifier:true, do NOT offer any button yet — first ask the user for at least one identifier (email, phone, or employer), since it makes the research accurate; when they give one, call research_contact again with it. If the user says they don't know or can't, call research_contact again with force:true to attempt the match and run it anyway. Once found:false comes back (with an identifier or force), offer the 'Create contact & research' button below.");
      capLines.push("CONFIRMATIONS: If a tool returns needs_confirmation, the action did NOT happen. Tell the user in plain language exactly what you'll do and ask them to confirm; only re-call that tool with confirm:true after they explicitly agree.");
    }
    if (tools.some((t) => t.name === "create_contact")) {
      capLines.push("When the user sends a photo of a business card (or typed contact details) and wants the person saved, read every field you can from the image — name, title, company, phone, email, address, website — and use create_contact. Confirm the details with the user first, then create it.");
    }
    const system = `${baseSystem}\n\nToday is ${todayET()} (user timezone America/New_York).\n\nCapabilities: ${capLines.join(" ")}${memoryBlock}`;

    // ── Agentic loop ──
    let finalText = "";
    let usage = null;
    let chatFailed = false;
    let loopMessages = messages;
    const actionRef = { value: null };
    try {
      for (let i = 0; i < MAX_TOOL_ITERS; i++) {
        const resp = await callClaude(system, loopMessages, tools);
        usage = resp.usage || usage;
        const clientToolUses = (resp.content || []).filter((b) => b.type === "tool_use");
        if (resp.stop_reason === "tool_use" && clientToolUses.length) {
          loopMessages = [...loopMessages, { role: "assistant", content: resp.content }];
          const results = [];
          for (const tu of clientToolUses) {
            const out = await execTool(tu.name, tu.input, { supabase, userId, token, robotId: robot_id, actionRef });
            results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out ?? {}) || "{}" });
          }
          loopMessages = [...loopMessages, { role: "user", content: results }];
          continue;
        }
        finalText = resp.text || "";
        break;
      }
      if (!finalText) finalText = "Done.";
    } catch (e) {
      chatFailed = true;
      console.error("chat loop failed:", String(e?.message || e));
    }

    const receiptResult = await receiptParsePromise.catch(() => null);
    let receiptData = null;
    if (receiptResult && typeof receiptResult.confidence === "number" && receiptResult.confidence >= 0.4) {
      receiptData = { vendor: receiptResult.vendor || null, date: receiptResult.date || null, amount: receiptResult.amount ?? null, scope: receiptResult.is_business_likely === false ? "personal" : "business", confidence: receiptResult.confidence, tax_category_id: receiptResult.suggested_tax_category_id || null, lead_gen_system_id: receiptResult.suggested_lead_gen_system_id || null, description_guess: receiptResult.description_guess || null, line_items: receiptResult.line_items || null, receipt_path: image_path };
    }

    let text = finalText;
    if (chatFailed) {
      if (receiptData) { const amt = receiptData.amount != null ? ` for $${Number(receiptData.amount).toFixed(2)}` : ""; const vend = receiptData.vendor ? ` from ${receiptData.vendor}` : ""; text = `I hit a brief hiccup, but I read your receipt${vend}${amt}. Tap **Push to accounting** to log it.`; }
      else text = "I'm having trouble reaching my AI service right now — give it a moment and try again.";
    }

    const skipPersist = chatFailed && !receiptData;
    if (!skipPersist) {
      const userTurn = { role: "user", content: userMessage, ts: new Date().toISOString() };
      if (image_path) userTurn.image_path = image_path;
      const assistantTurn = { role: "assistant", content: text, ts: new Date().toISOString() };
      if (receiptData) assistantTurn.receipt_data = receiptData;
      if (actionRef.value) assistantTurn.research_action = actionRef.value;
      const newTurns = [userTurn, assistantTurn];
      const { data: existing } = await supabase.from("robot_conversations").select("id, messages").eq("user_id", userId).eq("robot_id", robot_id).maybeSingle();
      if (existing) {
        const merged = Array.isArray(existing.messages) ? [...existing.messages, ...newTurns] : newTurns;
        await supabase.from("robot_conversations").update({ messages: merged.slice(-200), updated_at: new Date().toISOString() }).eq("id", existing.id);
      } else {
        await supabase.from("robot_conversations").insert({ user_id: userId, robot_id, messages: newTurns });
      }
    }

    const responsePayload = { response: text, meta: { model: MODEL, tokens: usage, degraded: chatFailed } };
    if (receiptData) responsePayload.receipt_data = receiptData;
    if (actionRef.value) responsePayload.research_action = actionRef.value;
    return new Response(JSON.stringify(responsePayload), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err && err.message ? err.message : err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
