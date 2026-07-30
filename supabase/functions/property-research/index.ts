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
2. Find 3-6 RECENT comparable SOLD homes (last ~6 months) near the subject — similar size, beds/baths, and area. For each: full address, sold price, sold date, and GLA sqft.
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

Output a SINGLE json object (and nothing after it) in EXACTLY this shape:
{
  "subject": { "gla": number|null, "beds": number|null, "baths": number|null, "lot_size": string|null, "year_built": number|null, "last_sold_price": number|null, "estimate": number|null },
  "market": { "speed": number, "moi": number|null, "list_to_sale": number|null, "active": number|null, "pending": number|null, "closed": number|null },
  "comps": [ { "address": string, "sale_price": number, "sold_date": string, "gla": number|null } ],
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
        body: JSON.stringify({ model: MODEL, max_tokens: 3500, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }], messages: [{ role: "user", content: PROMPT(address, hint) }] }),
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
    const subject = {
      gla: num(data.subject?.gla), beds: num(data.subject?.beds), baths: num(data.subject?.baths),
      lot_size: data.subject?.lot_size ?? null, year_built: num(data.subject?.year_built),
      last_sold_price: num(data.subject?.last_sold_price), estimate: num(data.subject?.estimate),
    };
    const comps = Array.isArray(data.comps) ? data.comps.filter((c: any) => c && c.address && num(c.sale_price)).slice(0, 8).map((c: any) => ({
      address: String(c.address).slice(0, 200), sale_price: num(c.sale_price), sold_date: c.sold_date ?? null, gla: num(c.gla),
    })) : [];

    // ── Valuation. Prefer the model's, but ALWAYS have a deterministic backbone
    // derived from the comps so we never present $0 when we have data to price on. ──
    const mv = data.valuation || {};
    const median = (arr: number[]) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
    const round = (n: number) => Math.round(n / 1000) * 1000;  // round to nearest $1k
    // comp $/sqft where both figures exist
    const ppsfList = comps.filter((c) => c.sale_price && c.gla).map((c) => c.sale_price! / c.gla!);
    const compPpsf = median(ppsfList);
    // base estimate: model's estimate → ppsf×GLA → median comp sale price
    let baseEstimate = num(mv.estimate);
    if (!baseEstimate && compPpsf && subject.gla) baseEstimate = compPpsf * subject.gla;
    if (!baseEstimate && subject.estimate) baseEstimate = subject.estimate;
    if (!baseEstimate) { const mc = median(comps.map((c) => c.sale_price!).filter(Boolean)); if (mc) baseEstimate = mc; }

    let tiers = { opportunistic: num(mv.tiers?.opportunistic), target: num(mv.tiers?.target), fast: num(mv.tiers?.fast) };
    // If the model didn't give a full, positive tier set, derive from the base estimate.
    const tiersOk = tiers.target && tiers.opportunistic && tiers.fast && tiers.target > 0;
    if (!tiersOk && baseEstimate && baseEstimate > 0) {
      tiers = { opportunistic: round(baseEstimate * 1.06), target: round(baseEstimate), fast: round(baseEstimate * 0.95) };
    }
    const valuation = {
      estimate: baseEstimate ? round(baseEstimate) : null,
      ppsf: compPpsf ? Math.round(compPpsf) : (num(mv.ppsf) || null),
      tiers,
      basis: (mv.basis || (compPpsf && subject.gla ? `~$${Math.round(compPpsf)}/sqft (median of ${ppsfList.length} comps) × ${subject.gla} sqft` : comps.length ? `median of ${comps.length} comparable sales` : "insufficient comps")).toString().slice(0, 300),
    };

    const clean = {
      subject,
      market: {
        speed: Math.max(0, Math.min(100, num(data.market?.speed) ?? 50)),
        moi: num(data.market?.moi), list_to_sale: num(data.market?.list_to_sale),
        active: num(data.market?.active), pending: num(data.market?.pending), closed: num(data.market?.closed),
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
