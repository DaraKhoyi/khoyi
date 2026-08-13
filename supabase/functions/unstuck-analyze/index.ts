// unstuck-analyze — the Unstuck. analysis engine.
//
// Diagnoses WHY a residential listing isn't selling. The system prompt below is a
// faithful implementation of UNSTUCK-RESIDENTIAL-PROMPT.md — that document is the
// source of truth, so change it there first and mirror the change here.
//
// Design notes that matter:
//  - NOT LIVE. No realtime claim. Weekly re-runs arrive in Phase 3; this function
//    is the same code path for 'initial' and 'weekly', so Phase 3 is a cron caller.
//  - Web search is ON, because rates, insurance conditions and active competition
//    all move and must never be answered from memory.
//  - Returns THREE registers (agent / seller / say-this) plus normalised findings,
//    so the portal can render a timeline instead of a static PDF.
//  - Every finding is tagged SOURCED / DERIVED / ASSUMED. An unlabelled number is
//    the failure mode this whole feature exists to avoid.
//  - AI cost is attributed to the billing agent via logAiUsage (standing rule).
//
//  - RUNS AS A BACKGROUND TASK. Claude + web search takes longer than the edge
//    gateway's 150s idle timeout, so the request returns as soon as the run row
//    exists and the analysis continues via EdgeRuntime.waitUntil(). The client
//    polls the run's status. Doing this inline is what left the first test run
//    wedged in 'running' forever with the listing stuck on 'analyzing'.
//
// verify_jwt: false — called with the agent's JWT from the app, and (Phase 3) by
// pg_cron with the service role, which the gateway rejects when verify_jwt=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const j = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const SYSTEM = `You are a panel of six residential real-estate experts diagnosing why a listing is not selling. Hold all six views at once and let them disagree: (1) a listing agent with 500+ closed sides in this county, (2) the buyer's agent who showed it and did NOT write an offer, (3) a residential appraiser who must defend the price to an underwriter, (4) a Florida homeowner's insurance underwriter deciding if this roof/age/zone is writable at all, (5) a mortgage loan officer qualifying a real buyer at today's rate, (6) the buyer, a household with a payment ceiling. Where they disagree, SHOW the disagreement rather than averaging it away.

THE PREMISE UNDER TEST: the reflex diagnosis is "it's priced too high." Treat that as a hypothesis, not a given. Price is often the symptom. The binding constraint is frequently exposure, photography, access friction, insurability, an uncorrectable defect the price has not yet absorbed, or a payment-math ceiling. If price IS the cause, prove it with arithmetic. The agent would rather be corrected than agreed with.

DO THE WORK IN THIS ORDER:
1. TRIAGE FIRST on showings-to-offers. Few/no showings = failing before the house is seen (price band, photos, remarks, exposure, compensation). Showings but no second showings = reality doesn't match the photos (condition, smell, deferred maintenance, first ten feet). Second showings but no offers = buyers want it but math or a defect stops them. Offers dying in escrow = appraisal, financing, inspection or insurability. Name the row and defend it; everything downstream depends on it.
2. Rebuild the BUYER'S MONTHLY PAYMENT, not the price. Use today's actual rate, and taxes at the RESET millage a new buyer pays — never the seller's homesteaded number. That error is routine in Florida and understates the payment by hundreds a month. Include insurance quoted for THIS roof age, HOA, CDD, PMI.
3. Check the SEARCH-PORTAL BAND CLIFF. Buyers search in round brackets; a house at 505,000 is invisible to every buyer filtering at 500,000. Identify the nearest cliff, estimate audience gained, price the move.
4. Build the competitive set the way a BUYER does, including new construction with incentives (appraisers exclude it, buyers do not).
5. Split defects three ways: correctable cheaply (under $1,500, under a week), correctable expensively (cost, value effect, effect on INSURABILITY and FINANCEABILITY, whether a credit beats the work), and UNCORRECTABLE (busy road, power lines, flood zone, floor plan, no garage, age restriction). Uncorrectable defects cannot be fixed and must therefore be PRICED — quantify each as a discount the market demands.
6. Test insurability and financeability as PASS/FAIL GATES: roof age vs carrier appetite, 4-point, wind mitigation, flood, prior claims, condo milestone inspection and reserves, unpermitted work, and whether conventional financing exists for this property type at all.
7. Separate MARKET from LISTING. If comparable homes are selling and this one is not, it is the listing. If nothing is selling, it is the market — and the advice is completely different.
8. Reconcile with WHAT THE SELLER CAN ALREADY SEE. They have stared at a Zestimate for weeks. If you recommend a number well under it, address the gap head-on or you lose the argument before the evidence is read. Note that portal DOM and MLS DOM often disagree because portals keep counting through a withdrawal and relist.
9. Reconsider the question: is selling now, in this configuration, even the best move? Lease, lease-option, seller financing, repair-and-relaunch, or a clean-DOM relaunch may beat another price cut. Say so even though you were not asked.

