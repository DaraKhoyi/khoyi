// contact-transact — "can this person transact?", from their own words, with receipts.
//
// Marguerite (panel), 30 Sep: "a sentence that says 'mentioned pre-approval at
// $400K in August email' she opens every morning." The reading lives in
// _shared/transactFacts.ts; this function serves it:
//
//   Also returns last_time (_shared/lastTime.ts): what was last said, plainly.
//   POST { contact_id }  — the agent (their JWT, contact must be visible to
//                          them) or the service. Returns { line, ask, facts }.
//                          Free when nothing new has arrived (stored answer).
//   POST { sweep: true } — service only (cron contact-transact-morning, 6:35
//                          ET): everyone who wrote to an agent in the last day,
//                          so the line is current before the first call.

import "../_shared/aiGuard.ts";   // no SSN, tax ID, card or bank number reaches an AI model (30 Sep)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/serviceCaller.ts";
import { logAiUsage } from "../_shared/aiUsage.ts";
import { refreshTransact } from "../_shared/transactFacts.ts";
import { refreshLastTime } from "../_shared/lastTime.ts";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const MODEL = "claude-haiku-4-5";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));
  const service = await isServiceCaller(req);

  const usage = (c: any) => async (u: any) => {
    await logAiUsage(admin, { userId: c.user_id, fn: "contact-transact", model: MODEL, usage: u, usedOwn: false, subjectType: "contact", subjectId: c.id });
  };

  if (body.sweep) {
    if (!service) return json({ error: "Forbidden" }, 403);
    // Who wrote in the last 26 hours, by email or text, and is a saved contact.
    const since = new Date(Date.now() - 26 * 3600e3).toISOString();
    const { data: ids } = await admin.rpc("contacts_who_wrote_since", { p_since: since, p_limit: 300 });
    let refreshed = 0, cached = 0, failed = 0;
    for (const r of ids || []) {
      try {
        const { data: c } = await admin.from("contacts").select("id,user_id,email,emails,phone,phones").eq("id", r.contact_id).maybeSingle();
        if (!c) continue;
        const res = await refreshTransact(admin, c, { onUsage: usage(c) });
        try { await refreshLastTime(admin, c, { onUsage: usage(c) }); } catch (_) { /* the transact line still stands */ }
        if (res.cached) cached++; else refreshed++;
      } catch (_) { failed++; }
    }
    return json({ ok: true, candidates: (ids || []).length, refreshed, cached, failed });
  }

  const contactId = body.contact_id;
  if (!contactId) return json({ error: "contact_id required" }, 400);
  const { data: c } = await admin.from("contacts").select("id,user_id,email,emails,phone,phones").eq("id", contactId).maybeSingle();
  if (!c) return json({ error: "not found" }, 404);
  if (!service) {
    // Visible to the caller under row-level security, or not at all.
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: req.headers.get("Authorization") || "" } } });
    const { data: seen } = await asUser.from("contacts").select("id").eq("id", contactId).maybeSingle();
    if (!seen) return json({ error: "not found" }, 404);
  }
  try {
    // "Last time" (Ray, 30 Sep) travels with it: one call gives the contact
    // screen both things an agent wants before talking to someone.
    // One after the other: both write the contact's profile row, and two
    // first-time inserts at once would make two rows.
    const res = await refreshTransact(admin, c, { force: body.force === true && service, onUsage: usage(c) });
    const last = await refreshLastTime(admin, c, { force: body.force === true && service, onUsage: usage(c) }).catch(() => null);
    return json({ ok: true, ...res, last_time: last });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
