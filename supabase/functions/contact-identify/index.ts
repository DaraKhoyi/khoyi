// contact-identify
// Step 1 of the research flow. Asks Claude to find public profiles matching
// the given identifiers. Does NOT do deep research yet — just disambiguation.
//
// POST body:
//   { contact_id: uuid }            -- pulls identifiers from the contact row
// OR
//   { name, email?, phone?, company?, role?, city?, state? }  -- manual override
//
// Returns:
//   { candidates: [{ name, headline, location, source_url, distinguishing_note }, ...] }
//
// The model is instructed to return at most 5 candidates, and to reject
// candidates that don't match the provided strong identifiers (email/phone).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function classifyConfidence(identifiers) {
  // 'locked'        = email OR phone present AND name
  // 'strong'        = name + company (employer)
  // 'weak'          = name + city only, OR name + role only
  // 'insufficient'  = name only, OR name has fewer than 2 tokens
  const hasName = (identifiers.name || "").trim().split(/\s+/).filter(s => s.length >= 2).length >= 2;
  const hasEmail = !!(identifiers.email || "").trim();
  const hasPhone = !!(identifiers.phone || "").trim();
  const hasCompany = !!(identifiers.company || "").trim();
  const hasCity = !!(identifiers.city || "").trim();
  const hasRole = !!(identifiers.role || "").trim();
  if (!hasName) return "insufficient";
  if (hasEmail || hasPhone) return "locked";
  if (hasCompany) return "strong";
  if (hasCity || hasRole) return "weak";
  return "insufficient";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = await req.json();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
    );

    // Build identifiers either from contact row or from manual override
    let identifiers = {};
    if (body.contact_id) {
      const { data: contact, error } = await supabase
        .from("contacts").select("*").eq("id", body.contact_id).single();
      if (error || !contact) {
        return new Response(JSON.stringify({ error: "Contact not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      identifiers = {
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        role: contact.role,
      };
    } else {
      identifiers = {
        name: body.name,
        email: body.email,
        phone: body.phone,
        company: body.company,
        role: body.role,
        city: body.city,
        state: body.state,
      };
    }

    const confidence = classifyConfidence(identifiers);

    if (confidence === "insufficient") {
      return new Response(JSON.stringify({
        confidence,
        candidates: [],
        message: "Need at least a full name plus one of: email, phone, employer.",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // If 'locked' (we have email or phone) — single-shot identification.
    // Still verifies but with high prior confidence.
    // If 'strong' or 'weak' — multi-candidate search.

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build identifier line for the prompt
    const idLines = [];
    if (identifiers.name) idLines.push(`Name: ${identifiers.name}`);
    if (identifiers.email) idLines.push(`Email: ${identifiers.email}`);
    if (identifiers.phone) idLines.push(`Phone: ${identifiers.phone}`);
    if (identifiers.company) idLines.push(`Employer / company: ${identifiers.company}`);
    if (identifiers.role) idLines.push(`Role / title: ${identifiers.role}`);
    if (identifiers.city) idLines.push(`City: ${identifiers.city}`);
    if (identifiers.state) idLines.push(`State: ${identifiers.state}`);

    const isLocked = confidence === "locked";

    const prompt = `I need to verify the identity of a person before doing deeper research, to avoid mixing them up with someone who shares their name.

Identifiers I have:
${idLines.join("\n")}

Please use web search to find ${isLocked ? "the single public profile that matches these identifiers" : "up to 5 distinct candidates whose name matches"}. Use ${isLocked ? "the email and/or phone number as the strong anchor — only return a profile if I can be confident it matches these strong identifiers" : "all available web sources (LinkedIn, company sites, news, professional licenses)"}.

For each candidate, return a JSON object with these fields:
- name: their canonical name as it appears on the source
- headline: their current title and employer in one phrase
- location: city/state if known
- source_url: the primary URL where you found them
- distinguishing_note: one sentence explaining what makes them distinct from other people with the same name
- match_strength: "high" if all strong identifiers match, "medium" if some match, "low" if only name matches

Return ONLY a JSON array of candidate objects, nothing else. No prose, no markdown fences. If you cannot confidently find a match, return an empty array [].

Important:
- Do NOT return candidates whose email or phone, when known, conflicts with what I provided.
- Do NOT speculate. Only include people you can actually find evidence of online.
- ${isLocked ? "Return at most 1 candidate." : "Return at most 5 candidates, ordered by match strength."}`;

    const apiResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-7",
        max_tokens: 4096,
        tools: [{
          type: "web_search_20250305",
          name: "web_search",
          max_uses: isLocked ? 4 : 8,
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
    // Concatenate all text blocks (the model may have interleaved web_search blocks)
    const textBlocks = (apiData.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");

    // Extract JSON array from the response (model may wrap in fences despite instructions)
    let candidates = [];
    try {
      // Try direct parse first
      candidates = JSON.parse(textBlocks.trim());
    } catch (_) {
      // Try to find a JSON array in the text
      const match = textBlocks.match(/\[[\s\S]*\]/);
      if (match) {
        try { candidates = JSON.parse(match[0]); } catch (_) { candidates = []; }
      }
    }
    if (!Array.isArray(candidates)) candidates = [];

    return new Response(JSON.stringify({
      confidence,
      candidates,
      identifiers_used: identifiers,
      search_count: (apiData.usage?.server_tool_use?.web_search_requests) ?? null,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
