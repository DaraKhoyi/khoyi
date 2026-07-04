// email-reply-draft
// Drafts an email reply on behalf of the signed-in agent, adapted to the recipient's
// DISC style. Now layers the calling agent's ACTIVE personal voice card (MyVoice) on
// top of the brokerage house voice; falls back to the default house voice when the
// agent has no personal card. Request/response contract preserved exactly.
//
// POST { sender_name?, recipient_name?|from_name?, original_subject?, original_body?,
//        disc_primary?, disc_secondary?, disc_rationale? }
// -> { draft: string, disc: string|null } | { error: string }
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-4-6";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const DISC_GUIDE: Record<string, string> = {
  D: "Direct and bottom-line-first. Lead with the answer or decision. Keep it short. Offer clear options. Skip small talk.",
  I: "Warm, upbeat and personable. A little light rapport up front, then get to the point. Friendly and encouraging.",
  S: "Friendly and reassuring; relationship-first. Patient, no pressure. Acknowledge them and keep it steady and kind.",
  C: "Precise and specific. Give the relevant facts, details, next steps and dates. Logical and accurate. No hype.",
};

// Loads the calling agent's ACTIVE personal voice card (MyVoice). Returns null for
// users without one, preserving default behavior.
async function loadVoice(req: Request): Promise<{ body: string; name: string | null } | null> {
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return null;
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return null;
    const { data: vc } = await supabase.from("voice_cards").select("body").eq("user_id", user.id).eq("kind", "agent").eq("is_active", true).order("updated_at", { ascending: false }).limit(1);
    if (!vc || !vc[0] || !vc[0].body) return null;
    let name: string | null = null;
    try { const { data: ag } = await supabase.from("agents").select("name").eq("auth_user_id", user.id).maybeSingle(); if (ag && ag.name) name = ag.name; } catch (_) {}
    return { body: vc[0].body as string, name };
  } catch (_) { return null; }
}

// -- BYOK + metering helpers --
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

async function retrieveKnowledge(queryText: string, userToken: string) {
  try {
    const vk = Deno.env.get("VOYAGE_API_KEY");
    const URL = Deno.env.get("SUPABASE_URL")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    if (!vk || !queryText || !queryText.trim()) return [] as any[];
    const er = await fetch("https://api.voyageai.com/v1/embeddings", { method: "POST", headers: { Authorization: `Bearer ${vk}`, "Content-Type": "application/json" }, body: JSON.stringify({ input: [queryText.slice(0, 2000)], model: "voyage-3.5", input_type: "query", output_dimension: 1024 }) });
    if (!er.ok) return [];
    const emb = "[" + (await er.json()).data[0].embedding.join(",") + "]";
    const uc = createClient(URL, ANON, { global: { headers: { Authorization: `Bearer ${userToken}` } } });
    const { data: hits } = await uc.rpc("knowledge_search", { query_embedding: emb, query_text: queryText.slice(0, 500), match_count: 12 });
    if (!hits || !hits.length) return [];
    let order = hits.slice(0, 4);
    try {
      const rr = await fetch("https://api.voyageai.com/v1/rerank", { method: "POST", headers: { Authorization: `Bearer ${vk}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: queryText.slice(0, 2000), documents: hits.map((h: any) => h.content), model: "rerank-2.5", top_k: Math.min(4, hits.length) }) });
      if (rr.ok) { const rj = await rr.json(); order = rj.data.map((d: any) => hits[d.index]); }
    } catch (_) {}
    return order.map((h: any) => ({ title: h.title, content: h.content }));
  } catch (_) { return []; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({}));
    const sender = (b.sender_name || "Dara").toString();
    const recipient = (b.recipient_name || b.from_name || "there").toString();
    const subject = (b.original_subject || "").toString().slice(0, 300);
    const body = (b.original_body || "").toString().slice(0, 6000);
    const dp = (b.disc_primary || "").toString().toUpperCase().slice(0, 1);
    const ds = (b.disc_secondary || "").toString().toUpperCase().slice(0, 1);
    const rationale = (b.disc_rationale || "").toString().slice(0, 600);

    let discLine = "No DISC profile is available — use a balanced, professional tone.";
    if (dp && DISC_GUIDE[dp]) {
      discLine = `Recipient's DISC style is ${dp}${ds ? "/" + ds : ""}. Primary (${dp}): ${DISC_GUIDE[dp]}`;
      if (ds && DISC_GUIDE[ds]) discLine += ` Secondary (${ds}): ${DISC_GUIDE[ds]}`;
      if (rationale) discLine += ` Context on them: ${rationale}`;
    }

    const voice = await loadVoice(req);
    const senderName = (voice && voice.name) || sender;
    const system = voice
      ? `You draft an email reply on behalf of ${senderName}, a real-estate agent, in their OWN voice — captured here and authoritative on tone, phrasing, rhythm, word choice, and sign-off:\n"""${voice.body}"""\nThe brokerage house voice (warm, clear, professional, concise, human, no clichés) is the floor; ${senderName}'s voice above rides on top and wins wherever they differ. Write ONLY the reply body as plain text, ready to send: no subject line, no "Re:", no quoted original, no email headers. Keep it appropriately brief and genuinely responsive to what the email actually asks. Adapt to the recipient's DISC communication style. Output ONLY the reply text.`
      : `You draft an email reply on behalf of ${senderName}, a Tampa Bay real-estate broker, in their voice: warm, clear, professional, concise, and human — no corporate fluff, no clichés. Write ONLY the reply body as plain text, ready to send: no subject line, no "Re:", no quoted original, no email headers. A short natural sign-off like "Best,\n${senderName}" is fine. Keep it appropriately brief and genuinely responsive to what the email actually asks. Adapt the tone to the recipient's DISC communication style. Output ONLY the reply text.`;

    const userMsg = `Recipient: ${recipient}\n${discLine}\n\nThe email ${senderName} received (from ${b.from_name || recipient}), subject "${subject}":\n---\n${body || "(no body)"}\n---\n\nWrite ${senderName}'s reply now.`;

    const __sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let __uid = null; try { const __t = (req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim(); const { data: { user: __u } } = await __sb.auth.getUser(__t); __uid = __u?.id || null; } catch(_){}
    const { key: __k, usedOwn: __own } = await resolveKey(__sb, __uid, ANTHROPIC_API_KEY);
    let __kb = "";
    try { const __tok = (req.headers.get("Authorization")||"").replace(/^Bearer\s+/i,"").trim(); const __p = await retrieveKnowledge(`${b.subject||""} ${body}`.trim().slice(0,600), __tok); if (__p.length) __kb = "\n\nRelevant background from the user\u2019s saved knowledge (weave in naturally ONLY where it genuinely helps; do not force it, list it, or invent beyond it):\n" + __p.map((x:any)=>`- ${x.title}: ${x.content}`).join("\n"); } catch(_){}
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": __k, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, system, messages: [{ role: "user", content: userMsg + __kb }] }),
    });
    const data = await r.json();
    logUsage(__sb, { userId: __uid, fn: "email-reply-draft", model: MODEL, usage: data.usage, usedOwn: __own });
    const draft = (data?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("").trim();
    return new Response(JSON.stringify({ draft, disc: dp || null }), { headers: { ...cors, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as any)?.message || e) }), { status: 200, headers: { ...cors, "content-type": "application/json" } });
  }
});
