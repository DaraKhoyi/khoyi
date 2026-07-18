// disc-batch-nightly
// Drains the disc_analysis_queue. Processes items in priority order,
// throttled (small delay between calls so we don't spike Anthropic).
// POST { user_id?: uuid, max_items?: number }
//   user_id: optional; if omitted, runs for all users
//   max_items: cap on how many to process (default 100)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const userId: string | undefined = body.user_id;
    const maxItems: number = body.max_items || 100;

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // RECLAIM: a run that dies mid-flight leaves rows pinned at "processing"
    // forever — nothing on earth ever moves them back. 29 of Dara's were stranded
    // exactly this way, which quietly locked those contacts out of DISC for good.
    // Anything still "processing" after 30 minutes is not in flight, it is abandoned.
    await supabase.from("disc_analysis_queue")
      .update({ status: "pending" })
      .eq("status", "processing")
      .lt("queued_at", new Date(Date.now() - 30 * 60 * 1000).toISOString());

    // Pop pending items in priority order (lowest priority number = highest urgency).
    // next_attempt_at gates retries so a failing job backs off instead of hammering.
    let q = supabase.from("disc_analysis_queue")
      .select("id, user_id, contact_id, reason, priority, attempts")
      .eq("status", "pending")
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${new Date().toISOString()}`)
      .order("priority", { ascending: true })
      .order("queued_at", { ascending: true })
      .limit(maxItems);
    if (userId) q = q.eq("user_id", userId);

    const { data: items, error } = await q;
    if (error) throw error;

    const results = { processed: 0, errors: 0, items: [] as any[] };

    for (const item of items || []) {
      // Mark processing
      await supabase.from("disc_analysis_queue").update({ status: "processing" }).eq("id", item.id);

      try {
        const r = await fetch(`${SUPABASE_URL}/functions/v1/disc-analyze`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Use service role key so we don't need a user JWT inside the chained call
            "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            user_id: item.user_id,
            contact_id: item.contact_id,
            force: true,
          }),
        });
        // The platform sometimes answers with an HTML error page, not JSON. The old
        // code called r.json() straight away, so the recorded error was
        // "Unexpected token '<'" — which says nothing about what went wrong. Seven
        // of Dara's jobs died with exactly that and were undiagnosable.
        const bodyText = await r.text();
        let data: any = {};
        try { data = bodyText ? JSON.parse(bodyText) : {}; }
        catch { throw new Error(`HTTP ${r.status} — non-JSON reply: ${bodyText.slice(0, 120).replace(/\s+/g, " ")}`); }
        if (!r.ok || data.error) throw new Error(data.error || `HTTP ${r.status}`);

        await supabase.from("disc_analysis_queue").update({
          status: "done", processed_at: new Date().toISOString(), error_message: null,
        }).eq("id", item.id);

        results.processed++;
        results.items.push({ contact_id: item.contact_id, status: data.status, ok: true });
      } catch (e: any) {
        // Transient failure is the NORMAL case: a gateway hiccup, a 401 during a
        // deploy, a timeout. Dying permanently on the first one is what left 23
        // contacts unread since May with nobody the wiser.
        const attempts = (item.attempts || 0) + 1;
        const MAX_ATTEMPTS = 4;
        if (attempts < MAX_ATTEMPTS) {
          const backoffMin = Math.pow(3, attempts);        // 3, 9, 27 minutes
          await supabase.from("disc_analysis_queue").update({
            status: "pending",
            attempts,
            next_attempt_at: new Date(Date.now() + backoffMin * 60000).toISOString(),
            error_message: `attempt ${attempts}/${MAX_ATTEMPTS}: ${String(e).slice(0, 300)}`,
          }).eq("id", item.id);
        } else {
          await supabase.from("disc_analysis_queue").update({
            status: "error", processed_at: new Date().toISOString(), attempts,
            error_message: String(e).slice(0, 500),
          }).eq("id", item.id);
          // A job that is genuinely dead is NEWS. Silence is what made a six-week
          // hole possible; this is the same alert channel crash_monitor uses.
          try {
            await supabase.from("agent_runs").insert({
              user_id: item.user_id,
              agent: "disc_batch",
              status: "error",
              summary: `DISC gave up on a contact after ${MAX_ATTEMPTS} attempts: ${String(e).slice(0, 160)}`,
            });
          } catch (_) { /* alerting must never break the worker */ }
        }
        results.errors++;
        results.items.push({ contact_id: item.contact_id, ok: false, error: String(e).slice(0, 200) });
      }

      // Throttle: 600ms between Claude calls (avoid spiking)
      await sleep(600);
    }

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
