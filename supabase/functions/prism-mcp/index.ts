// prism-mcp — PrismOS as a connector for Claude (a remote MCP server).
//
// Dara, 27 Sep 2026: "I definitely want to set up PrismOS as a server connection
// to Claude." Add it in Claude under Connectors → Add custom connector with the
// URL https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/prism-mcp.
//
// HOW SIGN-IN WORKS, AND WHY IT IS SAFE
//   * Supabase Auth is the OAuth 2.1 server (Authentication > OAuth Server).
//     Claude registers itself, sends the person to darasapp.com/oauth/consent,
//     they sign in to PrismOS and approve, and Claude receives an access token.
//   * That token IS the person's PrismOS session. Every query below runs through
//     a client built from it, so row-level security applies exactly as in the
//     app: an agent's Claude sees that agent's contacts and leads, never anyone
//     else's. There is NO service-role read anywhere in a tool. (The only
//     service-role write is the usage log line, which records who called what.)
//   * Tokens are verified by the auth server (auth.getUser), never decoded and
//     trusted — the forged-token lesson of the same day (_shared/serviceCaller.ts).
//   * Only tokens minted by the consent flow are accepted (they carry client_id),
//     and only for people in mcp_access while the connector is new.
//   * v1 never sends anything to anyone — no email, no text. It reads, and it
//     writes to PrismOS itself (tasks, notes, the call list), each an action
//     Claude asks the person to approve.
//
// PROTOCOL: MCP Streamable HTTP, JSON responses (no SSE stream needed — every
// tool answers in one response). JSON-RPC 2.0: initialize, ping,
// notifications/*, tools/list, tools/call.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_BASE = "https://xlgfspnojjgvkuitcoaf.supabase.co";
const RESOURCE = `${PUBLIC_BASE}/functions/v1/prism-mcp`;
const PRM_URL = `${RESOURCE}/.well-known/oauth-protected-resource`;
const AUTH_ISSUER = `${PUBLIC_BASE}/auth/v1`;
const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
const SERVER_VERSION = "1.0.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json", ...extra } });
const challenge = (why: string) => json({ error: "unauthorized", error_description: why }, 401,
  { "WWW-Authenticate": `Bearer resource_metadata="${PRM_URL}"` });

const INSTRUCTIONS = `PrismOS is a real-estate brokerage's operating system (Realty ONE Group Advantage, Tampa Bay).
You act for the signed-in person and see only what they can see in the app.
Their task list is their WHOLE LIFE, not only real estate — never judge a task as off-topic.
Family relationships (spouse, children) are core client data — always show them.
Promises heard on calls are PrismOS's suggestions until the person makes them tasks.
Postponing a call ("Later") is a date the person chose; it changes nothing about the client.
Nothing here sends email or texts. Before any write, say plainly what you are about to do.`;

// ── tools ───────────────────────────────────────────────────────────────────
type Ctx = { db: any; admin: any; userId: string; staff: boolean };
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const need = (v: unknown, name: string) => { if (v === undefined || v === null || v === "") throw new Error(`${name} is required`); return v; };
const uuid = (v: unknown, name: string) => {
  const s = String(need(v, name));
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) throw new Error(`${name} must be an id from another PrismOS tool`);
  return s;
};
const fail = (e: any) => { throw new Error(e?.message || String(e)); };

const RO = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const RW = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

