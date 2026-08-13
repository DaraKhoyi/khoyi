// unstuck-weekly — Phase 3. Re-runs Unstuck. analyses on a weekly rhythm.
//
// Why this is narrow on purpose:
//  - ONLY RELEASED listings. A draft the agent never shared has no seller waiting
//    on it, and each run costs roughly $0.35. Re-running everything would spend
//    real money to refresh pages nobody opens.
//  - A 6-day floor since the last run, so a manual re-run on Friday doesn't get
//    duplicated by the Saturday cron.
//  - A hard per-invocation cap, so a future roster of hundreds of listings can
//    never produce one enormous surprise bill. Leftovers roll to the next run.
//  - Staggered: unstuck-analyze is a background task, so we fire and move on
//    rather than awaiting each one.
//
// This is NOT "live" and must never be described that way — weekly is the claim.
// verify_jwt: false — pg_cron calls with the service role, which the gateway
// rejects when verify_jwt=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MAX_PER_RUN = 25;      // cost ceiling per invocation
const MIN_DAYS_SINCE_RUN = 6;

const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: { "Access-Control-Allow-Origin": "*" } });

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  try {
    const { data: listings, error } = await admin
      .from("unstuck_listings")
      .select("id, user_id, address")
      .not("released_at", "is", null)
      .neq("status", "archived")
      .order("updated_at", { ascending: true })
      .limit(200);
    if (error) return j({ ok: false, error: error.message });
    if (!listings || !listings.length) return j({ ok: true, queued: 0, skipped: 0 });

    const cutoff = new Date(Date.now() - MIN_DAYS_SINCE_RUN * 86400000).toISOString();
    let queued = 0, skipped = 0;

    for (const l of listings) {
      if (queued >= MAX_PER_RUN) { skipped++; continue; }

      // skip anything analysed recently, and anything already mid-flight
      const { data: recent } = await admin.from("unstuck_runs")
        .select("id, status, created_at")
        .eq("listing_id", l.id)
        .order("created_at", { ascending: false })
        .limit(1);
      const last = recent && recent[0];
      if (last && last.status === "running") { skipped++; continue; }
      if (last && last.created_at > cutoff) { skipped++; continue; }

      try {
        await admin.functions.invoke("unstuck-analyze", {
          body: { listing_id: l.id, kind: "weekly", user_id: l.user_id },
        });
        queued++;
      } catch (err) {
        console.error("unstuck-weekly: could not queue " + l.id, String(err));
        skipped++;
      }
    }

    return j({ ok: true, queued, skipped, considered: listings.length });
  } catch (err) {
    return j({ ok: false, error: String(err) });
  }
});
