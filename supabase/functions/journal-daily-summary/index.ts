import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { day } = await req.json().catch(() => ({}));
    if (!day) return new Response(JSON.stringify({ error: "day required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const supabase = createClient(SUPABASE_URL, SERVICE);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = user.id;
    const { data: entries } = await supabase.from("journal_entries").select("id,occurred_at,content,kind").eq("user_id", userId).eq("day", day).order("occurred_at");
    if (!entries || !entries.length) return new Response(JSON.stringify({ summary: null, message: "No entries for this day." }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const ids = entries.map((e: any) => e.id);
    const { data: links } = await supabase.from("journal_links").select("entry_id,entity_type,label,confirmed").in("entry_id", ids).eq("dismissed", false);
    const linkBy: Record<string, string[]> = {};
    (links || []).forEach((l: any) => { if (l.confirmed) { (linkBy[l.entry_id] = linkBy[l.entry_id] || []).push(`${l.entity_type}:${l.label}`); } });
    const fmtT = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
    const transcript = entries.map((e: any) => `[${fmtT(e.occurred_at)}] ${e.content}${linkBy[e.id]?.length ? ` (re: ${linkBy[e.id].join(", ")})` : ""}`).join("\n");
    const system = "You are the user's chief of staff. Summarize their day from journal entries into a crisp, energizing recap. Return ONLY JSON: " +
      '{"recap":"2-4 sentence narrative of the day","people":["who they engaged + 1-line context"],"moved":["what progressed"],"open":["open loops / unfinished"],"tomorrow":["suggested follow-ups for tomorrow, most important first"]}. Be specific and concrete; use names. Keep each array item under 18 words.';
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1400, system, messages: [{ role: "user", content: `Day: ${day}\n\nENTRIES:\n${transcript.slice(0, 12000)}` }] }),
    });
    if (!r.ok) throw new Error("claude " + r.status);
    const j = await r.json();
    const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").replace(/```json|```/g, "").trim();
    let parsed: any; try { parsed = JSON.parse(txt); } catch { parsed = { recap: txt }; }
    await supabase.from("journal_days").upsert({ user_id: userId, day, summary: parsed.recap || null, highlights: parsed, summary_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: "user_id,day" });
    return new Response(JSON.stringify({ summary: parsed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
