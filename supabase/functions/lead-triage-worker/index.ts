// lead-triage-worker — keeps the lead queue honest without anyone asking.
//
// THE PROBLEM THIS SOLVES. The funnel cut Dara's queue from 3,159 to 47 using
// header signals, and running email-intelligence by hand over the survivors found
// 19 spam that no header could catch — clean domains, no unsubscribe header, no
// Gmail category. Only reading the message finds those. But that was a manual
// pass, so the queue starts drifting again the next morning.
//
// WHY A WORKER AND NOT A CALL INSIDE gmail-sync.
// The easy version is to invoke email-intelligence from the sync loop. That would
// put an AI call on the mail sync's latency budget, and — worse — a failure would
// vanish. An unjudged lead would look exactly like a judged-and-cleared one, which
// is the precise failure mode the whole 3,159 mess was made of.
//
// So: intake queues, a worker classifies, and a lead that cannot be classified
// stays VISIBLY unjudged. Same shape as the outbox for voice notes — nothing is
// deleted because a step failed.
//
// RETRY IS BOUNDED. Four attempts, then the lead is left alone with its attempt
// count recorded. It still appears in the queue as 'unknown', because an unjudged
// thread is not evidence of nothing — it is a thing we have not looked at, and
// hiding it would lose a real lead the moment triage falls behind.
//
// verify_jwt = false; reached only by pg_cron with QCP_TOKEN.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const INTERNAL = Deno.env.get("QCP_TOKEN") || "";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-internal-token" };
const J = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const PER_RUN = 12;      // small batches: this runs every 10 minutes, forever
const MAX_ATTEMPTS = 4;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  // Cron-only. No user path at all — there is nothing here a person should call.
  const tok = req.headers.get("x-internal-token") || "";
  if (!INTERNAL || tok !== INTERNAL) return J({ error: "internal only" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE);

  // Candidates: pending leads inside the 14-day window whose thread has no verdict
  // yet and which we have not already given up on.
  const { data: leads, error } = await admin
    .from("lead_concierge")
    .select("id, user_id, lead_email, triage_attempts")
    .eq("status", "pending")
    .gte("created_at", new Date(Date.now() - 14 * 86400000).toISOString())
    .lt("triage_attempts", MAX_ATTEMPTS)
    .not("lead_email", "is", null)
    .order("created_at", { ascending: false })
    .limit(PER_RUN * 4);

  if (error) return J({ error: error.message }, 500);
  if (!leads || !leads.length) return J({ ok: true, checked: 0, triaged: 0 });

  let triaged = 0, skipped = 0, failed = 0;

  for (const lead of leads) {
    if (triaged + failed >= PER_RUN) break;

    // Find the thread this lead came from.
    const { data: msg } = await admin.from("email_messages")
      .select("thread_id")
      .eq("user_id", lead.user_id).ilike("from_address", lead.lead_email)
      .not("thread_id", "is", null)
      .order("internal_date", { ascending: false }).limit(1).maybeSingle();

    if (!msg?.thread_id) { skipped++; continue; }

    // Already judged? Nothing to do — another path may have classified it.
    const { data: existing } = await admin.from("email_triage")
      .select("id").eq("thread_id", msg.thread_id).eq("user_id", lead.user_id).limit(1).maybeSingle();
    if (existing) { skipped++; continue; }

    try {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/email-intelligence`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-token": INTERNAL,
          // The gateway still wants SOME bearer; identity comes from the internal
          // header plus user_id, never from this.
          "Authorization": `Bearer ${SERVICE}`,
        },
        body: JSON.stringify({ thread_id: msg.thread_id, user_id: lead.user_id }),
      });
      if (!r.ok) throw new Error("HTTP " + r.status);
      triaged++;
      await admin.from("lead_concierge")
        .update({ triage_attempts: (lead.triage_attempts || 0) + 1 }).eq("id", lead.id);
    } catch (_) {
      failed++;
      // Count the attempt so a permanently broken thread cannot spin forever, but
      // NEVER change status — a lead we failed to classify is still a lead.
      await admin.from("lead_concierge")
        .update({ triage_attempts: (lead.triage_attempts || 0) + 1 }).eq("id", lead.id);
    }
  }

  // Retire what the classifier has since judged as junk. Done HERE rather than in
  // email-intelligence so that function keeps one job: classify. This one owns the
  // consequence.
  const { data: junk } = await admin.rpc("lead_retire_judged_junk");

  return J({ ok: true, checked: leads.length, triaged, skipped, failed, retired: junk ?? 0 });
});
