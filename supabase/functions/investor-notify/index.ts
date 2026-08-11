// investor-notify — after a property is matched, push each owning agent whose
// investor got a new match. Runs server-side (service role) so it can see across
// agents; it only ever sends a push to the buyer's OWN agent and never leaks buyer
// identity to the submitter. Called by pg_net from investor_save_property.
//
// verify_jwt=false (called by pg_net with the service key). Body: { property_id }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { property_id } = await req.json().catch(() => ({}));
    if (!property_id) return new Response(JSON.stringify({ error: "property_id required" }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });

    // the property (for the push text — city only, no buyer info)
    const { data: prop } = await admin.from("investor_properties").select("address, city, price").eq("id", property_id).maybeSingle();
    const where = prop ? (prop.city || prop.address || "your area") : "your area";
    const priceStr = prop && prop.price ? " · $" + Math.round(Number(prop.price)).toLocaleString("en-US") : "";

    // fresh, un-notified matches for this property, joined to the buyer name
    const { data: matches } = await admin.from("investor_matches")
      .select("id, buyer_owner_user_id, buyer_id, notified_at, investor_buyers!inner(name)")
      .eq("property_id", property_id).eq("status", "new");
    if (!matches || !matches.length) return new Response(JSON.stringify({ ok: true, notified: 0 }), { headers: { ...cors, "Content-Type": "application/json" } });

    // group by owning agent (one push per agent even if several of their buyers matched)
    const byAgent = new Map<string, { count: number; name: string; ids: string[] }>();
    for (const m of matches) {
      if (m.notified_at) continue;
      const uid = m.buyer_owner_user_id;
      const nm = (m.investor_buyers && (m.investor_buyers as any).name) || "your investor";
      const cur = byAgent.get(uid) || { count: 0, name: nm, ids: [] };
      cur.count++; cur.ids.push(m.id);
      byAgent.set(uid, cur);
    }

    let notified = 0;
    for (const [uid, info] of byAgent) {
      const title = "🎯 New match for " + (info.count > 1 ? info.count + " of your investors" : info.name);
      const body = info.count > 1
        ? "A property in " + where + priceStr + " fits " + info.count + " of your buyers. Tap to present."
        : "A property in " + where + priceStr + " fits " + info.name + "'s buy-box. Tap to present.";
      try {
        await admin.functions.invoke("push-send", { body: {
          user_id: uid, title, body, url: "https://darasapp.com/?view=investor_pipeline&tab=matches", tag: "investor-match",
        } });
        notified++;
      } catch (_) { /* best-effort */ }
      // mark these matches notified so re-runs don't double-ping
      await admin.from("investor_matches").update({ notified_at: new Date().toISOString() }).in("id", info.ids);
    }
    return new Response(JSON.stringify({ ok: true, notified }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