const TOOLS: Record<string, { title: string; description: string; inputSchema: any; annotations: any; staffOnly?: boolean;
  run: (a: any, c: Ctx) => Promise<unknown> }> = {

  todays_calls: {
    title: "Today's calls",
    description: "The people this person should call today, in order, with why (they reached out and are waiting, past due for a touch, back from a postponement) and a suggested opener. The same list as the Today screen; it counts down as calls are made.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: RO,
    run: async (_a, { db }) => {
      const { data, error } = await db.rpc("who_to_call_today", { p_limit: 5 });
      if (error) fail(error);
      return (data || []).map((p: any) => ({ contact_id: p.id, name: p.name, phone: p.phone, why: p.reason, disc_style: p.disc || null, opener: p.opener || null }));
    },
  },

  postpone_call: {
    title: "Postpone a call",
    description: "Take someone off today's call list until a later day, for a reason the person knows (travelling, waiting on an appraisal, asked for next week). The next person due takes the slot. Changes nothing about the client's priority. Can be undone in the app.",
    inputSchema: { type: "object", required: ["contact_id", "days"], additionalProperties: false, properties: {
      contact_id: { type: "string", description: "From todays_calls or find_contacts" },
      days: { type: "integer", minimum: 1, maximum: 365, description: "Call them again in this many days" },
      reason: { type: "string", maxLength: 140, description: "Optional — comes back with them on the day" } } },
    annotations: RW,
    run: async (a, { db }) => {
      const { data, error } = await db.rpc("snooze_call", { p_contact: uuid(a.contact_id, "contact_id"), p_days: Number(a.days), p_note: a.reason || null });
      if (error) fail(error);
      return { postponed_until: data?.until, replaced_by: data?.replacement_name || null };
    },
  },

  log_call: {
    title: "Tick off a call",
    description: "Mark someone on today's call list as handled: 'called', 'texted', or 'not_today' (off today's list only; they can come back tomorrow).",
    inputSchema: { type: "object", required: ["contact_id", "outcome"], additionalProperties: false, properties: {
      contact_id: { type: "string" }, outcome: { type: "string", enum: ["called", "texted", "not_today"] } } },
    annotations: RW,
    run: async (a, { db }) => {
      const outcome = a.outcome === "not_today" ? "skipped" : a.outcome;
      const { error } = await db.rpc("log_call_list", { p_contact: uuid(a.contact_id, "contact_id"), p_outcome: outcome });
      if (error) fail(error);
      return { ok: true };
    },
  },

  find_contacts: {
    title: "Find contacts",
    description: "Search this person's contacts by name, email, phone or company. Returns ids to use with the other tools.",
    inputSchema: { type: "object", required: ["query"], additionalProperties: false, properties: {
      query: { type: "string", minLength: 2 }, limit: { type: "integer", minimum: 1, maximum: 25 } } },
    annotations: RO,
    run: async (a, { db }) => {
      const q = String(need(a.query, "query")).replace(/[%,()]/g, " ").trim();
      const digits = q.replace(/\D/g, "");
      const ors = [`name.ilike.%${q}%`, `email.ilike.%${q}%`, `company.ilike.%${q}%`];
      if (digits.length >= 4) ors.push(`phone.ilike.%${digits.slice(-7)}%`);
      const { data, error } = await db.from("contacts")
        .select("id,name,type,company,email,phone,last_contact_at,pipeline_stage")
        .or(ors.join(",")).order("last_contact_at", { ascending: false, nullsFirst: false }).limit(Math.min(Number(a.limit) || 10, 25));
      if (error) fail(error);
      return (data || []).map((c: any) => ({ contact_id: c.id, name: c.name, type: c.type, company: c.company, email: c.email, phone: c.phone,
        last_contact: c.last_contact_at, stage: c.pipeline_stage }));
    },
  },

  contact_details: {
    title: "Contact details",
    description: "Everything useful about one person: who they are, family and relationships, when you last spoke and which way, recent notes, open tasks and call follow-ups.",
    inputSchema: { type: "object", required: ["contact_id"], additionalProperties: false, properties: { contact_id: { type: "string" } } },
    annotations: RO,
    run: async (a, { db }) => {
      const id = uuid(a.contact_id, "contact_id");
      const { data: c, error } = await db.from("contacts").select(
        "id,name,type,company,profession,email,phone,home_city,home_ownership,last_contact_at,last_inbound_at,last_outbound_at,last_communication_channel,last_communication_direction,cadence_days,pipeline_stage,notes,tags,spoken_language")
        .eq("id", id).maybeSingle();
      if (error) fail(error);
      if (!c) return { error: "No contact with that id that you can see." };
      const [rel, notes, tasks, fus] = await Promise.all([
        db.from("contact_relationships").select("type,notes,contact_a_id,contact_b_id").or(`contact_a_id.eq.${id},contact_b_id.eq.${id}`).limit(20),
        db.from("contact_notes").select("body,created_at").eq("contact_id", id).order("created_at", { ascending: false }).limit(5),
        db.from("tasks").select("id,title,due_date,list").eq("contact_id", id).eq("completed", false).is("archived_at", null).limit(10),
        db.from("commitments").select("title,owner,due_date,status,next_step").eq("contact_id", id).in("status", ["proposed", "accepted"]).limit(10),
      ]);
      const others = [...new Set((rel.data || []).map((r: any) => r.contact_a_id === id ? r.contact_b_id : r.contact_a_id))];
      let names: Record<string, string> = {};
      if (others.length) {
        const { data: on } = await db.from("contacts").select("id,name").in("id", others);
        (on || []).forEach((o: any) => { names[o.id] = o.name; });
      }
      return {
        contact_id: c.id, name: c.name, type: c.type, company: c.company, profession: c.profession, email: c.email, phone: c.phone,
        city: c.home_city, owns_home: c.home_ownership, language: c.spoken_language, stage: c.pipeline_stage, tags: c.tags,
        last_contact: c.last_contact_at, last_direction: c.last_communication_direction, last_channel: c.last_communication_channel,
        call_every_days: c.cadence_days, background: c.notes ? String(c.notes).slice(0, 800) : null,
        family_and_relationships: (rel.data || []).map((r: any) => ({ relation: r.type, name: names[r.contact_a_id === id ? r.contact_b_id : r.contact_a_id] || null, note: r.notes })),
        recent_notes: (notes.data || []).map((n: any) => ({ at: n.created_at, text: String(n.body || "").slice(0, 500) })),
        open_tasks: (tasks.data || []).map((t: any) => ({ task_id: t.id, title: t.title, due: t.due_date })),
        call_followups: (fus.data || []).map((f: any) => ({ title: f.title, whose: f.owner === "me" ? "yours" : "theirs", due: f.due_date, next_step: f.next_step,
          state: f.status === "proposed" ? "suggested by PrismOS, not yet a task" : "being tracked" })),
      };
    },
  },

  my_leads: {
    title: "My leads",
    description: "New leads waiting on this person, newest first, with how long each has waited and what is known about whether they can buy (pre-approval, timeline, budget, areas) plus the question to ask next. For the broker and office manager, also the brokerage leads waiting to be assigned to an agent.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: RO,
    run: async (_a, { db, staff }) => {
      const mins = (t: string) => Math.round((Date.now() - Date.parse(t)) / 60000);
      const brief = (r: any) => r ? { readiness: r.grade, facts: Object.fromEntries(Object.entries(r.facts || {}).map(([k, v]: any) => [k, v && typeof v === "object" && "value" in v ? v.value : v])),
        signals: r.signals, ask_next: r.ask_next } : null;
      const { data: mine, error } = await db.rpc("lead_concierge_pending");
      if (error) fail(error);
      const out: any = {
        my_leads: (mine || []).filter((l: any) => l.kind === "lead").map((l: any) => ({ name: l.lead_name || l.contact_name, source: l.source, email: l.lead_email, phone: l.lead_phone,
          waiting_minutes: mins(l.first_seen_at), said: String(l.inbound_text || "").slice(0, 400), ...brief(l.readiness) })),
        replies_owed: (mine || []).filter((l: any) => l.kind === "reply").map((l: any) => ({ name: l.contact_name || l.lead_name, since: l.first_seen_at })),
      };
      if (staff) {
        const { data: q } = await db.rpc("brokerage_lead_queue");
        out.brokerage_leads_waiting_for_an_agent = (q || []).map((l: any) => ({ name: l.lead_name, source: l.source, email: l.lead_email, phone: l.lead_phone,
          property: l.property, waiting_minutes: l.minutes_waiting, ...brief(l.readiness) }));
      }
      return out;
    },
  },

  my_tasks: {
    title: "My tasks",
    description: "This person's open tasks. 'today' = due today or earlier and today's list; 'overdue'; 'week' = due in the next 7 days; 'all' = every open task (up to 60). Their list covers their whole life, not only real estate.",
    inputSchema: { type: "object", additionalProperties: false, properties: { view: { type: "string", enum: ["today", "overdue", "week", "all"] } } },
    annotations: RO,
    run: async (a, { db }) => {
      const d = today();
      let q = db.from("tasks").select("id,title,due_date,list,eisenhower_quadrant,contact_id,notes")
        .eq("completed", false).is("archived_at", null).order("due_date", { ascending: true, nullsFirst: false }).limit(60);
      const v = a.view || "today";
      if (v === "today") q = q.or(`due_date.lte.${d},list.eq.today`);
      else if (v === "overdue") q = q.lt("due_date", d);
      else if (v === "week") { const w = new Date(Date.parse(d + "T12:00:00Z") + 7 * 864e5).toISOString().slice(0, 10); q = q.lte("due_date", w); }
      const { data, error } = await q;
      if (error) fail(error);
      return (data || []).map((t: any) => ({ task_id: t.id, title: t.title, due: t.due_date, list: t.list, quadrant: t.eisenhower_quadrant,
        contact_id: t.contact_id, notes: t.notes ? String(t.notes).slice(0, 200) : null }));
    },
  },

  create_task: {
    title: "Add a task",
    description: "Add a task to this person's PrismOS task list. Link it to a contact when it is about someone. Quadrant: A = urgent and important, B = important not urgent (default), C = urgent not important, D = neither.",
    inputSchema: { type: "object", required: ["title"], additionalProperties: false, properties: {
      title: { type: "string", minLength: 3, maxLength: 200 }, due_date: { type: "string", description: "YYYY-MM-DD" },
      contact_id: { type: "string" }, notes: { type: "string", maxLength: 2000 }, quadrant: { type: "string", enum: ["A", "B", "C", "D"] } } },
    annotations: RW,
    run: async (a, { db, userId }) => {
      const quad = a.quadrant || "B";
      const pmap: Record<string, string> = { A: "high", B: "medium", C: "low", D: "low" };
      if (a.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(a.due_date)) throw new Error("due_date must be YYYY-MM-DD");
      const { data, error } = await db.from("tasks").insert({
        user_id: userId, title: String(need(a.title, "title")).trim(), due_date: a.due_date || null,
        contact_id: a.contact_id ? uuid(a.contact_id, "contact_id") : null,
        notes: [a.notes || null, "Added from Claude."].filter(Boolean).join("\n\n"),
        priority: pmap[quad], priority_system: "eisenhower", eisenhower_quadrant: quad, list: "inbox", completed: false,
        source_url: "claude:prism-mcp",
      }).select("id,title,due_date").single();
      if (error) fail(error);
      return { task_id: data.id, title: data.title, due: data.due_date };
    },
  },

  complete_task: {
    title: "Complete a task",
    description: "Mark one of this person's tasks done.",
    inputSchema: { type: "object", required: ["task_id"], additionalProperties: false, properties: { task_id: { type: "string" } } },
    annotations: RW,
    run: async (a, { db }) => {
      const { data, error } = await db.from("tasks").update({ completed: true, completed_at: new Date().toISOString() })
        .eq("id", uuid(a.task_id, "task_id")).select("id,title").maybeSingle();
      if (error) fail(error);
      return data ? { done: data.title } : { error: "No open task with that id that you can see." };
    },
  },

  add_contact_note: {
    title: "Add a note to a contact",
    description: "Save a note on a contact's record (what was said, a preference, a life event).",
    inputSchema: { type: "object", required: ["contact_id", "text"], additionalProperties: false, properties: {
      contact_id: { type: "string" }, text: { type: "string", minLength: 2, maxLength: 4000 } } },
    annotations: RW,
    run: async (a, { db, userId }) => {
      const { error } = await db.from("contact_notes").insert({ user_id: userId, contact_id: uuid(a.contact_id, "contact_id"), body: String(need(a.text, "text")).trim() });
      if (error) fail(error);
      return { saved: true };
    },
  },

  call_followups: {
    title: "Promises heard on calls",
    description: "What PrismOS heard on this person's recent phone calls: promises they made (suggestions until they make them tasks) and promises others made that they are tracking, with late ones flagged.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: RO,
    run: async (_a, { db }) => {
      const since = new Date(Date.now() - 30 * 864e5).toISOString();
      const { data, error } = await db.from("commitments").select("title,owner,owner_name,due_date,status,next_step,quote,created_at,contact_id")
        .or(`and(status.eq.proposed,created_at.gte.${since}),and(status.eq.accepted,owner.eq.them)`)
        .order("created_at", { ascending: false }).limit(40);
      if (error) fail(error);
      const d = today();
      return (data || []).map((f: any) => ({ title: f.title, whose: f.owner === "me" ? "yours" : (f.owner_name || "theirs"), due: f.due_date,
        late: !!(f.due_date && f.due_date < d), next_step: f.next_step, heard: f.quote,
        state: f.status === "proposed" ? "suggested by PrismOS, not yet a task" : "being tracked", contact_id: f.contact_id }));
    },
  },

  brokerage_snapshot: {
    title: "Brokerage snapshot",
    description: "For the broker and office manager only: the last 30 days of real leads (answered, inside 5 minutes, wrote back, pre-approval known, ready to buy), each agent's speed to lead, and each agent's pace against their goal.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: RO, staffOnly: true,
    run: async (_a, { db }) => {
      const [f, s, r] = await Promise.all([db.rpc("lead_funnel", { p_days: 30 }), db.rpc("speed_to_lead", { p_days: 30 }), db.rpc("broker_goal_roster")]);
      const roster = Array.isArray(r.data?.agents) ? r.data.agents : Array.isArray(r.data) ? r.data : [];
      return { leads_30_days: f.data, speed_to_lead: s.data,
        agents: roster.slice(0, 40).map((a: any) => ({ name: a.name, ytd_gci: a.ytd_gci, projected_year: a.projected ?? null, goal: a.goal ?? null, pace_pct: a.pace_pct ?? null,
          last_close: a.last_close ?? null, departed: !!a.departed })) };
    },
  },
};

