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
import { INSTRUCTIONS, TOOLS, type Ctx } from "../_shared/prismTools.ts";

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
  const ctx: Ctx = { db, admin, userId: u.user.id, staff: staff === true, via: "Claude" };

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
