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
  // Social profiles are the STRONGEST anchors — a known LinkedIn/Instagram URL
  // pins identity far better than name+email, so the research reads the right
  // person and can start from their actual public presence.
  const socials = (contact && contact.socials && typeof contact.socials === "object") ? contact.socials : {};
  const socialLines = Object.entries(socials)
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `- ${k.charAt(0).toUpperCase() + k.slice(1)}: ${v}`);
  const anchors = [
    `- Name: ${id.name || contact.name || "(unknown)"}`,
    (id.headline || contact.company || contact.role) ? `- Title / employer: ${id.headline || [contact.role, contact.company].filter(Boolean).join(" at ")}` : null,
    (id.location || contact.city) ? `- Location: ${id.location || contact.city}` : null,
    contact.email ? `- Email: ${contact.email}` : null,
    contact.phone ? `- Phone: ${contact.phone}` : null,
    (contact.business_address || contact.home_address) ? `- Address: ${contact.business_address || contact.home_address}` : null,
    id.source_url ? `- Verified source: ${id.source_url}` : null,
    contact.profession ? `- Profession: ${contact.profession}` : null,
    ...socialLines,
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
- FAMILY: include family only where the SUBJECT has chosen to make it public themselves (e.g., they post about coaching their kid's team, run the business with their spouse, describe themselves as a "third-generation Tampan"). Never research, name, or profile their children or other relatives as separate subjects. Never include minors' details. Family context is for warmth AND for the client’s legitimate housing needs — you MAY note household composition at a high level where the subject has made it public (e.g. “a family with young children,” which helps an agent size a home to the right number of bedrooms). But it is NEVER a dossier: do not research, name, photograph, locate, schedule, or detail any specific minor.
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

// Coerce a value that SHOULD be an array into one — the model sometimes returns
// a comma/semicolon string. Prevents a string reaching UI code that expects an
// array (which then crashes on .filter/.map). Splits sentences conservatively.
function asArr(v) {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined && x !== "");
  if (typeof v === "string" && v.trim()) {
    return v.split(/\s*[;\n]\s*|\s*\u2022\s*/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}
function extractJson(text) {
  if (!text) return null;
  // 1) Fenced ```json (or bare ```) blocks, newest first.
  const fenced = [...text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)];
  for (let i = fenced.length - 1; i >= 0; i--) {
    try { const o = JSON.parse(fenced[i][1].trim()); if (o && typeof o === "object") return o; } catch (_) { /* keep looking */ }
  }
  // 2) Brace-matched scan — collect every balanced {...} object in the text.
  const cands = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "{") continue;
    let depth = 0, inStr = false, esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
      if (ch === '"') inStr = true;
      else if (ch === "{") depth++;
      else if (ch === "}") { if (--depth === 0) { cands.push(text.slice(i, j + 1)); i = j; break; } }
    }
  }
  // Prefer the object that carries the real payload (headline/disc/scores).
  for (let i = cands.length - 1; i >= 0; i--) {
    try { const o = JSON.parse(cands[i]); if (o && typeof o === "object" && (o.disc || o.headline || o.d_score !== undefined)) return o; } catch (_) { /* keep looking */ }
  }
  for (let i = cands.length - 1; i >= 0; i--) {
    try { const o = JSON.parse(cands[i]); if (o && typeof o === "object") return o; } catch (_) { /* keep looking */ }
  }
  return null;
}

