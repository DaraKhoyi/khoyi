// geocode-transactions — attaches city/ZIP/lat/lng to closed transactions that
// don't have them, using the free U.S. Census geocoder (no key, no per-lookup cost).
// New rows that come in without a contract (so #2's parse-at-source doesn't fire)
// get picked up here on a light nightly cron. We only TRUST a match that lands in
// the Tampa Bay metro (ZIP 335/336/337/344/345/346); anything else is stored as
// low-confidence and left out of the local-market stats, so we never fake a locality.
//
// verify_jwt=false (cron-called). Body: { limit?: number }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const TRUST = ["335", "336", "337", "344", "345", "346"];

function cleanAddr(a: string): string {
  return String(a || "").replace(/\s+(lot|unit|apt|#)\s*\S+$/i, "").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { limit } = await req.json().catch(() => ({ limit: 40 }));
    const cap = Math.min(Number(limit) || 40, 60);   // keep each run short + polite to Census

    const { data: rows } = await admin.from("brokerage_transactions")
      .select("id, address").is("geocoded_at", null).not("address", "is", null).neq("address", "").limit(cap);
    if (!rows || !rows.length) return new Response(JSON.stringify({ ok: true, done: 0 }), { headers: { ...cors, "Content-Type": "application/json" } });

    let done = 0, trusted = 0;
    for (const r of rows) {
      if (!/[A-Za-z]{3}/.test(r.address)) { await admin.from("brokerage_transactions").update({ geocoded_at: new Date().toISOString(), geo_source: "unparseable" }).eq("id", r.id); done++; continue; }
      let city: string | null = null, zip: string | null = null, lat: number | null = null, lng: number | null = null, src = "census";
      try {
        const u = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
        u.searchParams.set("address", cleanAddr(r.address) + ", FL");
        u.searchParams.set("benchmark", "Public_AR_Current");
        u.searchParams.set("format", "json");
        const resp = await fetch(u.toString());
        const j = await resp.json();
        const m = j?.result?.addressMatches?.[0];
        if (m) { city = m.addressComponents?.city || null; zip = m.addressComponents?.zip || null; lat = m.coordinates?.y ?? null; lng = m.coordinates?.x ?? null; }
      } catch (_) { /* leave nulls */ }
      const inArea = !!(zip && TRUST.includes(String(zip).slice(0, 3)));
      if (zip && !inArea) src = "census_low_conf";
      const patch: Record<string, unknown> = { geocoded_at: new Date().toISOString(), geo_source: src };
      if (inArea) { patch.city = (city || "").replace(/\b\w/g, (c) => c.toUpperCase()); patch.state = "FL"; patch.zip = String(zip); trusted++; }
      if (lat && lng) { patch.lat = lat; patch.lng = lng; }
      await admin.from("brokerage_transactions").update(patch).eq("id", r.id);
      done++;
      await new Promise((res) => setTimeout(res, 250));
    }
    return new Response(JSON.stringify({ ok: true, done, trusted }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
