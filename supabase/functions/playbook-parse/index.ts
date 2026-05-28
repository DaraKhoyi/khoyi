// supabase/functions/playbook-parse/index.ts
// Uses Claude to parse a playbook brain entry into structured steps.
// POST { brain_entry_id: uuid, user_id: uuid }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROMPT = `You are parsing a real-estate brokerage playbook into structured steps.
The playbook describes a repeatable process (trigger + numbered steps + owner + watch-out).

For each numbered step in the playbook, output ONE JSON object with these fields:
- title: short imperative phrase (e.g., "Schedule photos", "Open transaction file"). Max 60 chars.
- detail: 1-2 sentences with the specific action and acceptance criteria.
- owner: who does it ("Listing agent", "Josh Maples", "Buyer agent", etc) — null if not specified.
- timing: the time phrase from the source ("same day", "24 hours", "Day 2-3", "weekly", etc) — null if not specified.
- default_quadrant: ONE of A/B/C/D in Eisenhower terms:
    A = Urgent & Important (must do today / blocks the deal),
    B = Important, Not Urgent (scheduled, planned work — most playbook steps),
    C = Urgent, Not Important (delegate),
    D = Neither.
    Default to B unless the step is clearly time-critical (then A) or pure delegation/QC (C).
- due_offset_days: integer days from playbook trigger to schedule this step. 0 = same day, 1 = next day, 7 = one week, etc. Null if no time component.

Output ONLY a JSON array of these objects, in step order. No prose, no markdown, no explanation. Start with [ and end with ].`;

async function callClaude(playbookText: string): Promise<any[]> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      system: PROMPT,
      messages: [{ role: "user", content: playbookText }],
    }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Anthropic error: ${r.status} ${t.slice(0, 300)}`);
  }
  const j = await r.json();
  const text = j.content?.[0]?.text || "";
  // Strip potential code fences
  const cleaned = text.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
  // Find first [ ... ] block
  const start = cleaned.indexOf("[");
  const end = cleaned.lastIndexOf("]");
  if (start === -1 || end === -1) throw new Error("Claude response did not contain a JSON array");
  return JSON.parse(cleaned.slice(start, end + 1));
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { brain_entry_id, user_id } = await req.json();

    if (!brain_entry_id || !user_id) {
      return new Response(JSON.stringify({ error: "brain_entry_id and user_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: rErr } = await supabase
      .from("brain")
      .select("id, title, content, type, user_id")
      .eq("id", brain_entry_id)
      .single();

    if (rErr || !row) throw new Error("Brain entry not found");
    if (row.user_id !== user_id) throw new Error("Permission denied");
    if (row.type !== "playbook") throw new Error("Entry is not a playbook");
    if (!row.content) throw new Error("Playbook has no content to parse");

    const text = `Title: ${row.title}\n\n${row.content}`;
    const steps = await callClaude(text);

    // Replace existing steps for this playbook
    await supabase.from("playbook_steps").delete().eq("brain_entry_id", brain_entry_id);

    const rows = steps.map((s: any, idx: number) => ({
      brain_entry_id,
      user_id,
      step_order: idx + 1,
      title: String(s.title || "").slice(0, 120) || `Step ${idx + 1}`,
      detail: s.detail || null,
      owner: s.owner || null,
      timing: s.timing || null,
      default_quadrant: ["A","B","C","D"].includes(s.default_quadrant) ? s.default_quadrant : "B",
      due_offset_days: typeof s.due_offset_days === "number" ? s.due_offset_days : null,
    }));

    if (rows.length > 0) {
      const { error: iErr } = await supabase.from("playbook_steps").insert(rows);
      if (iErr) throw iErr;
    }

    return new Response(JSON.stringify({ ok: true, parsed: rows.length, steps: rows }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
