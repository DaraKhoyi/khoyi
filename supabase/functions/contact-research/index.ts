// contact-research
// Relationship Intelligence engine. Given a contact (and optionally a confirmed
// candidate identity), researches them across PUBLIC sources via Claude + web
// search, then writes a rich structured profile + DISC inference + a DISC-aware
// connection plan to public.profiles.
//
// POST body:
//   { contact_id: uuid, candidate?: {...}, scope?: 'personal'|'business'|'both',
//     matched_by?: 'email'|'phone'|'manual', me?: {name,role,market,interests[]} }
//
// Guardrails (also stated to the model): public sources only; relationship-
// building only (NOT for tenant / employment / credit screening — FCRA); never
// profile minors; family only where the subject has made it public themselves;
// flag identity-match uncertainty; cite sources; no speculation.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function buildResearchPrompt(candidate, contact, scope, me, disc) {
  const id = candidate || {};
  const anchors = [
    `- Name: ${id.name || contact.name || "(unknown)"}`,
    (id.headline || contact.company || contact.role) ? `- Title / employer: ${id.headline || [contact.role, contact.company].filter(Boolean).join(" at ")}` : null,
    (id.location || contact.city) ? `- Location: ${id.location || contact.city}` : null,
    contact.email ? `- Email: ${contact.email}` : null,
    contact.phone ? `- Phone: ${contact.phone}` : null,
    (contact.business_address || contact.home_address) ? `- Address: ${contact.business_address || contact.home_address}` : null,
    id.source_url ? `- Verified source: ${id.source_url}` : null,
    contact.profession ? `- Profession: ${contact.profession}` : null,
  ].filter(Boolean).join("\n");

  const scopeLine = scope === "personal"
    ? "Weight PERSONAL, publicly-shared sources (their own public social posts, community involvement, local press, alumni pages). Keep professional detail light."
    : scope === "business"
    ? "Weight PROFESSIONAL sources (LinkedIn, company site, public licenses/registries appropriate to their field, published writing, podcasts, press, boards). Keep personal detail light."
    : "Cover BOTH professional and personal public sources, kept clearly separated.";

  const meBlock = me
    ? `\nABOUT ME (the person who will build the relationship), so you can surface genuine overlaps:\n- ${me.name || "Dara Khoyi"} — ${me.role || "real estate broker & investor"}, ${me.market || "Tampa Bay / Land O' Lakes, FL"}.${me.interests && me.interests.length ? "\n- Interests: " + me.interests.join(", ") : ""}\nWhen you find a real, evidence-based overlap between us (same school, city, industry, cause, mutual connection, shared interest), capture it under "overlaps_with_me." Do not invent overlaps.`
    : "";

  const discBlock = (disc && disc.primary)
    ? `\nEXISTING BEHAVIORAL READ ON FILE: DISC primary ${disc.primary}${disc.secondary ? "/" + disc.secondary : ""} (${disc.confidence || "tentative"}). Tune the connection plan to this read while still forming your own from the evidence.`
    : "";

  return `I want to build a genuine, lasting relationship with the person below — professionally and personally. Help me understand them as a person so I can connect authentically, not network generically.

SUBJECT ANCHORS (use these to confirm you have the RIGHT person):
${anchors}
${meBlock}${discBlock}

RESEARCH SCOPE: ${scope.toUpperCase()}. ${scopeLine}

=== HARD RULES ===
- Use ONLY legitimately public web sources (LinkedIn, public Facebook/Instagram/X, company sites, public registries/licenses appropriate to their field, news, podcasts, talks, published writing). NO data brokers, leaked data, or paywalled personal records.
- This is for RELATIONSHIP-BUILDING ONLY. It is NOT a background check and must NOT be used for any tenant, employment, lending, insurance, or other eligibility decision (those are FCRA-regulated and this is not FCRA-compliant).
- Anchor every finding to the SAME person as the anchors above. If you cannot confidently confirm identity, say so and set identity_confidence to "low" — never blend two different people.
- FAMILY: include family only where the SUBJECT has chosen to make it public themselves (e.g., they post about coaching their kid's team, run the business with their spouse, describe themselves as a "third-generation Tampan"). Never research, name, or profile their children or other relatives as separate subjects. Never include minors' details. Family context is for warmth (knowing they value family), not a dossier.
- No speculation. Every non-trivial claim gets a source. If you only find something once, label it single-source. If evidence is thin, say so rather than padding.

=== OUTPUT — PART A: a readable narrative (markdown), in this order ===
## 1. Who they are
Background & education; current role and how they describe their work in their own words; career path (what they moved toward/away from); expertise; community/boards/volunteer; publications, podcasts, speaking, press (quote a telling phrase where useful); stated interests, values, causes that recur.

## 2. Personal context (for genuine connection)
Publicly-shared hobbies, passions, side projects; geographic/cultural/hometown ties they mention; family context they've made public (per the rule above); recurring non-work themes; what they seem excited about in the last 6-12 months.

## 3. Behavioral read
Communication style, what they emphasize, tempo and decision-making cues, how they describe their team/clients - each tied to quoted/paraphrased public evidence + source.

## 4. How to build a meaningful connection
Specific conversation starters tied to real things they care about; topics to lean into and any to approach carefully; concrete ways I can add value to them (professionally or personally); thoughtful follow-up ideas after we meet. Tune to the behavioral read (decisive/analytical -> specifics + clear ask; relational/steady -> personal warmth, let them talk first).

=== OUTPUT — PART B: a single json code block at the very end with this exact schema ===
\`\`\`json
{
  "headline": "one vivid sentence: who this person is and what drives them",
  "identity_confidence": "high" | "medium" | "low",
  "background_education": "string or null",
  "career": "string or null",
  "expertise": ["..."],
  "community_media": ["specific item + source"],
  "interests_values": ["..."],
  "causes": ["..."],
  "personal": {
    "hobbies": ["..."],
    "family_context": "self-disclosed/public only; null if none; never minors",
    "geo_cultural_ties": ["..."],
    "recurring_themes": ["..."],
    "recent_excitement": ["..."],
    "comms_preference": "how they appear to prefer to communicate / build relationships, or null"
  },
  "disc": {
    "d_score": 0, "i_score": 0, "s_score": 0, "c_score": 0,
    "primary": "D|I|S|C", "secondary": "D|I|S|C|null",
    "confidence": "tentative|provisional|reasonably_confident",
    "confidence_explanation": "1-2 sentences",
    "evidence_count": 0,
    "key_evidence": ["...", "...", "..."]
  },
  "connection_plan": {
    "conversation_starters": ["specific, tied to their world"],
    "topics_lean_in": ["..."],
    "topics_avoid": ["only if observable reason; else empty"],
    "add_value": ["concrete ways I can help them"],
    "follow_ups": ["thoughtful post-meeting ideas"]
  },
  "overlaps_with_me": [{ "type": "school|geography|industry|interest|cause|mutual_connection", "detail": "...", "source": "..." }],
  "sources": [{ "label": "LinkedIn / Company site / Podcast", "url": "...", "date": "if known" }]
}
\`\`\`
DISC scores sum to ~200 (two axes). Never claim above "reasonably_confident" from web research alone. If evidence is too thin to read behavior, set DISC scores to null and explain. Keep arrays tight and specific - quality over quantity.`;
}

