// contact-research
// Step 2 of the research flow. Given a confirmed candidate identity, run the
// full behavioral research prompt and store the result on the profile.
//
// POST body:
//   {
//     contact_id: uuid,
//     candidate: {                  -- the confirmed candidate from contact-identify
//       name, headline, location, source_url, ...
//     },
//     scope: 'personal' | 'business' | 'both',
//     matched_by: 'email' | 'phone' | 'manual'
//   }
//
// Returns:
//   {
//     ok: true,
//     full_report: string,           -- markdown
//     research_d_score, ...,         -- the structured DISC inference
//     research_primary, ...
//     research_confidence,
//     research_summary               -- short version of the behavioral observations
//   }
//
// Also writes those fields to public.profiles for this contact.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function buildResearchPrompt(candidate, contact, scope) {
  const id = candidate || {};
  const scopeInstruction = scope === "personal"
    ? "Focus on PERSONAL sources only: Instagram, public Facebook posts, local news, community involvement, hobbies, family-mentioned-by-them, school alumni pages they're publicly involved in. Skip LinkedIn deep-dives unless personal interests are mentioned there. Do NOT include detailed professional information."
    : scope === "business"
    ? "Focus on PROFESSIONAL sources only: LinkedIn, company website, professional licenses appropriate to their stated occupation and jurisdiction (state regulatory bodies for real estate, FINRA BrokerCheck for finance, state bar lookups for attorneys, medical board lookups for healthcare, etc.), published writing, podcasts, press, board memberships. Skip personal social media unless they themselves use it for professional content."
    : "Cover BOTH professional and personal sources, but in section 1 keep professional findings separate from personal findings. Label each finding with its category.";

  const confirmedBlock = [
    `Confirmed identity:`,
    `- Name: ${id.name || contact.name}`,
    id.headline ? `- Title/employer: ${id.headline}` : null,
    id.location ? `- Location: ${id.location}` : null,
    id.source_url ? `- Primary verified source: ${id.source_url}` : null,
    contact.email ? `- Email anchor: ${contact.email}` : null,
    contact.phone ? `- Phone anchor: ${contact.phone}` : null,
  ].filter(Boolean).join("\n");

  return `I'm meeting with this person soon and want to prepare to meet them as a person, not a target.

${confirmedBlock}

Scope of this research: ${scope.toUpperCase()}
${scopeInstruction}

Please research them using public web sources. Do not infer anything you cannot point to specific evidence for. Do not include anything from data brokers, leaked databases, or sources that aren't legitimately public. Anchor everything to the confirmed identity above — if a finding cannot be tied to the same person (e.g., same employer, same city, same publicly listed email), exclude it.

**Structure your response in four sections, in this exact order:**

## 1. Verified profile
- Background and education (with sources)
- Current role, scope, and how they describe their work in their own words
- Career path — note transitions, length of stays, what they moved toward and away from
- Community involvement, boards, volunteer work
- Published writing, podcasts, speaking, media — quote exact phrases where useful
- Stated interests, causes, or values that appear in multiple places
- If something is uncertain or you can only find it on one source, label it "single-source" and don't build on it.

## 2. Personal context (for genuine connection, not leverage)
- Family, hometown, geographic or cultural ties they themselves mention publicly
- Hobbies, side projects, recurring non-work themes
- Things they appear to be excited about right now (last 6-12 months)
- Skip anything that feels invasive to surface in a first meeting — birthdays, family member names, home neighborhood, religious affiliation unless they're publicly involved in it.

## 3. Behavioral observations
This is where you should be specific and cautious. Pull from what they've written or said publicly, not what they look like or where they're from. For each observation, quote or paraphrase the evidence and name the source.

- **Communication style**: do they write in short punchy sentences or long thoughtful ones? Use data, stories, declarations, or questions? Address audiences directly or describe situations from a remove?
- **What they emphasize**: results and outcomes, relationships and people, process and rigor, vision and ideas — which of these surface most often in their public language?
- **Tempo cues**: do they describe their work in terms of speed and decisiveness, careful deliberation, building trust over time, or precision and accuracy?
- **Decision-making signals**: do they reference data and analysis, intuition and experience, consensus and team input, or instinct and conviction?
- **How they describe their team or clients**: as partners, as people they serve, as performers they manage, as a unit they belong to?

Then provide a **DISC inference** as a JSON code block, exactly like this:

\`\`\`json
{
  "d_score": 0-100,
  "i_score": 0-100,
  "s_score": 0-100,
  "c_score": 0-100,
  "primary": "D" | "I" | "S" | "C",
  "secondary": "D" | "I" | "S" | "C" | null,
  "confidence": "tentative" | "provisional" | "reasonably_confident",
  "confidence_explanation": "1-2 sentences explaining why this confidence level",
  "evidence_count": <integer count of distinct public sources you drew from>,
  "key_evidence": ["1-sentence evidence #1", "1-sentence evidence #2", "1-sentence evidence #3"]
}
\`\`\`

The four scores should sum approximately to 200 (DISC is two-axis: D/I high vs S/C, and I/S high vs D/C). Higher = more pronounced.

**Confidence calibration is critical:**
- "tentative" — fewer than 3 pieces of public evidence, OR pattern is genuinely ambiguous
- "provisional" — 3-5 pieces, pattern is suggestive but could go other ways
- "reasonably_confident" — 6+ pieces across diverse sources, consistent pattern
- **Never claim higher than "reasonably_confident" from web research alone.** Real DISC reads require multiple direct interactions.

If evidence is too thin to say anything responsibly, set all scores to null and explain in confidence_explanation.

## 4. How to meet them well
- 3-4 conversation starters tied to specific things they've expressed interest in (not generic small talk)
- Topics to lean into, and any that may not land based on what's observable
- Tailored to your behavioral read: if more analytical (C) or decisive (D), come with specifics, options, and a clear ask. If more relational (I) or steady (S), open with personal connection and leave room for them to talk first.
- Two or three specific ways I might be able to add value to them — based on what they say they care about
- One or two thoughtful follow-up ideas after the meeting

**Principles:**
- Cite sources for non-trivial claims (URL or platform + post date in parentheses inline)
- If you find conflicting information, note both and don't pick a winner
- Don't pad with generic networking advice — everything should be specific to this person
- Anything you're guessing at, mark as a guess
- The behavioral observations are calibration tools, not labels. I will form my own read in person.`;
}

