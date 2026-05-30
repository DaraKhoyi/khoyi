// supabase/functions/task-quadrant-suggest/index.ts
// Suggests an Eisenhower quadrant + reasoning for a given task using Claude.
// POST { title: string, notes?: string, due_date?: string }
// Returns { quadrant: 'A'|'B'|'C'|'D', confidence: 0-1, reasoning: string }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `You classify tasks into the Eisenhower priority matrix for a real-estate brokerage owner.
- A = Urgent AND Important: time-critical AND impacts the business/relationship outcome. (Client crisis, contract deadline, signing today, escrow date, court date, IRS deadline.)
- B = Important, NOT urgent: high-leverage planned work that grows the business. (Strategy, systems, recruiting, training, recurring touch cadence, financial review.)
- C = Urgent, NOT important: someone else's urgency or admin you should delegate. (Routine paperwork, low-value calls, vendor coordination Josh can handle.)
- D = Neither: drop. (Distractions, busywork, optional reading.)

Look at: (1) is there a hard deadline today/tomorrow? → push toward A or C. (2) does it move the business forward or just keep it spinning? → A/B if forward, C/D if spinning. (3) does the OWNER need to do this personally? → A/B if yes, C if delegable.

Output ONLY a JSON object: {"quadrant": "A|B|C|D", "confidence": 0-1, "reasoning": "one short sentence"}. No prose outside the JSON.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // SECURITY: require authenticated caller to prevent unauthenticated use of Anthropic key
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
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

    const { title, notes, due_date } = await req.json();
    if (!title) {
      return new Response(JSON.stringify({ error: "title required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userMsg = `Task: ${title}` +
      (notes ? `\nNotes: ${notes}` : "") +
      (due_date ? `\nDue date: ${due_date}` : "");

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 200,
        system: SYSTEM,
        messages: [{ role: "user", content: userMsg }],
      }),
    });

    if (!r.ok) throw new Error(`Anthropic error: ${r.status}`);
    const j = await r.json();
    const text = j.content?.[0]?.text || "";
    const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    if (!["A","B","C","D"].includes(parsed.quadrant)) {
      throw new Error("Invalid quadrant returned");
    }

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
