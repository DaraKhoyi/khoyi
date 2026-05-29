// disc-analyze
// Pulls communications/notes/observations for a contact, asks Claude for a DISC
// behavioral signal inference, writes results to profiles + disc_evidence.
//
// POST { contact_id: uuid, user_id: uuid, force?: boolean, priority?: number }
//   force: bypass any "skip recent re-analysis" guard
//
// Methodology baked in:
//  - Inbound emails weighted 3x outbound (their words > yours quoting them)
//  - Recency weighting: linear decay over 365d, floored at 0.2
//  - Notes you wrote weighted 2x (your in-person observation)
//  - If a baseline (test) exists, Claude is biased toward agreement; deviations
//    must be supported by strong recent evidence and generate a drift_note.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `You are an expert behavioral analyst applying the DISC framework to inferred communication patterns.

DISC dimensions:
- D (Dominance): Direct, decisive, results-driven, terse, impatient with detail, asks "what".
- I (Influence): Enthusiastic, social, persuasive, story-prone, exclamatory, references people.
- S (Steadiness): Patient, consensus-seeking, reassuring, dislikes change, asks about feelings, longer responses.
- C (Conscientiousness): Precise, data-oriented, qualifies statements, requests documentation, asks "why" and "how".

CRITICAL RULES for honest inference:
1. Strong signals: word choice, question type ("what" vs "why"), reference to people vs data, urgency vs consensus language, sentence length patterns.
2. Avoid weak signals: punctuation alone, single-email mood, formality conventions, busy-ness.
3. Weight evidence by source: inbound emails (the contact's own words) > outbound (yours quoting them); user notes (direct observation) > anything inferred from text.
4. Recency matters: stale evidence loses weight.
5. If a BASELINE TEST RESULT is provided, treat it as the trusted starting point. Only deviate when recent evidence strongly indicates change. When you do deviate, write a drift_note explaining the observed change AND a plausible context reason (stress, role change, new responsibility, etc.).
6. Confidence: be honest. 1-2 emails = low (under 40%). 3-8 with consistent signals = medium (40-70%). 9+ across multiple contexts with consistent signals = high (70-90%). Only exceed 90% with strong, varied, recent evidence OR an official test baseline confirmed by communications.

Output ONLY a JSON object, no prose, no markdown:
{
  "d_score": 0-100,
  "i_score": 0-100,
  "s_score": 0-100,
  "c_score": 0-100,
  "primary": "D|I|S|C",
  "secondary": "D|I|S|C|null",   // null if single dominant
  "confidence_pct": 0-100,
  "confidence_label": "Low|Medium|High|Very High|Provisional",
  "rationale": "1-2 sentence summary of the headline read",
  "drift_note": "If baseline differs from current, explain. Else null.",
  "evidence": [
    {
      "ref": "exact source_ref_id provided",
      "kind": "email_incoming|email_outgoing|note|calendar_event",
      "signals": { "d": 0-10, "i": 0-10, "s": 0-10, "c": 0-10 },
      "reasoning": "one sentence: what about this piece signaled what"
    }
    // include one entry per piece of evidence you actually drew on; omit pieces that were too sparse to inform anything
  ]
}`;

const MS_PER_DAY = 86400000;

function recencyWeight(dateStr?: string | null): number {
  if (!dateStr) return 0.5;
  const ageDays = (Date.now() - new Date(dateStr).getTime()) / MS_PER_DAY;
  if (ageDays < 0) return 1.0;
  // Linear decay over 365 days, floor at 0.2
  return Math.max(0.2, 1.0 - (ageDays / 365));
}

function sourceWeight(kind: string): number {
  switch (kind) {
    case "note":
    case "contact_note": return 2.0;
    case "email_incoming": return 1.5;
    case "email_outgoing": return 0.5;
    case "calendar_event":
    case "interaction": return 0.8;
    default: return 1.0;
  }
}

interface EvidenceItem {
  ref: string;
  kind: string;
  excerpt: string;
  dated_at?: string;
}

async function gatherEvidence(supabase: any, userId: string, contact: any): Promise<EvidenceItem[]> {
  const evidence: EvidenceItem[] = [];

  // 1) Notes on the contact record
  if (contact.notes && contact.notes.trim()) {
    evidence.push({
      ref: `contact:${contact.id}:notes`,
      kind: "contact_note",
      excerpt: contact.notes.slice(0, 2000),
      dated_at: contact.updated_at,
    });
  }

  // 2) Standalone notes that mention this contact (by name or email)
  if (contact.name || contact.email) {
    const filters: string[] = [];
    if (contact.name) filters.push(`title.ilike.%${contact.name}%,body.ilike.%${contact.name}%`);
    if (contact.email) filters.push(`body.ilike.%${contact.email}%`);
    const orQuery = filters.join(',');
    try {
      const { data: notes } = await supabase.from("notes").select("id, title, body, updated_at")
        .eq("user_id", userId).or(orQuery).limit(10);
      for (const n of notes || []) {
        evidence.push({
          ref: `note:${n.id}`,
          kind: "note",
          excerpt: `${n.title || ''}\n${(n.body || '').slice(0, 1500)}`,
          dated_at: n.updated_at,
        });
      }
    } catch (_) { /* notes search is best-effort */ }
  }

  // 3) Inbound emails FROM this contact
  if (contact.email) {
    const { data: inMsgs } = await supabase.from("email_messages")
      .select("id, subject, body_text, snippet, internal_date, from_address")
      .eq("user_id", userId)
      .ilike("from_address", contact.email)
      .order("internal_date", { ascending: false })
      .limit(20);
    for (const m of inMsgs || []) {
      evidence.push({
        ref: `email_in:${m.id}`,
        kind: "email_incoming",
        excerpt: `Subject: ${m.subject || ''}\n${(m.body_text || m.snippet || '').slice(0, 1800)}`,
        dated_at: m.internal_date,
      });
    }

    // 4) Outbound emails TO this contact (lighter weight)
    const { data: outMsgs } = await supabase.from("email_messages")
      .select("id, subject, body_text, snippet, internal_date, to_addresses")
      .eq("user_id", userId)
      .contains("to_addresses", [contact.email])
      .order("internal_date", { ascending: false })
      .limit(8);
    for (const m of outMsgs || []) {
      evidence.push({
        ref: `email_out:${m.id}`,
        kind: "email_outgoing",
        excerpt: `Subject: ${m.subject || ''}\n${(m.body_text || m.snippet || '').slice(0, 1200)}`,
        dated_at: m.internal_date,
      });
    }
  }

  // 5) Calendar events with this contact
  try {
    const { data: events } = await supabase.from("events")
      .select("id, title, description, start_at")
      .eq("user_id", userId).eq("contact_id", contact.id)
      .order("start_at", { ascending: false }).limit(8);
    for (const e of events || []) {
      evidence.push({
        ref: `event:${e.id}`,
        kind: "calendar_event",
        excerpt: `${e.title || ''} — ${(e.description || '').slice(0, 600)}`,
        dated_at: e.start_at,
      });
    }
  } catch (_) { /* events optional */ }

  return evidence;
}

function buildCorpus(contact: any, baseline: any, evidence: EvidenceItem[]): string {
  const parts: string[] = [];
  parts.push(`CONTACT: ${contact.name || contact.email || '(unnamed)'}`);
  if (contact.role) parts.push(`Role: ${contact.role}`);
  if (contact.company) parts.push(`Company: ${contact.company}`);

  if (baseline.has_baseline) {
    parts.push(`\nBASELINE TEST RESULT (trusted starting point):`);
    parts.push(`  Scores — D:${baseline.d} I:${baseline.i} S:${baseline.s} C:${baseline.c}`);
    parts.push(`  Primary: ${baseline.primary}${baseline.secondary ? ` / ${baseline.secondary}` : ''}`);
    if (baseline.taken_at) parts.push(`  Test taken: ${new Date(baseline.taken_at).toLocaleDateString()}`);
    parts.push(`  Source: ${baseline.source || 'Prism Test'}`);
  } else {
    parts.push(`\nBASELINE: none (no official test on file — work from communications only)`);
  }

  parts.push(`\nEVIDENCE CORPUS (${evidence.length} pieces, recent first):`);
  for (const e of evidence) {
    const ageDays = e.dated_at ? Math.round((Date.now() - new Date(e.dated_at).getTime()) / MS_PER_DAY) : null;
    const ageStr = ageDays !== null ? `${ageDays}d ago` : 'undated';
    parts.push(`\n[${e.ref} | ${e.kind} | ${ageStr}]`);
    parts.push(e.excerpt);
  }
  return parts.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { contact_id, user_id, force = false } = await req.json();
    if (!contact_id || !user_id) throw new Error("contact_id and user_id required");

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Load contact
    const { data: contact, error: cErr } = await supabase.from("contacts")
      .select("*").eq("id", contact_id).eq("user_id", user_id).maybeSingle();
    if (cErr || !contact) throw new Error("Contact not found");

    // Load existing profile (may have baseline)
    const { data: existingProfile } = await supabase.from("profiles")
      .select("*").eq("user_id", user_id).eq("contact_id", contact_id).maybeSingle();

    const baseline = {
      has_baseline: !!(existingProfile?.baseline_d_score !== null && existingProfile?.baseline_d_score !== undefined),
      d: existingProfile?.baseline_d_score,
      i: existingProfile?.baseline_i_score,
      s: existingProfile?.baseline_s_score,
      c: existingProfile?.baseline_c_score,
      primary: existingProfile?.baseline_primary,
      secondary: existingProfile?.baseline_secondary,
      taken_at: existingProfile?.baseline_taken_at,
      source: existingProfile?.baseline_source,
    };

    // Skip if recently analyzed (within 1h) unless force
    if (!force && existingProfile?.last_analyzed_at) {
      const ageMs = Date.now() - new Date(existingProfile.last_analyzed_at).getTime();
      if (ageMs < 60 * 60 * 1000) {
        return new Response(JSON.stringify({
          ok: true, skipped: true, reason: "analyzed within last hour; pass force=true to override",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Gather evidence
    const evidence = await gatherEvidence(supabase, user_id, contact);

    // No evidence + no baseline = nothing to do
    if (evidence.length === 0 && !baseline.has_baseline) {
      const upsertPayload = {
        user_id, contact_id, subject_kind: 'contact',
        analysis_status: 'no_data',
        confidence: 'low', confidence_pct: 0,
        signals_count: 0,
        last_analyzed_at: new Date().toISOString(),
        rationale: 'No communications or notes available to infer DISC.',
      };
      if (existingProfile) {
        const { error } = await supabase.from("profiles").update(upsertPayload).eq("id", existingProfile.id);
        if (error) throw new Error(`Profile update (no_data): ${error.message}`);
      } else {
        const { error } = await supabase.from("profiles").insert(upsertPayload);
        if (error) throw new Error(`Profile insert (no_data): ${error.message}`);
      }
      return new Response(JSON.stringify({ ok: true, status: 'no_data' }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // No new evidence + baseline = baseline-only profile
    if (evidence.length === 0 && baseline.has_baseline) {
      const upsertPayload = {
        user_id, contact_id, subject_kind: 'contact',
        d_score: baseline.d, i_score: baseline.i, s_score: baseline.s, c_score: baseline.c,
        primary_letter: baseline.primary, secondary_letter: baseline.secondary,
        analysis_status: 'baseline_only',
        confidence: 'high', confidence_pct: 85,
        signals_count: 0,
        last_analyzed_at: new Date().toISOString(),
        rationale: `Baseline test result (${baseline.source}, taken ${new Date(baseline.taken_at).toLocaleDateString()}). No communications to confirm or contradict.`,
        drift_note: null,
      };
      if (existingProfile) {
        const { error } = await supabase.from("profiles").update(upsertPayload).eq("id", existingProfile.id);
        if (error) throw new Error(`Profile update (baseline_only): ${error.message}`);
      } else {
        const { error } = await supabase.from("profiles").insert(upsertPayload);
        if (error) throw new Error(`Profile insert (baseline_only): ${error.message}`);
      }
      return new Response(JSON.stringify({ ok: true, status: 'baseline_only' }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Build corpus and call Claude
    const corpus = buildCorpus(contact, baseline, evidence);

    const claudeResp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: corpus }],
      }),
    });
    if (!claudeResp.ok) throw new Error(`Claude error: ${claudeResp.status} ${(await claudeResp.text()).slice(0,300)}`);
    const claudeData = await claudeResp.json();
    const responseText = claudeData.content?.[0]?.text || "";
    const cleaned = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("Claude did not return parseable JSON");
    const parsed = JSON.parse(cleaned.slice(start, end + 1));

    // Generate a batch id linking all evidence rows from this run
    const batchId = crypto.randomUUID();

    // Determine confidence label (string column on profiles)
    let confidenceText = 'low';
    const pct = parsed.confidence_pct || 0;
    if (pct >= 80) confidenceText = 'high';
    else if (pct >= 50) confidenceText = 'medium';

    // Choose analysis_status
    let status = 'ready';
    if (pct < 40) status = 'provisional';
    if (baseline.has_baseline && !parsed.drift_note) status = 'ready';

    // Compose updated profile
    const profilePayload: any = {
      user_id, contact_id, subject_kind: 'contact',
      d_score: parsed.d_score, i_score: parsed.i_score, s_score: parsed.s_score, c_score: parsed.c_score,
      primary_letter: parsed.primary,
      secondary_letter: parsed.secondary && parsed.secondary !== 'null' ? parsed.secondary : null,
      confidence: confidenceText,
      confidence_pct: pct,
      analysis_status: status,
      signals_count: evidence.length,
      last_analyzed_at: new Date().toISOString(),
      rationale: parsed.rationale || null,
      drift_note: parsed.drift_note && parsed.drift_note !== 'null' ? parsed.drift_note : null,
      source: 'behavioral_signal',
    };

    let profileId: string;
    if (existingProfile) {
      const { error: upErr } = await supabase.from("profiles").update(profilePayload).eq("id", existingProfile.id);
      if (upErr) throw new Error(`Profile update failed: ${upErr.message || upErr.code}`);
      profileId = existingProfile.id;
    } else {
      const { data: inserted, error: insErr } = await supabase.from("profiles").insert(profilePayload).select("id").single();
      if (insErr) throw new Error(`Profile insert failed: ${insErr.message || insErr.code}`);
      if (!inserted) throw new Error("Profile insert returned no row");
      profileId = inserted.id;
    }

    // Clear stale evidence and write fresh evidence trail
    await supabase.from("disc_evidence").delete().eq("contact_id", contact_id).eq("user_id", user_id);
    const evidenceByRef = new Map(evidence.map(e => [e.ref, e]));
    const evidenceRows = (parsed.evidence || [])
      .filter((ev: any) => evidenceByRef.has(ev.ref))
      .map((ev: any) => {
        const src = evidenceByRef.get(ev.ref)!;
        return {
          user_id, contact_id, profile_id: profileId,
          source_kind: src.kind,
          source_ref_id: src.ref,
          source_excerpt: src.excerpt.slice(0, 1500),
          source_dated_at: src.dated_at,
          signals_d: ev.signals?.d || 0,
          signals_i: ev.signals?.i || 0,
          signals_s: ev.signals?.s || 0,
          signals_c: ev.signals?.c || 0,
          weight: sourceWeight(src.kind) * recencyWeight(src.dated_at),
          reasoning: ev.reasoning || null,
          analysis_batch_id: batchId,
        };
      });
    if (evidenceRows.length > 0) {
      await supabase.from("disc_evidence").insert(evidenceRows);
    }

    return new Response(JSON.stringify({
      ok: true,
      status,
      profile: {
        primary: parsed.primary,
        secondary: parsed.secondary,
        d_score: parsed.d_score,
        i_score: parsed.i_score,
        s_score: parsed.s_score,
        c_score: parsed.c_score,
        confidence_pct: pct,
        confidence: confidenceText,
        drift_note: profilePayload.drift_note,
      },
      evidence_count: evidenceRows.length,
      total_signals_considered: evidence.length,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
