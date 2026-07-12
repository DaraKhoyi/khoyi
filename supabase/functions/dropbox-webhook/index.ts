// Dropbox webhook receiver (verify_jwt=false, public).
// GET  -> echo the ?challenge (Dropbox endpoint verification).
// POST -> verify the X-Dropbox-Signature (HMAC-SHA256 of the raw body with the app
//         secret), then trigger a cron sync (cursor-based, so only new files are
//         pulled) for near-instant pickup instead of waiting on the 10-min cron.
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET")!;
const INGEST = Deno.env.get("INGEST_TOKEN") || "";
const enc = new TextEncoder();
function bg(p: Promise<any>) { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch (_) {} }

serve(async (req) => {
  const url = new URL(req.url);

  // 1) Verification handshake
  if (req.method === "GET") {
    const challenge = url.searchParams.get("challenge") || "";
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain", "X-Content-Type-Options": "nosniff" } });
  }

  if (req.method === "POST") {
    const raw = await req.text();
    // 2) Verify signature
    try {
      const sig = req.headers.get("X-Dropbox-Signature") || "";
      const key = await crypto.subtle.importKey("raw", enc.encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const mac = await crypto.subtle.sign("HMAC", key, enc.encode(raw));
      const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
      if (!sig || hex !== sig) return new Response("bad signature", { status: 403 });
    } catch (_) {
      return new Response("sig error", { status: 403 });
    }
    // 3) Trigger a sweep (cursor-based -> cheap; only new files become pending)
    bg(fetch(`${SUPABASE_URL}/functions/v1/dropbox-sync`, {
      method: "POST", headers: { "x-internal-token": INGEST, "Content-Type": "application/json" }, body: "{}",
    }));
    return new Response("ok", { status: 200 });
  }
  return new Response("ok", { status: 200 });
});
