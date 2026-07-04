// track-open — serves the 1x1 open-tracking pixel and logs the hit.
// Public endpoint (verify_jwt=false). URL: /functions/v1/track-open?t={token}
// Returns a transparent GIF regardless, so email clients never see a broken image.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 1x1 transparent GIF
const GIF = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (c) => c.charCodeAt(0));
const pixel = () => new Response(GIF, {
  headers: {
    "Content-Type": "image/gif",
    "Content-Length": String(GIF.length),
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    "Pragma": "no-cache",
    "Expires": "0",
    "Access-Control-Allow-Origin": "*",
  },
});

serve(async (req) => {
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("t") || url.searchParams.get("token") || "";
    if (!token) return pixel();

    const supabase = createClient(SUPABASE_URL, SERVICE);
    const { data: row } = await supabase.from("email_tracking").select("*").eq("token", token).maybeSingle();
    if (!row) return pixel();

    const ua = req.headers.get("user-agent") || "";
    const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim()
      || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
    const uaL = ua.toLowerCase();

    const nowMs = Date.now();
    const sentMs = row.sent_at ? new Date(row.sent_at).getTime() : nowMs;
    const secsSinceSend = (nowMs - sentMs) / 1000;

    // --- classify the hit -------------------------------------------------
    let isMachine = false;
    let reason = "human";
    let appleMpp = false;

    // Gmail proxies every image through Google. It fetches when the user opens
    // (not on delivery), so a Google-proxy hit is a real open — but the IP is
    // Google's, so location is meaningless.
    if (uaL.includes("googleimageproxy") || uaL.includes("via ggpht")) reason = "google_proxy";

    // Very fast hits are security scanners or delivery-time prefetch, not a human.
    if (secsSinceSend >= 0 && secsSinceSend < 10) { isMachine = true; reason = "fast_prefetch"; }

    // Apple Mail Privacy Protection: best-effort. Apple's proxy carries a generic
    // desktop UA and typically prefetches near delivery. If we ever add IP-range
    // matching this is where it slots in; for now the fast-prefetch guard catches
    // the common case and we simply flag the record for honest UI labeling.
    if (uaL.includes("applewebkit") && !uaL.includes("mobile") && secsSinceSend < 120 && reason !== "google_proxy") {
      appleMpp = true; isMachine = true; reason = "apple_mpp";
    }

    const nowIso = new Date().toISOString();

    // log the raw event
    try {
      await supabase.from("email_open_events").insert({
        tracking_id: row.id, opened_at: nowIso, ip: ip || null, user_agent: ua || null,
        is_machine: isMachine, reason,
      });
    } catch (_e) { /* non-fatal */ }

    // roll up onto the tracking row
    const patch: Record<string, unknown> = {
      last_open_at: nowIso,
      open_count: (row.open_count || 0) + 1,
    };
    if (!row.first_open_at) patch.first_open_at = nowIso;
    if (appleMpp && !row.apple_mpp) patch.apple_mpp = true;
    if (!isMachine && !row.confident_open_at) { patch.confident_open_at = nowIso; patch.status = "likely_seen"; }
    else if (isMachine && row.status === "sent" && !row.confident_open_at) patch.status = "opened_machine";
    try { await supabase.from("email_tracking").update(patch).eq("id", row.id); } catch (_e) { /* non-fatal */ }

    return pixel();
  } catch (_e) {
    return pixel();
  }
});
