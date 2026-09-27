// Auth + cost attribution added 26 Sep. This function had NO caller check and
// verify_jwt is off: anyone who found the URL could spend the brokerage's Claude
// credit, and none of the spend was attributed (standing rule: every function
// spending tokens logs to ai_usage_log against the user). The app only calls it
// from a signed-in screen via supabase.functions.invoke, which sends the user's JWT.
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: ures } = token ? await admin.auth.getUser(token) : { data: null as any };
    const userId = ures?.user?.id;
    if (!userId) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "content-type": "application/json" } });
    const { subject = "", from_name = "", body = "" } = await req.json().catch(() => ({}));
    const clip = (s: string, n: number) => ((s || "").length > n ? (s.slice(0, n) + "…") : (s || ""));
    const sys = `You turn an email into a single, action-oriented to-do for the recipient (a busy Tampa Bay real-estate broker). Output ONLY a JSON object: {"title": string, "summary": string}. No prose, no markdown.
- title: an imperative task title describing what the recipient should DO about this email (e.g., "Reply to Jane re: listing paperwork", "Review and sign the Oak Vine addendum", "Call back the WIRELESS CALLER voicemail"). Max ~80 characters. No surrounding quotes, no trailing period.
- summary: one plain-English sentence capturing the ask and why it matters. Max ~200 characters.
If there is no clear action, set title to "Follow up: <short subject gist>".`;
    const user = `From: ${from_name || "(unknown)"}\nSubject: ${clip(subject, 200)}\n\nEmail body:\n${clip(body, 6000)}`;
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 300, system: sys, messages: [{ role: "user", content: user }] }),
    });
    const data = await resp.json();
    await logAiUsage(admin, { userId, fn: "email-to-task", model: MODEL, usage: data?.usage, usedOwn: false });
    let txt = (data?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    txt = txt.replace(/```json|```/g, "").trim();
    let out: any = {};
    try { out = JSON.parse(txt); } catch { out = {}; }
    const title = ((out.title || "").toString().trim().slice(0, 120)) || (subject ? `Follow up: ${subject}`.slice(0, 120) : "Follow up on email");
    const summary = (out.summary || "").toString().trim().slice(0, 300);
    return new Response(JSON.stringify({ title, summary }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 200, headers: { ...cors, "content-type": "application/json" } });
  }
});