RULES OF EVIDENCE — NON-NEGOTIABLE:
- Tag every material number SOURCED (with citation), DERIVED (show the calculation), or ASSUMED (state the assumption). Never present an assumed number as fact. If you cannot source it, say so and give a range.
- SEARCH for anything time-sensitive: mortgage rates, insurance conditions, local absorption, active competition, new-construction incentives. Never answer from memory on anything that moves.
- NEVER invent an MLS number, a comparable address, a carrier name, or a contact. Leave it blank and say why. A fabricated comp is worse than a gap.
- FAIR HOUSING IS A HARD CONSTRAINT. Never characterise a neighbourhood, school or buyer pool by race, religion, national origin, familial status, disability or any protected class, and never use proxy language. Schools only as objective ratings a buyer can look up. Steer no one.
- Flag anything needing counsel, a CPA, a licensed inspector or an underwriter.

ADVERSARIAL PASS before you finalise: argue the strongest case that your recommendation is WRONG. What single piece of evidence would most change it? If you recommend a price cut, what is the case that cutting here rewards buyers for waiting and starts a slide? Keep the surviving recommendation.

THREE REGISTERS, because the seller reads one of these directly:
- agent_report: full evidence and arithmetic, for the agent.
- seller_report: professional, calm, evidence-led, deliverable to a frustrated seller without reading as blame or as a pitch for a price cut. LEAD WITH WHAT IS WORKING. State uncorrectable defects ONCE, plainly, with a number, then pivot immediately to the lever the seller controls (price or terms).
- say_this: the two or three sentences the agent can actually say out loud on a Tuesday without triggering a defensive reaction.

A report that lists only fixable things is a comfortable report, not a true one. If there are uncorrectable defects, name them and convert them to a number.

seller_safe MEANS ONE THING ONLY: is this a note about the SELLER or about strategy that would be awkward for them to read (that they are interviewing other agents, their unrealistic expectations, negotiation posture, competitive intel). seller_safe MUST be true for every finding about the PROPERTY ITSELF, including every uncorrectable defect. A busy road, a pond with no privacy, an ageing roof, a dated kitchen, a bad floor plan: the seller must see all of these. Never use seller_safe=false to spare the seller a hard truth about their own house — that is the exact failure this report exists to prevent.

