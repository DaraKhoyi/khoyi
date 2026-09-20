// panel-draft — turn a finding into a change Dara can approve.
//
// THE MISSING HALF. panel-propose has been able to branch, commit, run the gate
// and merge since v1.08.03. Nothing ever fed it, because nothing read a finding
// and wrote the actual file edit. Dara turned on "let it propose changes
// overnight", found an empty queue, and was right to ask why — I had built the
// back half of a road and a switch pointing at it.
//
// This reads one finding, fetches the files it names from GitHub, asks Claude
// for the smallest edit that addresses it, and writes a panel_proposals row with
// the complete new content of each file. panel-propose takes it from there and
// nothing merges without Dara.
//
// DELIBERATE LIMITS, because a machine writing code into a live brokerage tool
// should be hard to misuse:
//   - Only findings the panel called "small". A medium finding is a
//     conversation, not a patch.
//   - Only files the finding NAMES. It cannot go looking for more.
//   - Never the forbidden paths panel-propose already refuses — migrations,
//     workflows, the gate itself, version.js, dataService.js — checked HERE too,
//     so a bad draft is never written rather than merely never merged.
//   - Whole-file content, not a diff. A diff that does not apply fails at merge
//     time, after CI has run; a file that is wrong fails at the gate, which is
//     where it should.
//   - One draft per call. Batch autonomy is a different decision and Dara has
//     not made it.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-qcp-token",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// Same list panel-propose enforces. Repeated on purpose: one rule, checked at
// both ends, because the cost of it being wrong here is a machine-written change
// to the thing that decides whether machine-written changes are safe.
const FORBIDDEN = [
  /^supabase\/migrations\//, /^\.github\//, /^smoke\//,
  /^src\/version\.js$/, /^src\/dataService\.js$/, /package(-lock)?\.json$/,
];
const forbidden = (p: string) => FORBIDDEN.some((re) => re.test(p));

const REPO = "DaraKhoyi/khoyi";

