// recording-purge
// Sweeps recordings whose audio_purge_at has passed. Deletes the audio file
// from storage, marks audio_purged=true, clears storage_path. Transcript stays.
//
// Triggered by pg_cron daily.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { data: rows, error } = await supabase
      .from("recordings")
      .select("id, user_id, storage_path")
      .eq("audio_purged", false)
      .not("storage_path", "is", null)
      .lte("audio_purge_at", new Date().toISOString())
      .limit(200);
    if (error) throw error;

    let purged = 0;
    let errors = 0;
    for (const r of rows || []) {
      try {
        const { error: delErr } = await supabase.storage.from("recordings").remove([r.storage_path]);
        if (delErr && !String(delErr.message || "").includes("not found")) throw delErr;
        await supabase.from("recordings").update({
          audio_purged: true,
          storage_path: null,
        }).eq("id", r.id);
        purged++;
      } catch (_) {
        errors++;
      }
    }

    return new Response(JSON.stringify({ ok: true, purged, errors, scanned: rows?.length || 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
