// property-research
// Researches a subject property + local market + recent comparable sales using
// Claude's web_search tool against PUBLIC real-estate sources (Zillow, Realtor.com,
// Redfin, county property appraiser records, Homes.com, etc.). A stand-in for a live
// IDX/MLS feed until one is connected.
//
// POST { address, user_id?, subject_hint? }  (Authorization: user JWT or service role)
// -> { ok, data: { subject, market, comps[], sources[], notes } }
//
// Returns ONLY factual public data (price, beds/baths, sqft, lot, year, sold prices,
// inventory counts). Never reproduces copyrighted listing descriptions verbatim.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function extractJson(text: string): any | null {
  // pull the last {...} block (the model sometimes narrates first)
  const fences = text.match(/```(?:json)?\s*([\s\S]*?)```/gi);
  const tryParse = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
  if (fences) {
    for (let i = fences.length - 1; i >= 0; i--) {
      const inner = fences[i].replace(/```(?:json)?/i, "").replace(/```$/, "").trim();
      const v = tryParse(inner); if (v) return v;
    }
  }
  const first = text.indexOf("{"), last = text.lastIndexOf("}");
  if (first !== -1 && last > first) { const v = tryParse(text.slice(first, last + 1)); if (v) return v; }
  return null;
}

const PROMPT = (address: string, hint: string) => `You are a real-estate valuation researcher preparing data for a listing presentation. Research the subject property and its local market using web search of PUBLIC sources: Zillow, Realtor.com, Redfin, Homes.com, and the county property appraiser / public tax records. ${hint ? `Context from the agent: ${hint}` : ""}

SUBJECT PROPERTY: ${address}

Do this:
1. Find the subject's public facts: living area (GLA sqft), beds, baths, lot size, year built, last sold price/date if available, and current Zestimate/Redfin estimate if shown. IMPORTANT: individual listing pages on Zillow/Redfin are often blocked to automated access — so ALSO search the COUNTY PROPERTY APPRAISER / public tax-assessor records for this address (e.g. for Florida: the county Property Appraiser site, "[County] property appraiser [address]"), which publishes GLA, year built, beds/baths, lot size and last sale as open public record. Try the county records explicitly if the portals don't return the subject facts.
2. Find 3-6 RECENT comparable SOLD homes (last ~6 months) near the subject — similar size, beds/baths, and area. For EACH comp gather as many of these as you can find: full address, sold price, sold date, GLA sqft, beds, baths, year built, lot size (sqft or acres), garage spaces, pool (yes/no). CONDITION FROM PHOTOS: when a comp's listing page (Zillow/Redfin/Realtor) is reachable, LOOK AT ITS PHOTOS and rate its condition the way an appraiser would — read the kitchen (updated / dated / original), bathrooms, flooring and finishes, curb appeal, and any visible deferred maintenance. Return a concise condition read (e.g. "updated kitchen & baths, move-in", "clean but dated ~2000s finishes", "original/tired, needs updating", "distressed/as-is") AND a "condition_basis" naming what in the photos drove it (e.g. "photos show renovated kitchen, new LVP flooring, refreshed baths"). If photos aren't reachable, infer from the listing description and say so in condition_basis. These attributes and the photo-read condition are what let us adjust each comp to the subject line-by-line.
3. Assess the LOCAL market (that ZIP or submarket): approximate months of inventory, median list-to-sale ratio, and rough counts of active / pending / recently-closed listings. Estimate a "market speed" 0-100 where 0 = deep buyer's market, 50 = balanced, 100 = strong seller's market.
4. VALUATION — this is the most important output. Using the comparable sales you found, estimate what the subject would sell for:
   - Compute each comp's price-per-sqft (sold price / GLA). Take the median (or a size-weighted read) and apply it to the subject's GLA to get a base market value. If the subject GLA is unknown, estimate it from the comps' typical size for that area and say so in notes.
   - Sanity-check against any Zestimate/Redfin estimate and the subject's last sale trended to today.
   - Then give THREE pricing tiers as whole dollar amounts:
       target        = your best market-value estimate (priced to sell at market pace)
       opportunistic = a "test the ceiling" price, typically ~4-8% above target
       fast          = a "move it quickly" price, typically ~3-6% below target
   - These MUST be positive dollar figures whenever you have at least one usable comp. Do NOT return 0. Only use null if you genuinely found no comps and no estimate at all — and then explain why in notes.

Rules:
- Use ONLY factual, publicly available figures for the raw data. Do NOT copy listing description prose.
- If a RAW figure isn't findable, use null — never guess a specific number you didn't find.
- The VALUATION is your professional estimate FROM the comps — it's expected to be a derived number, not a looked-up fact. Always produce it when comps exist.
- Cite the source URLs you actually used.

Keep any narration to an absolute minimum — do the searches, then output the JSON. The JSON object must be the LAST thing in your response, complete and valid.

Output a SINGLE json object (and nothing after it) in EXACTLY this shape:
{
  "subject": { "gla": number|null, "beds": number|null, "baths": number|null, "lot_size": string|null, "year_built": number|null, "garage": number|null, "pool": boolean|null, "condition": string|null, "last_sold_price": number|null, "estimate": number|null },
  "market": { "speed": number, "moi": number|null, "list_to_sale": number|null, "active": number|null, "pending": number|null, "closed": number|null, "annual_appreciation_pct": number|null },
  "comps": [ { "address": string, "sale_price": number, "sold_date": string, "gla": number|null, "beds": number|null, "baths": number|null, "year_built": number|null, "lot_size": string|null, "garage": number|null, "pool": boolean|null, "condition": string|null, "condition_basis": string|null } ],
  "valuation": { "estimate": number|null, "ppsf": number|null, "tiers": { "opportunistic": number|null, "target": number|null, "fast": number|null }, "basis": string },
  "sources": [ string ],
  "notes": string,
  "confidence": "high"|"medium"|"low"
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE);
  try {
    const body = await req.json().catch(() => ({}));
    const address = (body?.address || "").toString().trim();
    if (!address) return J({ error: "address is required" }, 400);
    const hint = (body?.subject_hint || "").toString().slice(0, 600);

    // Identify the billing user: a real JWT if present, else body.user_id (service call).
    let billUserId: string | null = body?.user_id || null;
    const authHeader = req.headers.get("Authorization") || "";
    const tokenStr = authHeader.replace("Bearer ", "");
    if (tokenStr && tokenStr !== SERVICE && tokenStr !== ANON) {
      try { const { data } = await admin.auth.getUser(tokenStr); if (data?.user) billUserId = data.user.id; } catch (_) {}
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 230000);
    let apiResp: Response;
    try {
      apiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        signal: controller.signal,
        body: JSON.stringify({ model: MODEL, max_tokens: 4500, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }], messages: [{ role: "user", content: PROMPT(address, hint) }] }),
      });
    } finally { clearTimeout(timer); }
    if (!apiResp.ok) {
      const t = await apiResp.text();
      console.error("anthropic", apiResp.status, t.slice(0, 300));
      return J({ error: `Research service error ${apiResp.status}. Please try again.` }, 502);
    }
    const apiData = await apiResp.json();
    try { await logAiUsage(admin, { userId: billUserId, fn: "property-research", model: MODEL, usage: apiData?.usage, usedOwn: false }); } catch (_) {}

    const fullText = (apiData.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const data = extractJson(fullText);
    if (!data) return J({ error: "Could not parse the research result. Please try again.", raw: fullText.slice(0, 400) }, 502);

    // Normalize/guard the shape so the client can trust it.
    const num = (v: any) => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);
    const bool = (v: any) => (v === true || v === "yes" || v === "true") ? true : (v === false || v === "no" || v === "false") ? false : null;
    const lotToSqft = (v: any): number | null => {
      if (v == null) return null; const s = String(v).toLowerCase();
      const n = parseFloat(s.replace(/[^0-9.]/g, "")); if (isNaN(n) || n <= 0) return null;
      const sqft = /ac/.test(s) ? Math.round(n * 43560) : Math.round(n);
      // Sanity: residential lots ~1k–435k sqft (10 acres). Anything outside is bad data → ignore.
      return (sqft >= 800 && sqft <= 435600) ? sqft : null;
    };
    const subject = {
      gla: num(data.subject?.gla), beds: num(data.subject?.beds), baths: num(data.subject?.baths),
      lot_size: data.subject?.lot_size ?? null, lot_sqft: lotToSqft(data.subject?.lot_size),
      year_built: num(data.subject?.year_built), garage: num(data.subject?.garage), pool: bool(data.subject?.pool),
      condition: data.subject?.condition ?? null,
      last_sold_price: num(data.subject?.last_sold_price), estimate: num(data.subject?.estimate),
    };
    let comps = Array.isArray(data.comps) ? data.comps.filter((c: any) => c && c.address && num(c.sale_price)).slice(0, 8).map((c: any) => ({
      address: String(c.address).slice(0, 200), sale_price: num(c.sale_price)!, sold_date: c.sold_date ?? null,
      gla: num(c.gla), beds: num(c.beds), baths: num(c.baths), year_built: num(c.year_built),
      lot_size: c.lot_size ?? null, lot_sqft: lotToSqft(c.lot_size), garage: num(c.garage), pool: bool(c.pool),
      condition: c.condition ?? null, condition_basis: c.condition_basis ?? null, adjustments: [] as { label: string; amount: number }[],
    })) : [];

    const median = (arr: number[]) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const round = (n: number) => Math.round(n / 1000) * 1000;
    const roundH = (n: number) => Math.round(n / 100) * 100;

    // ── APPRAISAL ADJUSTMENT ENGINE — Sales Comparison Approach ──
    // Each comp is adjusted TO the subject, line by line. Sign convention: if the
    // SUBJECT is superior on an attribute, the comp gets a POSITIVE adjustment (it
    // would have sold for more if it were like the subject), and vice-versa.
    const avgPpsf = median(comps.filter((c) => c.sale_price && c.gla).map((c) => c.sale_price / c.gla!)) || null;
    // Contributory value of extra space is LESS than average ppsf — appraisers use a
    // marginal rate (~35-45% of avg). Clamp to a sane $/sqft band.
    const marginalPpsf = avgPpsf ? Math.max(35, Math.min(140, avgPpsf * 0.40)) : 55;
    // Market/time appreciation, monthly. Prefer researched figure; else derive from
    // market speed (hot market appreciates faster); floored/capped conservatively.
    const annualAppr = num(data.market?.annual_appreciation_pct);
    const speed = Math.max(0, Math.min(100, num(data.market?.speed) ?? 50));
    const monthlyApprPct = (annualAppr != null ? annualAppr : (2 + speed / 100 * 6)) / 100 / 12; // 2%–8%/yr band
    const now = new Date();
    const monthsSince = (d: string | null) => { if (!d) return 0; const t = new Date(d); if (isNaN(t.getTime())) return 0; return Math.max(0, Math.min(24, (now.getTime() - t.getTime()) / (1000 * 3600 * 24 * 30.4))); };
    const condRank = (txt: string | null): number | null => {
      if (!txt) return null; const t = txt.toLowerCase();
      if (/(distress|as-is|as is|tear|gut|fixer|poor|dated and|needs)/.test(t)) return 2;
      if (/(dated|original|tired|older|fair)/.test(t)) return 4;
      if (/(clean|average|maintained|good|move-in|move in)/.test(t)) return 6;
      if (/(updated|renovated|remodel|upgraded|newer)/.test(t)) return 8;
      if (/(luxury|high-end|custom|premium|new construction|flawless|brand new)/.test(t)) return 10;
      return 6;
    };
    const subjCond = num((data.subject as any)?.condition_score) ?? condRank(subject.condition) ?? 6;

    for (const c of comps) {
      // Guard: ignore absurd GLA (bad parse) so size math can't explode.
      if (c.gla != null && (c.gla < 300 || c.gla > 15000)) c.gla = null;
      const adj: { label: string; amount: number }[] = [];
      const capAmt = c.sale_price * 0.20; // no single line item may exceed ±20% of comp price
      const push = (label: string, amount: number, floor = 1000) => {
        const a = Math.max(-capAmt, Math.min(capAmt, amount));
        if (Math.abs(a) >= floor) adj.push({ label, amount: Math.round(a / 100) * 100 });
      };
      // 1) Market / time conditions
      const mo = monthsSince(c.sold_date);
      if (mo > 0.5 && monthlyApprPct !== 0) push(`Market/time (+${mo.toFixed(1)} mo)`, c.sale_price * monthlyApprPct * mo, 500);
      // 2) GLA / size
      if (subject.gla && c.gla) push(`Size (${subject.gla - c.gla >= 0 ? "+" : ""}${subject.gla - c.gla} sf)`, (subject.gla - c.gla) * marginalPpsf);
      // 3) Age / year built
      if (subject.year_built && c.year_built) push(`Age (${subject.year_built - c.year_built >= 0 ? "newer" : "older"} ${Math.abs(subject.year_built - c.year_built)} yr)`, (subject.year_built - c.year_built) * 700);
      // 4) Bathrooms (bedrooms are largely captured by GLA)
      if (subject.baths && c.baths) push(`Baths (${subject.baths - c.baths >= 0 ? "+" : ""}${(subject.baths - c.baths).toFixed(1)})`, (subject.baths - c.baths) * 8000, 4000);
      // 5) Garage
      if (subject.garage != null && c.garage != null) push(`Garage (${subject.garage - c.garage >= 0 ? "+" : ""}${subject.garage - c.garage})`, (subject.garage - c.garage) * 6000, 3000);
      // 6) Pool
      if (subject.pool != null && c.pool != null && subject.pool !== c.pool) push(subject.pool ? "Pool (subject has)" : "Pool (comp has)", subject.pool ? 20000 : -20000, 1);
      // 7) Lot size
      if (subject.lot_sqft && c.lot_sqft && Math.abs(subject.lot_sqft - c.lot_sqft) > 2000) push(`Lot (${subject.lot_sqft - c.lot_sqft >= 0 ? "+" : ""}${Math.round((subject.lot_sqft - c.lot_sqft) / 1000)}k sf)`, (subject.lot_sqft - c.lot_sqft) * 3, 3000);
      // 8) Condition / quality
      const compCond = condRank(c.condition);
      if (compCond != null && subjCond != null && compCond !== subjCond) push(`Condition (${subjCond - compCond >= 0 ? "+" : ""}${subjCond - compCond})`, (subjCond - compCond) * (c.sale_price * 0.015), 2000);
      (c as any).adjustments = adj;
      (c as any).adjusted = c.sale_price + adj.reduce((s, x) => s + x.amount, 0);
      const gross = adj.reduce((s, x) => s + Math.abs(x.amount), 0);
      (c as any).gross_adj_pct = c.sale_price ? Math.round((gross / c.sale_price) * 100) : null;
      (c as any).net_adj_pct = c.sale_price ? Math.round(((c as any).adjusted - c.sale_price) / c.sale_price * 100) : null;
    }

    // ── RECONCILIATION — weight the least-adjusted comps most (appraisal practice) ──
    // Prefer comps with gross adjustment <= 25% (a standard reliability threshold); if
    // that leaves too few, fall back to all positively-adjusted comps.
    const positive = comps.filter((c) => (c as any).adjusted > 0);
    const tight = positive.filter((c) => ((c as any).gross_adj_pct ?? 99) <= 25);
    const adjustedComps = tight.length >= 3 ? tight : positive;
    let reconciled: number | null = null;
    if (adjustedComps.length) {
      let wsum = 0, w = 0;
      for (const c of adjustedComps) {
        const gp = (c as any).gross_adj_pct ?? 25;
        const weight = 1 / (1 + Math.pow(gp / 10, 2)); // heavy penalty as gross adjustment grows
        wsum += (c as any).adjusted * weight; w += weight;
      }
      reconciled = w ? wsum / w : null;
    }

    // ── Valuation. Prefer reconciliation → model estimate → ppsf×GLA → median. ──
    const mv = data.valuation || {};
    const ppsfList = comps.filter((c) => c.sale_price && c.gla).map((c) => c.sale_price / c.gla!);
    const compPpsf = median(ppsfList);
    let baseEstimate: number | null = reconciled;
    if (!baseEstimate) baseEstimate = num(mv.estimate);
    if (!baseEstimate && compPpsf && subject.gla) baseEstimate = compPpsf * subject.gla;
    if (!baseEstimate && subject.estimate) baseEstimate = subject.estimate;
    if (!baseEstimate) { const mc = median(comps.map((c) => c.sale_price).filter(Boolean)); if (mc) baseEstimate = mc; }

    let tiers = { opportunistic: num(mv.tiers?.opportunistic), target: num(mv.tiers?.target), fast: num(mv.tiers?.fast) };
    // If we have a reconciled value, it OVERRIDES the model's tiers (it's more rigorous).
    if (reconciled && reconciled > 0) {
      tiers = { opportunistic: round(reconciled * 1.06), target: round(reconciled), fast: round(reconciled * 0.95) };
    } else if (!(tiers.target && tiers.opportunistic && tiers.fast && tiers.target > 0) && baseEstimate && baseEstimate > 0) {
      tiers = { opportunistic: round(baseEstimate * 1.06), target: round(baseEstimate), fast: round(baseEstimate * 0.95) };
    }
    const nAdj = adjustedComps.length;
    const valuation = {
      estimate: baseEstimate ? round(baseEstimate) : null,
      ppsf: compPpsf ? Math.round(compPpsf) : (num(mv.ppsf) || null),
      marginal_ppsf: Math.round(marginalPpsf),
      reconciled: reconciled ? round(reconciled) : null,
      tiers,
      method: reconciled ? "adjusted-sales-comparison" : (compPpsf && subject.gla ? "ppsf-derived" : "median-comp"),
      basis: reconciled
        ? `Reconciled from ${nAdj} comps adjusted to the subject (size @ ~$${Math.round(marginalPpsf)}/sf marginal, plus time, age, baths, condition & features), weighted toward the least-adjusted sales.`
        : (mv.basis || (compPpsf && subject.gla ? `~$${Math.round(compPpsf)}/sqft (median of ${ppsfList.length} comps) × ${subject.gla} sqft` : comps.length ? `median of ${comps.length} comparable sales` : "insufficient comps")).toString().slice(0, 400),
    };

    const clean = {
      subject,
      market: {
        speed, moi: num(data.market?.moi), list_to_sale: num(data.market?.list_to_sale),
        active: num(data.market?.active), pending: num(data.market?.pending), closed: num(data.market?.closed),
        annual_appreciation_pct: annualAppr,
      },
      comps,
      valuation,
      sources: Array.isArray(data.sources) ? data.sources.filter(Boolean).map((s: any) => String(s)).slice(0, 12) : [],
      notes: (data.notes || "").toString().slice(0, 1500),
      confidence: ["high", "medium", "low"].includes(data.confidence) ? data.confidence : "low",
    };
    return J({ ok: true, data: clean });
  } catch (e) {
    return J({ error: String(e) }, 500);
  }
});
