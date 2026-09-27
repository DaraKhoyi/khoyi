// sync-agent-profiles — mirrors a formal DISC assessment entered on an "Our Agent"
// contact (owner's side) to that agent's OWN self-profile, and seeds their Voice Card,
// so the assessment shows up on the agent's side and tunes their assistant.
// Match path: contact.type='our_agent' + contact.email -> agents.email -> agents.auth_user_id.
// Idempotent. POST { contact_id?, owner_user_id }  (internal-token guarded).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logAiUsage } from "../_shared/aiUsage.ts";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC = Deno.env.get("ANTHROPIC_API_KEY")!;
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function seedVoiceCard(admin: any, agentAuth: string, name: string, p: any) {
  const { data: existing } = await admin.from("voice_cards").select("id").eq("user_id", agentAuth).limit(1);
  if (existing && existing.length) return false; // don't overwrite an agent's own voice
  let persona = "", dos: string[] = [], donts: string[] = [], body = "";
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "x-api-key": ANTHROPIC, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 700, messages: [{ role: "user", content: `A real-estate agent named ${name} has this DISC profile (from a formal Innermetrix assessment): D:${p.d} I:${p.i} S:${p.s} C:${p.c}, primary ${p.primary}${p.secondary ? "/" + p.secondary : ""}. Write a STARTING voice profile for THEIR assistant to draft messages in THEIR natural voice (not how to talk to them). Return STRICT JSON: { "persona_summary": "2-3 sentences on how this person naturally communicates given their DISC", "do_examples": ["3-4 short do's — phrasing/tone that fits them"], "dont_examples": ["3-4 short dont's"] }. Ground it in the DISC (e.g. high D = brief, outcome-first; high I = warm, energetic; high S = steady, personable; high C = precise, proof-led).` }] }),
    });
    const d = await r.json();
    // Cost attribution (added 26 Sep): billed to the agent whose voice card this seeds.
    await logAiUsage(admin, { userId: agentAuth, fn: "sync-agent-profiles", model: "claude-sonnet-4-6", usage: d?.usage, usedOwn: false });
    const t = (d.content || []).map((c: any) => c.text || "").join("");
    const j = JSON.parse(t.match(/\{[\s\S]*\}/)[0]);
    persona = j.persona_summary || ""; dos = j.do_examples || []; donts = j.dont_examples || [];
  } catch (_) { persona = `Starting voice for ${name} (primary ${p.primary}). Refines automatically as ${name} communicates.`; }
  body = `${persona}\n\nThis is a starting point from your assessment — it sharpens automatically as you communicate. Recorded conversations carry the richest signal.`;
  const { error } = await admin.from("voice_cards").insert({ user_id: agentAuth, name: `${name} — My Voice`, kind: "agent", is_active: true, body, persona_summary: persona, do_examples: dos, dont_examples: donts });
  if (error) throw new Error(error.message);
  return true;
}

serve(async (req) => {
  try {
    // Fail CLOSED (26 Sep): the old compare was ("" !== "") when QCP_TOKEN is
    // unset, which would have let a request with no header straight through.
    const qcp = Deno.env.get("QCP_TOKEN") || "";
    if (!qcp || (req.headers.get("x-internal-token") || "") !== qcp) return J({ error: "unauthorized" }, 401);
    const b = await req.json().catch(() => ({}));
    const admin = createClient(SUPABASE_URL, SERVICE);
    // eligible source assessments on Our Agent contacts
    let query = admin.from("profiles").select("contact_id, baseline_d_score, baseline_i_score, baseline_s_score, baseline_c_score, baseline_primary, baseline_secondary, baseline_source, baseline_taken_at, signals_count, contacts!inner(id, name, email, type)")
      .eq("baseline_locked", true).not("baseline_d_score", "is", null).eq("contacts.type", "our_agent");
    if (b.contact_id) query = query.eq("contact_id", b.contact_id);
    const { data: sources, error } = await query;
    if (error) return J({ error: error.message }, 500);
    if (!sources || !sources.length) return J({ ok: true, synced: 0, note: "no eligible Our Agent assessments" });

    const results: any[] = [];
    for (const src of sources) {
      const c = (src as any).contacts;
      const email = (c?.email || "").trim().toLowerCase();
      if (!email) { results.push({ contact: c?.name, skipped: "no email" }); continue; }
      const { data: agents } = await admin.from("agents").select("auth_user_id, name").ilike("email", email).not("auth_user_id", "is", null).limit(1);
      const agent = agents && agents[0];
      if (!agent) { results.push({ contact: c?.name, skipped: "no matching agent login" }); continue; }
      const agentAuth = agent.auth_user_id;
      const p = { d: src.baseline_d_score, i: src.baseline_i_score, s: src.baseline_s_score, c: src.baseline_c_score, primary: src.baseline_primary, secondary: src.baseline_secondary };
      // Upsert the agent's OWN self-profile (subject_kind='owner')
      const { data: selfP } = await admin.from("profiles").select("id").eq("user_id", agentAuth).eq("subject_kind", "owner").limit(1);
      const payload: any = {
        user_id: agentAuth, subject_kind: "owner",
        d_score: p.d, i_score: p.i, s_score: p.s, c_score: p.c, primary_letter: p.primary, secondary_letter: p.secondary,
        baseline_d_score: p.d, baseline_i_score: p.i, baseline_s_score: p.s, baseline_c_score: p.c,
        baseline_primary: p.primary, baseline_secondary: p.secondary, baseline_locked: true,
        baseline_source: src.baseline_source, baseline_taken_at: src.baseline_taken_at,
        confidence: "high", confidence_pct: 90, analysis_status: "ready",
        source: "manual", last_analyzed_at: new Date().toISOString(),
      };
      const up = selfP && selfP.length
        ? await admin.from("profiles").update(payload).eq("id", selfP[0].id)
        : await admin.from("profiles").insert(payload);
      if (up.error) { results.push({ contact: c?.name, error: "profile: " + up.error.message }); continue; }
      let vc = false, vcErr = null;
      try { vc = await seedVoiceCard(admin, agentAuth, agent.name || c?.name || "Agent", p); } catch (e) { vcErr = String(e); }
      results.push({ contact: c?.name, agent: agent.name, mirrored: true, voice_card_seeded: vc, vcErr });
    }
    return J({ ok: true, synced: results.filter(r => r.mirrored).length, results });
  } catch (e) { return J({ error: String(e) }, 500); }
});
