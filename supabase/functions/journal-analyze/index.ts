import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

async function embed(text: string): Promise<number[] | null> {
  try {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Authorization": `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 8000) }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j.data?.[0]?.embedding || null;
  } catch { return null; }
}
async function claudeJSON(system: string, user: string) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error("claude " + r.status);
  const j = await r.json();
  const txt = (j.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
  const clean = txt.replace(/```json|```/g, "").trim();
  try { return JSON.parse(clean); } catch { return { links: [], action_items: [], follow_ups: [] }; }
}
const tok = (s: string) => (s || "").toLowerCase();

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { entry_id } = await req.json().catch(() => ({}));
    if (!entry_id) return new Response(JSON.stringify({ error: "entry_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const supabase = createClient(SUPABASE_URL, SERVICE);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const userId = user.id;

    const { data: entry } = await supabase.from("journal_entries").select("id,user_id,content").eq("id", entry_id).maybeSingle();
    if (!entry || entry.user_id !== userId) return new Response(JSON.stringify({ error: "Entry not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const text = entry.content || "";
    const lc = tok(text);

    // Candidate scan against the user's real records (keeps the model grounded + cheap)
    const [cts, props, projs, deals] = await Promise.all([
      supabase.from("contacts").select("id,name").eq("user_id", userId).limit(10000),
      supabase.from("properties").select("id,nickname,address").eq("user_id", userId).limit(2000),
      supabase.from("projects").select("id,name").eq("owner_id", userId).limit(500),
      supabase.from("deals").select("id,name,client_name,address").eq("user_id", userId).limit(2000),
    ]);
    const cand: any[] = [];
    (cts.data || []).forEach((c: any) => {
      const n = tok(c.name); if (!n) return;
      const parts = n.split(/\s+/).filter((p) => p.length >= 3);
      const full = n.length >= 4 && lc.includes(n);
      const lastHit = parts.length > 1 && lc.includes(parts[parts.length - 1]) && parts[parts.length - 1].length >= 4;
      if (full || lastHit) cand.push({ type: "contact", id: c.id, label: c.name });
    });
    (props.data || []).forEach((p: any) => {
      const nn = tok(p.nickname), ad = tok(p.address);
      if ((nn && nn.length >= 3 && lc.includes(nn)) || (ad && ad.length >= 6 && lc.includes(ad.split(",")[0]))) cand.push({ type: "property", id: p.id, label: p.nickname || p.address });
    });
    (projs.data || []).forEach((p: any) => { const n = tok(p.name); if (n && n.length >= 3 && lc.includes(n)) cand.push({ type: "project", id: p.id, label: p.name }); });
    (deals.data || []).forEach((d: any) => {
      const n = tok(d.name || ""), cn = tok(d.client_name || "");
      if ((n && n.length >= 3 && lc.includes(n)) || (cn && cn.length >= 4 && lc.includes(cn))) cand.push({ type: "deal", id: d.id, label: d.name || d.client_name });
    });
    // de-dupe + cap
    const seen = new Set<string>();
    const candidates = cand.filter((c) => { const k = c.type + c.id; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 30);

    // Ask Claude to confirm which candidates are truly referenced + extract action items
    let analysis: any = { links: [], action_items: [], follow_ups: [] };
    if (text.trim()) {
      const system = "You analyze a real-estate professional's journal entry. Return ONLY JSON, no prose. " +
        "Given the entry and a list of candidate records (people/properties/projects/deals) that name-matched the text, decide which are GENUINELY referenced by this entry (not coincidental name overlap). " +
        "Also extract concrete action items the writer should do, and any follow-up dates mentioned. " +
        'JSON shape: {"links":[{"type":"contact|property|project|deal","id":"<candidate id>","confidence":0.0-1.0}],"action_items":[{"title":"short imperative","due_date":"YYYY-MM-DD or null"}],"follow_ups":[{"text":"...","date":"YYYY-MM-DD or null"}]}. ' +
        "Only use ids from the candidate list. Confidence reflects how sure you are the entry refers to that record.";
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
      const userMsg = `Today is ${today}.\n\nJOURNAL ENTRY:\n"""${text.slice(0, 4000)}"""\n\nCANDIDATES:\n${JSON.stringify(candidates)}`;
      analysis = await claudeJSON(system, userMsg);
    }
    const labelById: Record<string, string> = {};
    candidates.forEach((c) => { labelById[c.type + ":" + c.id] = c.label; });
    const links = (analysis.links || []).filter((l: any) => l && l.id && l.type).map((l: any) => ({
      type: l.type, id: l.id, label: labelById[l.type + ":" + l.id] || null, confidence: Math.max(0, Math.min(1, Number(l.confidence) || 0)),
    })).filter((l: any) => l.label);

    // Embed the entry for semantic search
    const vec = await embed(text);
    const upd: any = { analyzed: true, updated_at: new Date().toISOString() };
    if (vec) upd.embedding = `[${vec.join(",")}]`;
    await supabase.from("journal_entries").update(upd).eq("id", entry_id);

    return new Response(JSON.stringify({ links, action_items: analysis.action_items || [], follow_ups: analysis.follow_ups || [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String((err as any)?.message || err) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
