// agent-research-drip
// Runs "Research from web" on one agent at a time, on a staggered cron (offset
// from the DISC drip), so each of our agents gets a web-research profile without
// a flood of Opus + web-search calls. Mirrors the in-app flow: contact-identify
// (find/disambiguate the person) -> contact-research (web search -> profile).
//
// Progress tracked in agent_research_queue. Self-healing: reconciles rows whose
// contact already has profiles.research_taken_at, and re-opens stale 'processing'.
//
// Auth: cron sends x-internal-token (RESEARCH_TOKEN). It then calls the two
// user-gated functions with the same internal token so they accept the call.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RTOKEN = Deno.env.get("RESEARCH_TOKEN") || "";

const J = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function callFn(slug: string, body: unknown) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}`, "x-internal-token": RTOKEN },
    body: JSON.stringify(body),
  });
  let data: any = null;
  try { data = await r.json(); } catch { /* */ }
  return { ok: r.ok, status: r.status, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!RTOKEN || (req.headers.get("x-internal-token") || "") !== RTOKEN) {
      // also allow a user JWT (so it can be triggered from the app if ever needed)
      const tok = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
      const admin0 = createClient(SUPABASE_URL, SERVICE);
      const { data: { user } } = tok ? await admin0.auth.getUser(tok) : { data: { user: null } } as any;
      if (!user) return J({ error: "Not authenticated" }, 401);
    }
    const admin = createClient(SUPABASE_URL, SERVICE);

    // 1) Reconcile: anything already researched -> done.
    await admin.from("agent_research_queue").update({ status: "done", processed_at: new Date().toISOString() })
      .neq("status", "done")
      .in("contact_id", (await admin.from("profiles").select("contact_id").not("research_taken_at", "is", null)).data?.map((r: any) => r.contact_id) || ["00000000-0000-0000-0000-000000000000"]);

    // 2) Re-open stale processing (a prior run that died) older than 20 min.
    const staleCut = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    await admin.from("agent_research_queue").update({ status: "pending" })
      .eq("status", "processing").lt("processed_at", staleCut);

    // 3) Pop next pending.
    const { data: rows } = await admin.from("agent_research_queue")
      .select("id, user_id, contact_id, attempts").eq("status", "pending")
      .order("queued_at", { ascending: true }).limit(1);
    const item = rows && rows[0];
    if (!item) return J({ done: true, note: "queue empty" });

    await admin.from("agent_research_queue").update({ status: "processing", processed_at: new Date().toISOString(), attempts: (item.attempts || 0) + 1 }).eq("id", item.id);

    const finish = async (status: string, reason: string | null) =>
      admin.from("agent_research_queue").update({ status, reason, processed_at: new Date().toISOString() }).eq("id", item.id);

    try {
      // identify
      const idr = await callFn("contact-identify", { contact_id: item.contact_id });
      if (!idr.ok || idr.data?.error) { await finish((item.attempts || 0) + 1 >= 3 ? "error" : "pending", `identify: ${idr.data?.error || idr.status}`); return J({ contact_id: item.contact_id, step: "identify", error: idr.data?.error || idr.status }); }
      const candidates = idr.data?.candidates || [];
      const confidence = idr.data?.confidence || "insufficient";
      if (confidence === "insufficient") { await finish("skipped", "insufficient identifiers"); return J({ contact_id: item.contact_id, skipped: "insufficient" }); }
      if (!candidates.length) { await finish("skipped", "no public match found"); return J({ contact_id: item.contact_id, skipped: "no_match" }); }

      // research the best candidate (fast/lean config so it fits the time budget)
      const matchedBy = idr.data?.matched_by || "auto";
      await callFn("contact-research", { contact_id: item.contact_id, candidate: candidates[0], scope: "both", matched_by: matchedBy, fast: true });
      // Source of truth = did a research profile actually persist? (don't trust a
      // timeout that looked like success).
      const { data: prof } = await admin.from("profiles").select("research_taken_at").eq("contact_id", item.contact_id).maybeSingle();
      if (prof?.research_taken_at) { await finish("done", null); return J({ contact_id: item.contact_id, researched: true, candidate: candidates[0]?.name }); }
      await finish((item.attempts || 0) + 1 >= 3 ? "error" : "pending", "research did not persist (likely timeout) — will retry");
      return J({ contact_id: item.contact_id, step: "research", retry: true });
    } catch (e) {
      await finish((item.attempts || 0) + 1 >= 3 ? "error" : "pending", String((e as Error)?.message || e));
      return J({ contact_id: item.contact_id, error: String((e as Error)?.message || e) }, 200);
    }
  } catch (e) {
    return J({ error: String((e as Error)?.message || e) }, 500);
  }
});