function extractJson(text) {
  const matches = [...text.matchAll(/```json\s*([\s\S]*?)```/g)];
  for (let i = matches.length - 1; i >= 0; i--) {
    try { return JSON.parse(matches[i][1].trim()); } catch (_) { /* try previous */ }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const body = await req.json();
    const { contact_id, candidate, scope = "both", matched_by, me } = body;
    if (!contact_id) return J({ error: "contact_id is required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const isInternal = !!(Deno.env.get("RESEARCH_TOKEN") && (req.headers.get("x-internal-token") || "") === Deno.env.get("RESEARCH_TOKEN"));
    let user = null;
    if (!isInternal) {
      if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return J({ error: "Unauthorized" }, 401);
      const r = await supabase.auth.getUser(token);
      user = r.data?.user || null;
      if (!user) return J({ error: "Unauthorized" }, 401);
    }

    const { data: contact, error: cErr } = await supabase.from("contacts").select("*").eq("id", contact_id).single();
    if (cErr || !contact) return J({ error: "Contact not found" }, 404);
    if (!isInternal && contact.user_id !== user.id) return J({ error: "Forbidden" }, 403);

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return J({ error: "ANTHROPIC_API_KEY not configured" }, 500);

    const { data: prof } = await supabase.from("profiles").select("*").eq("contact_id", contact_id).maybeSingle();
    const disc = prof ? { primary: prof.baseline_primary || prof.primary_letter || prof.research_primary, secondary: prof.baseline_secondary || prof.secondary_letter || prof.research_secondary, confidence: prof.confidence || prof.research_confidence } : null;

    const prompt = buildResearchPrompt(candidate, contact, scope, me, disc);

    // Background drip uses a faster, leaner config so it reliably finishes inside
    // the function time limit; the interactive button keeps full Opus depth.
    const fast = !!body.fast;
    // Deep web research is bounded so it reliably finishes inside the edge
    // function wall-clock limit. Sonnet + a capped search budget + capped output
    // keeps the interactive call well under the ceiling; a hard abort guard
    // returns a helpful, user-facing message instead of a generic gateway error.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 150000);
    let apiResp;
    try {
      apiResp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        signal: controller.signal,
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: fast ? 5000 : 6000,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: fast ? 5 : 6 }],
          messages: [{ role: "user", content: prompt }],
        }),
      });
    } catch (e) {
      clearTimeout(timer);
      if (e && e.name === "AbortError") {
        return J({ error: "The web research took longer than expected and was stopped. Please try again — or set the scope to Business-only or Personal-only, which is faster than Both." }, 504);
      }
      return J({ error: "Research request failed: " + String(e).slice(0, 200) }, 502);
    }
    clearTimeout(timer);
    if (!apiResp.ok) {
      const t = await apiResp.text();
      return J({ error: `Anthropic API error: ${apiResp.status}`, detail: t.slice(0, 500) }, 500);
    }
    const apiData = await apiResp.json();
    const fullReport = (apiData.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const data = extractJson(fullReport) || {};
    const disc2 = data.disc || {};
    const cleanReport = fullReport.replace(/```json\s*[\s\S]*?```/g, "").trim();
    const shortSummary = Array.isArray(disc2.key_evidence) ? disc2.key_evidence.map((e, i) => `${i + 1}. ${e}`).join("\n") : null;

    const profileUpdate = {
      contact_id, user_id: contact.user_id, subject_kind: "contact",
      research_headline: data.headline ?? null,
      research_identity_confidence: data.identity_confidence ?? null,
      research_profile: { background_education: data.background_education ?? null, career: data.career ?? null, expertise: data.expertise ?? [], community_media: data.community_media ?? [], interests_values: data.interests_values ?? [], causes: data.causes ?? [] },
      research_personal: data.personal ?? null,
      research_connection_plan: data.connection_plan ?? null,
      research_overlaps: data.overlaps_with_me ?? [],
      research_sources: data.sources ?? [],
      research_d_score: disc2.d_score ?? null,
      research_i_score: disc2.i_score ?? null,
      research_s_score: disc2.s_score ?? null,
      research_c_score: disc2.c_score ?? null,
      research_primary: disc2.primary ?? null,
      research_secondary: disc2.secondary ?? null,
      research_confidence: disc2.confidence ?? null,
      research_taken_at: new Date().toISOString(),
      research_summary: shortSummary,
      research_full_report: cleanReport,
      research_scope: scope,
      research_matched_by: matched_by || "manual",
    };

    const { data: existing } = await supabase.from("profiles").select("id").eq("contact_id", contact_id).maybeSingle();
    if (existing) await supabase.from("profiles").update(profileUpdate).eq("id", existing.id);
    else await supabase.from("profiles").insert(profileUpdate);

    return J({ ok: true, ...data, full_report: cleanReport, search_count: apiData.usage?.server_tool_use?.web_search_requests ?? null });
  } catch (err) {
    return J({ error: String(err) }, 500);
  }
});