OUTPUT CONTRACT — THIS OVERRIDES EVERYTHING ELSE. Your entire reply must be ONE JSON object and nothing else. Do not narrate your searches. Do not summarise findings before the JSON. Do not write "Now I have enough data". Do not use markdown fences. The FIRST character you emit must be { and the LAST must be }. Keep agent_report under 900 words and seller_report under 600 words so the object is never truncated mid-string. Shape:
{"diagnosis":"one sentence — the lead","triage_row":"no_showings|no_second|no_offers|dying_escrow","highest_leverage_action":"startable within a day","agent_report":"markdown","seller_report":"markdown","say_this":"2-3 sentences","public_sources":{"note":"how our view reconciles with Zestimate/Redfin/portal DOM"},"findings":[{"kind":"correctable_cheap|correctable_costly|uncorrectable|market|payment|insurability|exposure","title":"short","detail":"what and why","evidence":"SOURCED: ... | DERIVED: ... | ASSUMED: ...","severity":1-5,"dollar_impact":number|null,"effort":"e.g. under a week","seller_safe":true|false}]}`;

function facts(l: any, comps: any[]): string {
  const F = (k: string, v: unknown, suffix = "") =>
    (v === null || v === undefined || v === "") ? `${k}: NOT PROVIDED` : `${k}: ${v}${suffix}`;
  const lines = [
    F("Address", l.address), F("City", l.city), F("County", l.county),
    F("Subdivision", l.subdivision), F("MLS#", l.mls_number),
    F("Current ask", l.list_price), F("Original ask", l.original_list_price),
    F("Cumulative DOM", l.dom_cumulative), F("DOM at current price", l.dom_current_price),
    F("Previously withdrawn/relisted", l.previously_withdrawn),
    F("Beds", l.beds), F("Baths", l.baths), F("SqFt", l.sqft), F("Lot sqft", l.lot_sqft),
    F("Year built", l.year_built), F("Property type", l.property_type),
    F("HOA", l.hoa_amount, " per " + (l.hoa_period || "?")), F("CDD", l.cdd_amount),
    F("Flood zone", l.flood_zone), F("Roof age (yrs)", l.roof_age), F("HVAC age (yrs)", l.hvac_age),
    F("Current insurance premium", l.insurance_annual), F("Taxes (seller's current)", l.taxes_annual),
    F("Assessments pending", l.assessments_pending),
    "",
    "THE DIAGNOSTIC — triage on these first:",
    F("Showings", l.showings), F("Second showings", l.second_showings), F("Offers", l.offers),
    F("Showing feedback received", l.feedback_notes),
    "",
    "EXPOSURE:",
    F("Photo count", l.photo_count), F("Video", l.has_video),
    F("Floor plan", l.has_floorplan), F("3D tour", l.has_3d),
    F("Showing access", l.showing_access), F("Showing restrictions", l.showing_restrictions),
    F("Buyer-agent compensation", l.buyer_agent_comp),
    "",
    "WHAT THE SELLER CAN ALREADY SEE:",
    F("Zestimate", l.zestimate), F("Redfin estimate", l.redfin_estimate),
    F("Portal-displayed DOM", l.portal_dom),
    "",
    "OBJECTIVE FUNCTION (ranked by the agent):",
    F("1st", l.priority_1), F("2nd", l.priority_2), F("3rd", l.priority_3),
    F("Seller constraints", l.seller_constraints),
    F("Agent notes", l.agent_notes),
  ];
  if (comps.length) {
    lines.push("", "COMPETITIVE SET the agent supplied:");
    for (const c of comps) {
      lines.push(`- ${c.address || "(address withheld)"} | ${c.list_price ?? "?"} | ${c.beds ?? "?"}bd/${c.baths ?? "?"}ba | ${c.sqft ?? "?"}sf | DOM ${c.dom ?? "?"} | ${c.status || "?"} | ${c.advantage || ""} ${c.note || ""}`);
    }
  } else {
    lines.push("", "COMPETITIVE SET: none supplied by the agent — build it from public sources via search, and say plainly that it is unverified.");
  }
  lines.push("", "Anything marked NOT PROVIDED is a genuine gap. List the gaps with the largest swing on the answer, and model a range rather than inventing a value.");
  return lines.join("\n");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let runId: string | null = null;
  let body_listing_id: string | null = null;

  try {
    const body = await req.json();
    const listing_id = body.listing_id; body_listing_id = listing_id;
    const kind = body.kind || "initial";
    if (!listing_id) return j({ ok: false, error: "listing_id required" });

    const { data: l } = await admin.from("unstuck_listings").select("*").eq("id", listing_id).maybeSingle();
    if (!l) return j({ ok: false, error: "listing not found" });

    // bill the owning agent; body.user_id only as a cron-side fallback
    const billUserId = l.user_id || body.user_id || null;

    const { data: comps } = await admin.from("unstuck_competitors")
      .select("*").eq("listing_id", listing_id);

    // any earlier run left wedged by a crash or timeout is superseded, not orphaned
    await admin.from("unstuck_runs")
      .update({ status: "failed", error: "superseded by a newer run" })
      .eq("listing_id", listing_id).eq("status", "running");

    const { data: run } = await admin.from("unstuck_runs")
      .insert({ listing_id, user_id: billUserId, kind, status: "running", model: MODEL })
      .select("id").single();
    runId = run?.id ?? null;
    await admin.from("unstuck_listings").update({ status: "analyzing" }).eq("id", listing_id).neq("status", "released");

    // Return NOW; keep working in the background. The gateway kills an idle
    // request at 150s and this reliably takes longer.
    const work = runAnalysis(admin, l, comps || [], listing_id, runId, billUserId);
    // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(work);
    else await work;
    return j({ ok: true, run_id: runId, status: "running" });
  } catch (err) {
    if (runId) {
      try { await admin.from("unstuck_runs").update({ status: "failed", error: String(err) }).eq("id", runId); } catch (_) {}
      try { await admin.from("unstuck_listings").update({ status: "draft" }).eq("id", body_listing_id!); } catch (_) {}
    }
    return j({ ok: false, error: String(err) });
  }
});

async function runAnalysis(admin: any, l: any, comps: any[], listing_id: string, runId: string | null, billUserId: string | null) {
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
        messages: [{ role: "user", content: "Diagnose why this listing is not selling.\n\n" + facts(l, comps || []) }],
      }),
    });
    const data = await resp.json();

    try {
      await logAiUsage(admin, { userId: billUserId, fn: "unstuck-analyze", model: MODEL, usage: data?.usage, usedOwn: false });
    } catch (_) { /* never fail the run on a telemetry write */ }

    if (!resp.ok) {
      const msg = (data && (data.error?.message || data.message)) || ("HTTP " + resp.status);
      if (runId) await admin.from("unstuck_runs").update({ status: "failed", error: msg }).eq("id", runId);
      await admin.from("unstuck_listings").update({ status: "draft" }).eq("id", listing_id).neq("status", "released");
      return;
    }

    // Claude returns a mix of text and tool blocks when web search runs; take the text.
    const text = (data.content || [])
      .filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

    let parsed: any = null;
    try {
      parsed = JSON.parse(text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim());
    } catch (_) {
      const a = text.indexOf("{"), b = text.lastIndexOf("}");
      if (a > -1 && b > a) { try { parsed = JSON.parse(text.slice(a, b + 1)); } catch (_) { /* fall through */ } }
    }
    if (!parsed) {
      if (runId) await admin.from("unstuck_runs").update({ status: "failed", error: "could not parse model output", raw: { text } }).eq("id", runId);
      await admin.from("unstuck_listings").update({ status: "draft" }).eq("id", listing_id).neq("status", "released");
      return;
    }

    await admin.from("unstuck_runs").update({
      status: "done",
      diagnosis: parsed.diagnosis || null,
      triage_row: parsed.triage_row || null,
      agent_report: parsed.agent_report || null,
      seller_report: parsed.seller_report || null,
      say_this: parsed.say_this || null,
      public_sources: parsed.public_sources || null,
      raw: parsed,
      input_tokens: data?.usage?.input_tokens ?? null,
      output_tokens: data?.usage?.output_tokens ?? null,
    }).eq("id", runId);

    const findings = Array.isArray(parsed.findings) ? parsed.findings : [];
    if (findings.length) {
      // a re-run supersedes the previous open findings for this listing
      await admin.from("unstuck_findings").delete().eq("listing_id", listing_id).eq("status", "open");
      const rows = findings.slice(0, 60).map((f: any, i: number) => ({
        listing_id, run_id: runId,
        kind: f.kind || "market",
        title: String(f.title || "").slice(0, 300),
        detail: f.detail || null,
        evidence: f.evidence || null,
        severity: Math.max(1, Math.min(5, Number(f.severity) || 3)),
        dollar_impact: (f.dollar_impact === null || f.dollar_impact === undefined || isNaN(Number(f.dollar_impact))) ? null : Number(f.dollar_impact),
        effort: f.effort || null,
        // Backstop for the model's judgement: a truth about the PROPERTY is always
        // seller-facing. Left to itself the model hid the roof, the pond and the
        // dated-condition discount behind seller_safe=false, which is exactly the
        // comfortable-report failure this feature exists to prevent.
        seller_safe: ["uncorrectable", "correctable_cheap", "correctable_costly",
                      "insurability", "payment", "exposure", "market"].indexOf(f.kind) > -1
                     ? true : (f.seller_safe !== false),
        sort_order: i,
      }));
      const { error: fErr } = await admin.from("unstuck_findings").insert(rows);
      if (fErr) console.error("finding insert failed", fErr.message);
    }

    // NEVER stomp a released listing. status does double duty (workflow + release)
    // and a re-run used to silently flip 'released' -> 'analyzed', darkening the
    // seller's link. Under the Phase 3 weekly cron that would have killed every
    // seller portal every week, invisibly.
    await admin.from("unstuck_listings")
      .update({ status: "analyzed", updated_at: new Date().toISOString() })
      .eq("id", listing_id).neq("status", "released");
    await admin.from("unstuck_listings")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", listing_id).eq("status", "released");

    try {
      await admin.functions.invoke("push-send", { body: {
        user_id: billUserId,
        title: "Unstuck. analysis ready",
        body: (parsed.diagnosis || "Your listing analysis is ready.").slice(0, 140),
        url: "https://darasapp.com/?view=unstuck", tag: "unstuck",
      } });
    } catch (_) { /* best-effort */ }

  } catch (err) {
    if (runId) {
      try { await admin.from("unstuck_runs").update({ status: "failed", error: String(err) }).eq("id", runId); } catch (_) {}
    }
    try { await admin.from("unstuck_listings").update({ status: "draft" }).eq("id", listing_id).neq("status", "released"); } catch (_) {}
  }
}