// ── the endpoint ────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const path = new URL(req.url).pathname;

  // Where Claude learns which sign-in server to use (RFC 9728).
  if (path.endsWith("/.well-known/oauth-protected-resource") || path.includes("/.well-known/oauth-protected-resource/")) {
    return json({ resource: RESOURCE, authorization_servers: [AUTH_ISSUER], bearer_methods_supported: ["header"],
      resource_name: "PrismOS", resource_documentation: "https://darasapp.com" });
  }
  if (req.method === "GET") return json({ error: "Use POST (MCP Streamable HTTP, JSON responses)." }, 405, { Allow: "POST, OPTIONS" });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // ── who is this? Verified by the auth server, never decoded and trusted.
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return challenge("Sign in to PrismOS to use this connector.");
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return challenge("Your PrismOS sign-in has expired. Reconnect.");
  // Only tokens from the consent flow (they name the OAuth client) — not a copied app session.
  let clientId: string | null = null;
  try { const seg = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"); clientId = JSON.parse(atob(seg + "===".slice((seg.length + 3) % 4))).client_id || null; } catch { /* no claim */ }
  if (!clientId) return challenge("Connect through Claude's connector sign-in, not an app session.");
  const db = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: allowed } = await db.rpc("mcp_access_allowed");
  if (allowed !== true) return json({ error: "forbidden", error_description: "The PrismOS connector is not switched on for your account yet. Ask Dara." }, 403);
  const { data: staff } = await db.rpc("is_brokerage_staff");
  const ctx: Ctx = { db, admin, userId: u.user.id, staff: staff === true };

  let msg: any;
  try { msg = await req.json(); } catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400); }
  if (Array.isArray(msg)) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Batches are not supported" } }, 400);
  const { id, method, params } = msg || {};
  if (id === undefined || id === null) return new Response(null, { status: 202, headers: CORS });   // a notification
  const ok = (result: unknown) => json({ jsonrpc: "2.0", id, result });
  const err = (code: number, message: string) => json({ jsonrpc: "2.0", id, error: { code, message } });

  if (method === "initialize") {
    const want = params?.protocolVersion;
    return ok({ protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "prismos", title: "PrismOS", version: SERVER_VERSION },
      instructions: INSTRUCTIONS });
  }
  if (method === "ping") return ok({});
  if (method === "tools/list") {
    return ok({ tools: Object.entries(TOOLS).filter(([, t]) => !t.staffOnly || ctx.staff)
      .map(([name, t]) => ({ name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, ...t.annotations } })) });
  }
  if (method === "tools/call") {
    const name = params?.name; const tool = TOOLS[name];
    if (!tool || (tool.staffOnly && !ctx.staff)) return err(-32602, `Unknown tool: ${name}`);
    const started = Date.now();
    let result: unknown = null, failed: string | null = null;
    try { result = await tool.run(params?.arguments || {}, ctx); }
    catch (e) { failed = (e as Error)?.message || String(e); }
    // Usage log: who, which tool, whether it worked. Never the arguments or results.
    try { await admin.from("mcp_calls").insert({ user_id: ctx.userId, client_id: clientId, tool: name, ok: !failed, error: failed ? failed.slice(0, 300) : null, ms: Date.now() - started }); } catch { /* best-effort */ }
    if (failed) return ok({ content: [{ type: "text", text: failed }], isError: true });
    return ok({ content: [{ type: "text", text: JSON.stringify(result, null, 1) }], structuredContent: Array.isArray(result) ? { items: result } : result });
  }
  return err(-32601, `Method not found: ${method}`);
});