async function ghFile(path: string, token: string): Promise<string | null> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}?ref=main`, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": "PrismOS-Panel", Accept: "application/vnd.github.v3+json" },
  });
  if (!r.ok) return null;
  const j = await r.json();
  if (!j.content) return null;
  return new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.headers.get("x-qcp-token") !== Deno.env.get("QCP_TOKEN")) {
    return json({ error: "unauthorised" }, 401);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { finding_id } = await req.json().catch(() => ({}));

  const { data: cfg } = await admin.from("night_review_config").select("*").limit(1).maybeSingle();
  if (!cfg?.enabled) return json({ skipped: "panel disabled" });
  if (!cfg?.allow_fixes) return json({ skipped: "allow_fixes is off" });

  // Pick the finding: the one asked for, or the oldest small one not yet drafted.
  let finding;
  if (finding_id) {
    ({ data: finding } = await admin.from("panel_findings").select("*").eq("id", finding_id).maybeSingle());
  } else {
    const { data: rows } = await admin.from("panel_findings")
      .select("*").eq("status", "new").eq("effort", "small")
      .order("created_at", { ascending: true }).limit(8);
    for (const f of rows || []) {
      const { count } = await admin.from("panel_proposals")
        .select("id", { count: "exact", head: true }).eq("finding_id", f.id);
      if (!count) { finding = f; break; }
    }
  }
  if (!finding) return json({ ok: true, drafted: 0, reason: "no small finding without a proposal" });

  // Only files the finding itself names. It does not get to go looking.
  const named = [...new Set(
    `${finding.title} ${finding.evidence} ${finding.why_it_matters}`
      .match(/\b(?:src|supabase)\/[A-Za-z0-9_\-/.]+\.(?:jsx?|ts|css)\b/g) || [])];
  const usable = named.filter((p) => !forbidden(p));
  if (!usable.length) {
    return json({ ok: true, drafted: 0, reason: "the finding names no editable file", named });
  }

  const files: Record<string, string> = {};
  const ghToken = Deno.env.get("GITHUB_TOKEN") || "";
  for (const p of usable.slice(0, 3)) {
    const content = await ghFile(p, ghToken);
    if (content && content.length < 120000) files[p] = content;
  }
  if (!Object.keys(files).length) return json({ ok: true, drafted: 0, reason: "could not read the named files" });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      system: [
        "You are making ONE small change to a live real-estate brokerage tool used by working agents.",
        "",
        "Return the COMPLETE new content of each file you change. Not a diff, not a snippet.",
        "Change as little as possible: the smallest edit that addresses the finding, and nothing",
        "else. No tidying, no renaming, no reformatting of code you did not have to touch —",
        "a diff full of unrelated churn cannot be reviewed, and this one will be reviewed.",
        "",
        "SPECIFICALLY, on the first real draft this prompt produced a good 13-line change and",
        "ALSO silently rewrote an emoji to an HTML entity on a line it had no reason to touch.",
        "Do not do that. Leave every character you were not asked to change exactly as it is,",
        "including emoji, quotes, dashes and whitespace. If a line does not need to change to",
        "address the finding, it does not change.",
        "",
        "Do not invent CSS class names. If your change needs a style that does not already",
        "exist in the file or in index.css, use an inline style instead — a class nobody",
        "defined renders as nothing, which is a silent failure and this codebase has a rule",
        "about those.",
        "",
        "House rules that are not optional here:",
        "- Comments explain WHY, never what. Assume the reader can read code.",
        "- Layouts must survive 135% system font: flex rows carrying a title plus a control",
        "  need flex 1 1 0, minWidth 0 and wrapping.",
        "- Never write a \\\\uXXXX escape inside JSX text; it renders literally.",
        "- supabase-js does not throw on a failed write. Check `error` on every mutating call.",
        "- Every tappable control should be at least 44px.",
        "",
        "If the finding cannot be fixed by editing these files — if it needs a migration, a new",
        "table, a product decision, or a conversation — say so and change NOTHING. Refusing is a",
        "valid and useful answer, and a plausible-looking wrong patch costs more than no patch.",
        "",
        "Return ONLY JSON, no prose before or after:",
        '{"can_fix": true|false,',
        ' "why_not": "<if can_fix is false>",',
        ' "summary": "<one line, what changes>",',
        ' "rationale": "<2-4 sentences: why this edit, and what you deliberately did NOT touch>",',
        ' "files": [{"path": "...", "content": "<the complete new file>"}]}',
      ].join("\n"),
      messages: [{
        role: "user", content:
          `FINDING (${finding.agent}, effort ${finding.effort}):\n${finding.title}\n\n` +
          `EVIDENCE:\n${finding.evidence}\n\nWHY IT MATTERS:\n${finding.why_it_matters}\n\n` +
          Object.entries(files).map(([p, c]) => `=== ${p} ===\n${c}`).join("\n\n"),
      }],
    }),
  });

  const j = await res.json();
  const text = (j?.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  // Extract the JSON rather than assume the whole reply is JSON — asked for a
  // structured answer, the model sometimes narrates first, and a strict parse
  // threw away a whole night's council once already.
  let parsed: any = null;
  const start = text.indexOf("{");
  if (start >= 0) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') inStr = !inStr;
      if (inStr) continue;
      if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try { parsed = JSON.parse(text.slice(start, i + 1)); } catch (_) {}
        break;
      }
    }
  }
  if (!parsed) return json({ error: "could not parse the draft", head: text.slice(0, 200) }, 502);

  const inTok = j?.usage?.input_tokens || 0, outTok = j?.usage?.output_tokens || 0;
  try {
    await admin.from("ai_usage_log").insert({
      user_id: null, fn: "panel-draft", model: "claude-sonnet-4-6",
      input_tokens: inTok, output_tokens: outTok,
      cost_usd: (inTok / 1e6) * 3 + (outTok / 1e6) * 15,
    });
  } catch (_) { /* the draft still stands */ }

  if (!parsed.can_fix) {
    // Recording a refusal matters as much as recording a patch: without it the
    // same finding is re-drafted every night at full cost, for ever.
    await admin.from("panel_findings").update({
      status: "wont_fix", decided_note: `panel-draft: ${parsed.why_not || "not fixable by editing these files"}`,
    }).eq("id", finding.id);
    return json({ ok: true, drafted: 0, refused: parsed.why_not });
  }

  const out = (parsed.files || []).filter((f: any) => f?.path && f?.content && !forbidden(f.path));
  if (!out.length) return json({ ok: true, drafted: 0, reason: "the draft touched no permitted file" });

  // Never write a proposal that changes nothing — an empty diff wastes a review.
  const changed = out.filter((f: any) => files[f.path] !== f.content);
  if (!changed.length) return json({ ok: true, drafted: 0, reason: "the draft is identical to what is there" });

  const { data: prop, error } = await admin.from("panel_proposals").insert({
    finding_id: finding.id,
    kind: finding.agent,
    summary: parsed.summary || finding.title,
    rationale: parsed.rationale || "",
    files: changed,
    autonomous_eligible: false,     // Dara approves. Always, at this autonomy level.
    gate_status: "not_run",
    status: "draft",
  }).select("id").maybeSingle();
  if (error) return json({ error: error.message }, 500);

  return json({
    ok: true, drafted: 1, proposal: prop?.id, finding: finding.id,
    summary: parsed.summary, files: changed.map((f: any) => f.path),
  });
});
