import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { period_type, period_key, start, end } = await req.json().catch(() => ({}));
    if (!start || !end || !period_type) return new Response(JSON.stringify({ error: "period_type, start, end required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const supabase = createClient(SUPABASE_URL, SERVICE);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = user.id;
    const { data: entries } = await supabase.from("journal_entries").select("id,day,occurred_at,content").eq("user_id", userId).gte("day", start).lte("day", end).order("occurred_at");
    if (!entries || !entries.length) return new Response(JSON.stringify({ summary: null, message: "No entries in this period." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: links } = await supabase.from("journal_links").select("entry_id,entity_type,label,confirmed").in("entry_id", entries.map((e: any) => e.id)).eq("dismissed", false);
    const linkBy: Record<string, string[]> = {};
    (links || []).forEach((l: any) => { if (l.confirmed) (linkBy[l.entry_id] = linkBy[l.entry_id] || []).push(`${l.entity_type}:${l.label}`); });
    const byDay: Record<string, string[]> = {};
    entries.forEach((e: any) => { const line = `${e.content}${linkBy[e.id]?.length ? ` (re: ${linkBy[e.id].join(", ")})` : ""}`; (byDay[e.day] = byDay[e.day] || []).push(line); });
    const transcript = Object.keys(byDay).sort().map((d) => `### ${d}\n${byDay[d].join("\n")}`).join("\n\n");
    const label = period_type === "month" ? "month" : "week";
    const system = `You are the user's chief of staff writing the story of their ${label} from their journal. Be specific, use names, find the throughline. Return ONLY JSON: ` +
      `{"story":"3-6 sentence narrative arc of the ${label}","relationships":["person + how the relationship advanced"],"deals_projects":["deal/project + what moved"],"wins":["concrete wins"],"patterns":["habits or patterns you notice — candid and useful"],"focus_next":["the few things to prioritize next ${label}, most important first"]}. Keep each array item under 20 words.`;
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1800, system, messages: [{ role: "user", content: `Period: ${start} → ${end} (${entries.length} entries)\n\n${transcript.slice(0, 16000)}` }] }),
    });
    if (!r.ok) throw new Error("claude " + r.status);
    const j = await r.json();
    const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json|```/g, "").trim();
    let parsed: any; try { parsed = JSON.parse(txt); } catch { parsed = { story: txt }; }
    await supabase.from("journal_periods").upsert({ user_id: userId, period_type, period_key: period_key || `${start}_${end}`, start_date: start, end_date: end, summary: parsed.story || null, highlights: parsed, generated_at: new Date().toISOString() }, { onConflict: "user_id,period_type,period_key" });
    return new Response(JSON.stringify({ summary: parsed, entry_count: entries.length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