function extractDiscJson(reportText) {
  // Looking for a ```json ... ``` block containing the DISC fields
  const match = reportText.match(/```json\s*([\s\S]*?)```/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    return parsed;
  } catch (_) { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = await req.json();
    const { contact_id, candidate, scope, matched_by } = body;

    if (!contact_id || !scope) {
      return new Response(JSON.stringify({ error: "contact_id and scope are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    // SECURITY: caller identity from JWT; contact must belong to caller
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Pull the contact for anchoring
    const { data: contact, error: cErr } = await supabase
      .from("contacts").select("*").eq("id", contact_id).single();
    if (cErr || !contact) {
      return new Response(JSON.stringify({ error: "Contact not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (contact.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = buildResearchPrompt(candidate, contact, scope);

    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 8192,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: 12,
        }],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!apiResp.ok) {
      const errText = await apiResp.text();
      return new Response(JSON.stringify({ error: `Anthropic API error: ${apiResp.status}`, detail: errText.slice(0, 500) }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiData = await apiResp.json();
    const fullReport = (apiData.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");

    // Extract the structured DISC inference
    const disc = extractDiscJson(fullReport);

    // Strip the JSON block from the report so the markdown is clean
    const cleanReport = fullReport.replace(/```json\s*[\s\S]*?```/g, "").trim();

    // Build a short summary: section 3's behavioral observations + the key_evidence list
    let shortSummary = "";
    if (disc && disc.key_evidence) {
      shortSummary = disc.key_evidence.map((e, i) => `${i + 1}. ${e}`).join("\n");
    }

    // Upsert the profile with the research data
    // First check if a profile exists
    const { data: existingProfile } = await supabase
      .from("profiles")
      .select("id")
      .eq("contact_id", contact_id)
      .maybeSingle();

    const profileUpdate = {
      contact_id,
      user_id: contact.user_id,
      research_d_score: disc?.d_score ?? null,
      research_i_score: disc?.i_score ?? null,
      research_s_score: disc?.s_score ?? null,
      research_c_score: disc?.c_score ?? null,
      research_primary: disc?.primary ?? null,
      research_secondary: disc?.secondary ?? null,
      research_confidence: disc?.confidence ?? null,
      research_taken_at: new Date().toISOString(),
      research_summary: shortSummary || null,
      research_full_report: cleanReport,
      research_scope: scope,
      research_matched_by: matched_by || "manual",
    };

    if (existingProfile) {
      await supabase.from("profiles").update(profileUpdate).eq("id", existingProfile.id);
    } else {
      await supabase.from("profiles").insert(profileUpdate);
    }

    return new Response(JSON.stringify({
      ok: true,
      full_report: cleanReport,
      ...disc,
      search_count: apiData.usage?.server_tool_use?.web_search_requests ?? null,
      input_tokens: apiData.usage?.input_tokens,
      output_tokens: apiData.usage?.output_tokens,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