// ── BYOK + metering helpers ──
async function aesKey() {
  const secret = Deno.env.get("AI_KEY_ENC_SECRET") || "";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
async function decryptKey(stored) {
  try {
    const [ivB, ctB] = stored.split(":");
    const iv = Uint8Array.from(atob(ivB), (c) => c.charCodeAt(0));
    const ct = Uint8Array.from(atob(ctB), (c) => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await aesKey(), ct);
    return new TextDecoder().decode(pt);
  } catch (_) { return null; }
}
async function resolveKey(supabase, userId, platformKey) {
  if (userId) {
    const { data } = await supabase.from("user_ai_keys").select("key_ciphertext, status").eq("user_id", userId).maybeSingle();
    if (data && data.status === "active" && data.key_ciphertext) {
      const k = await decryptKey(data.key_ciphertext);
      if (k) return { key: k, usedOwn: true };
    }
  }
  return { key: platformKey, usedOwn: false };
}
const AI_RATES = { "claude-opus-4-8": [5, 25], "claude-opus-4-7": [5, 25], "claude-sonnet-4-6": [3, 15], "claude-sonnet-5": [3, 15], "claude-haiku-4-5": [1, 5] };
async function logUsage(supabase, { userId, fn, model, usage, usedOwn }) {
  try {
    const inTok = usage?.input_tokens || 0, outTok = usage?.output_tokens || 0;
    const searches = usage?.server_tool_use?.web_search_requests || 0;
    const [ri, ro] = AI_RATES[model] || [3, 15];
    const cost = (inTok / 1e6) * ri + (outTok / 1e6) * ro + searches * 0.01;
    await supabase.from("ai_usage_log").insert({ user_id: userId, fn, model, input_tokens: inTok, output_tokens: outTok, web_searches: searches, cost_usd: cost, used_own_key: !!usedOwn });
  } catch (_) {}
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

    // ── Model selection: Opus only for a privileged owner/admin who opted in
    //    (user_settings.ai_research_model='opus'). Agents & the background drip
    //    always get the efficient Sonnet. ──
    const fast = !!body.fast;
    let model = "claude-sonnet-4-6";
    if (user && !fast) {
      const { data: st } = await supabase.from("user_settings").select("ai_research_model").eq("user_id", user.id).maybeSingle();
      if (st?.ai_research_model === "opus") {
        const { data: ag } = await supabase.from("agents").select("role").eq("auth_user_id", user.id).maybeSingle();
        const { data: tms } = await supabase.from("team_members").select("role").eq("auth_user_id", user.id);
        const priv = (ag && ["owner", "broker_admin", "team_leader"].includes(ag.role)) || (tms || []).some((m) => ["owner", "admin"].includes(m.role));
        if (priv) model = "claude-opus-4-8";
      }
    }
    const isOpus = model.startsWith("claude-opus");
    // Resolve which Anthropic key to bill: the caller's own (BYOK) or the platform key.
    const billUserId = user?.id || contact.user_id;
    const { key: useKey, usedOwn } = await resolveKey(supabase, billUserId, apiKey);
    const maxTokens = isOpus ? 8000 : (fast ? 5000 : 6000);
    const maxUses = isOpus ? 10 : (fast ? 5 : 6);

    const { data: prof } = await supabase.from("profiles").select("*").eq("contact_id", contact_id).maybeSingle();
    const disc = prof ? { primary: prof.baseline_primary || prof.primary_letter || prof.research_primary, secondary: prof.baseline_secondary || prof.secondary_letter || prof.research_secondary, confidence: prof.confidence || prof.research_confidence } : null;
    const prompt = buildResearchPrompt(candidate, contact, scope, me, disc);

    const writeProfile = async (fields) => {
      const { data: existing } = await supabase.from("profiles").select("id").eq("contact_id", contact_id).maybeSingle();
      if (existing) await supabase.from("profiles").update(fields).eq("id", existing.id);
      else await supabase.from("profiles").insert({ contact_id, user_id: contact.user_id, subject_kind: "contact", ...fields });
    };

    // ── EXTRACT-ONLY MODE ────────────────────────────────────────────────────
    // Recover structured DISC scores + fields from a report that already exists
    // but never got parsed (the model returned prose without the JSON block).
    // No web research — one cheap call over the saved report. Used to backfill
    // profiles left with a readable report but null scores (flat-50s DISC bug).
    if (body.extract_only) {
      const { data: prof0 } = await supabase.from("profiles").select("research_full_report, research_d_score, research_needs_confirmation").eq("contact_id", contact_id).maybeSingle();
      const report = prof0?.research_full_report || "";
      if (!report || report.trim().length < 300) return J({ ok: false, reason: "no report to extract from" });
      if (prof0.research_d_score !== null && prof0.research_d_score !== undefined && !body.force) return J({ ok: true, already: true });
      try {
        const exResp = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": useKey, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({
            model: "claude-sonnet-4-6", max_tokens: 1500,
            messages: [{ role: "user", content: `From the relationship-intelligence report below, output ONLY a JSON object (no prose, no fences) with keys: headline (string), background_education (string|null), career (string|null), expertise (string[]), community_media (string[]), interests_values (string[]), causes (string[]), personal (string|null), connection_plan (string|null), overlaps_with_me (string[]), disc {d_score,i_score,s_score,c_score (0-100, D+I+S+C sum ~200), primary, secondary, confidence ("tentative"|"reasonably_confident"), key_evidence (string[])}. If behavior truly can't be read, set disc scores null. REPORT:\n\n${report.slice(0, 18000)}` }],
          }),
        });
        if (!exResp.ok) return J({ ok: false, reason: "extract call failed " + exResp.status });
        const exData = await exResp.json();
        await logUsage(supabase, { userId: billUserId, fn: "contact-research-extract", model: "claude-sonnet-4-6", usage: exData.usage, usedOwn });
        const exText = (exData.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
        const d = extractJson(exText) || {};
        const disc2 = d.disc || {};
        const exSummary = Array.isArray(disc2.key_evidence) ? disc2.key_evidence.map((e, i) => `${i + 1}. ${e}`).join("\n") : null;
        await writeProfile({
          research_headline: d.headline ?? null,
          research_summary: exSummary,
          research_profile: { background_education: d.background_education ?? null, career: d.career ?? null, expertise: asArr(d.expertise), community_media: asArr(d.community_media), interests_values: asArr(d.interests_values), causes: asArr(d.causes) },
          research_personal: d.personal ?? null,
          research_connection_plan: d.connection_plan ?? null,
          research_overlaps: asArr(d.overlaps_with_me),
          research_d_score: disc2.d_score ?? null, research_i_score: disc2.i_score ?? null,
          research_s_score: disc2.s_score ?? null, research_c_score: disc2.c_score ?? null,
          research_primary: disc2.primary ?? null, research_secondary: disc2.secondary ?? null,
          research_confidence: disc2.confidence ?? null,
        });
        // Fold into the live DISC only if this match doesn't still need confirming.
        if (!prof0.research_needs_confirmation) {
          try {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/disc-analyze`, {
            method: "POST",
            headers: { "content-type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") },
            body: JSON.stringify({ contact_id, user_id: contact.user_id, force: true }),
          });
        } catch (_) {}
        }
        return J({ ok: true, disc: disc2, folded: !prof0.research_needs_confirmation });
      } catch (e) {
        return J({ ok: false, reason: String(e?.message || e) });
      }
    }

    const runResearch = async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 280000);
        let apiResp;
        try {
          apiResp = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": useKey, "anthropic-version": "2023-06-01" },
            signal: controller.signal,
            body: JSON.stringify({ model, max_tokens: maxTokens, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses }], messages: [{ role: "user", content: prompt }] }),
          });
        } finally { clearTimeout(timer); }
        if (!apiResp.ok) {
          const t = await apiResp.text();
          console.error("anthropic", apiResp.status, t.slice(0, 300));
          await writeProfile({ research_status: "error", research_error: `Research service error ${apiResp.status}. Please try again.` });
          return;
        }
        const apiData = await apiResp.json();
        await logUsage(supabase, { userId: billUserId, fn: "contact-research", model, usage: apiData.usage, usedOwn });
        const fullReport = (apiData.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
        let data = extractJson(fullReport) || {};
        // FALLBACK: the model sometimes returns the narrative report but forgets
        // the structured JSON block (or emits it unparseably), leaving DISC scores
        // null and the Insights fields empty — a report you can read but the app
        // can't use. If the structured payload is missing, make ONE focused call
        // that extracts just the JSON from the report we already have. No new
        // research, cheap, and it recovers the case reliably.
        if (!data.disc && data.d_score === undefined && fullReport.trim().length > 300) {
          try {
            const exResp = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: { "content-type": "application/json", "x-api-key": useKey, "anthropic-version": "2023-06-01" },
              body: JSON.stringify({
                model: "claude-sonnet-4-6", max_tokens: 1500,
                messages: [{ role: "user", content: `From the relationship-intelligence report below, output ONLY a JSON object (no prose, no fences) with keys: headline (string), identity_confidence ("high"|"medium"|"low"), background_education (string|null), career (string|null), expertise (string[]), community_media (string[]), interests_values (string[]), causes (string[]), personal (string|null), connection_plan (string|null), overlaps_with_me (string[]), disc {d_score,i_score,s_score,c_score (0-100, D+I+S+C sum ~200), primary, secondary, confidence ("tentative"|"reasonably_confident"), key_evidence (string[])}. If behavior truly can't be read, set disc scores null. REPORT:\n\n${fullReport.slice(0, 18000)}` }],
              }),
            });
            if (exResp.ok) {
              const exData = await exResp.json();
              await logUsage(supabase, { userId: billUserId, fn: "contact-research-extract", model: "claude-sonnet-4-6", usage: exData.usage, usedOwn });
              const exText = (exData.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
              const parsed = extractJson(exText);
              if (parsed && typeof parsed === "object") data = { ...parsed, ...data, disc: parsed.disc || data.disc };
            }
          } catch (_) { /* non-fatal — fall through with what we have */ }
        }
        const disc2 = data.disc || {};
        const cleanReport = fullReport.replace(/```json\s*[\s\S]*?```/g, "").trim();
        const shortSummary = Array.isArray(disc2.key_evidence) ? disc2.key_evidence.map((e, i) => `${i + 1}. ${e}`).join("\n") : null;
        // ── IDENTITY GUARD ──────────────────────────────────────────────────
        // A "locked" identity from contact-identify only means an email/phone was
        // PRESENT — not that the found public profile truly belongs to this
        // person. If the research itself is only medium/low confident it found the
        // right individual, we must NOT present the write-up as settled. Flag it
        // for human confirmation and keep the DISC scores OUT of the trusted
        // fields until confirmed, so a wrong-person match can never silently
        // pollute the profile the way it did before.
        const idConf = (data.identity_confidence || "").toLowerCase();
        const needsConfirmation = idConf === "medium" || idConf === "low" || idConf === "";
        await writeProfile({
          user_id: contact.user_id, subject_kind: "contact",
          research_headline: data.headline ?? null,
          research_identity_confidence: data.identity_confidence ?? null,
          research_needs_confirmation: needsConfirmation,
          research_profile: { background_education: data.background_education ?? null, career: data.career ?? null, expertise: asArr(data.expertise), community_media: asArr(data.community_media), interests_values: asArr(data.interests_values), causes: asArr(data.causes) },
          research_personal: data.personal ?? null,
          research_connection_plan: data.connection_plan ?? null,
          research_overlaps: asArr(data.overlaps_with_me),
          research_sources: data.sources ?? [],
          research_d_score: disc2.d_score ?? null, research_i_score: disc2.i_score ?? null,
          research_s_score: disc2.s_score ?? null, research_c_score: disc2.c_score ?? null,
          research_primary: disc2.primary ?? null, research_secondary: disc2.secondary ?? null,
          research_confidence: disc2.confidence ?? null,
          research_taken_at: new Date().toISOString(),
          research_summary: shortSummary, research_full_report: cleanReport,
          research_scope: scope, research_matched_by: matched_by || "manual",
          research_status: "done", research_error: null,
        });
        // Only fold research into the behavioral DISC graph when we're confident
        // it's the right person. A medium/low match must not seed the analysis.
        if (!needsConfirmation) {
          try {
            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/disc-analyze`, {
              method: "POST",
              headers: { "content-type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "apikey": Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") },
              body: JSON.stringify({ contact_id, user_id: contact.user_id, force: true }),
            });
          } catch (_) { /* non-fatal */ }
        }
      } catch (e) {
        const msg = (e && e.name === "AbortError")
          ? "The research took longer than expected. Try again, or set the scope to Business-only or Personal-only."
          : ("Research failed: " + String(e).slice(0, 160));
        try { await writeProfile({ research_status: "error", research_error: msg }); } catch (_) {}
      }
    };

    await writeProfile({ research_status: "running", research_started_at: new Date().toISOString(), research_error: null });

    // Background drip keeps synchronous behavior; interactive users get an
    // immediate 202 and poll the profile while it finishes in the background.
    if (isInternal) {
      await runResearch();
      const { data: f } = await supabase.from("profiles").select("research_status, research_error").eq("contact_id", contact_id).maybeSingle();
      return J({ ok: f?.research_status === "done", status: f?.research_status, error: f?.research_error || null });
    }
    // @ts-ignore EdgeRuntime is provided by the Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) EdgeRuntime.waitUntil(runResearch());
    else runResearch();
    return J({ status: "running", model }, 202);
  } catch (err) {
    return J({ error: String(err) }, 500);
  }
});
