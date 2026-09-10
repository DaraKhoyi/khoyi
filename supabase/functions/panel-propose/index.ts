// STEP 3 and 4 — hands, in a sandbox.
//
// The panel proposes a real change on a branch, CI runs the full gate against
// it, and the result comes back for Dara to approve with one tap. Step 4 is the
// same path with the approval skipped for a narrow allowlist.
//
// WHAT MAKES THIS SAFE, AND WHY EACH PART IS HERE:
//
//   It never touches main. Every change lands on panel/<id>, and main is only
//   reached by a merge that something else authorised.
//
//   NOTHING MERGES ON A RED GATE. Not the allowlisted kinds, not with Dara's
//   approval, not ever. The gate is the floor, and this session alone has three
//   examples of me believing work had shipped when CI had rejected it.
//
//   Autonomy is a DIAL held in the database, not a constant in this file:
//     0  propose only            — Dara approves everything (start here)
//     1  auto-merge the allowlist when the gate is green
//     2  reserved; deliberately not implemented
//   allowed_kinds is data too, so widening it is a dated, visible act rather
//   than a code change nobody reviews.
//
//   A hard nightly cap. A runaway that opens three pull requests is a nuisance;
//   one that opens three hundred is an incident.
//
//   Schema, RLS, permissions, auth, money and migrations are NEVER eligible,
//   at any autonomy level. Those are the changes where being wrong is not
//   recoverable by reverting a commit.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-qcp-token",
};

const REPO = "DaraKhoyi/khoyi";
const gh = (pat: string) => ({
  Authorization: `Bearer ${pat}`, "User-Agent": "PrismOS-Panel",
  Accept: "application/vnd.github+json", "Content-Type": "application/json",
});

// Paths the panel may never edit, whatever the autonomy level. A revert undoes
// a typo; it does not undo a migration that has already run, or an RLS policy
// that was open for six hours.
const FORBIDDEN = [
  /^supabase\/migrations\//, /^\.github\//, /^smoke\//,
  /version\.js$/, /dataService\.js$/, /package(-lock)?\.json$/,
];
const forbidden = (path: string) => FORBIDDEN.some((re) => re.test(path));

async function ghJson(url: string, pat: string, init: RequestInit = {}) {
  const r = await fetch(url, { ...init, headers: { ...gh(pat), ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // INTERNAL ONLY. This function runs as service role, accepts a body and spends
  // tokens, so an unauthenticated caller who learned the URL could both drive it
  // and run up the bill. pg_cron and the app already send this header; nothing
  // else should reach it. Flagged by smoke/edge_auth.mjs, which was right.
  const qcp = req.headers.get("x-qcp-token");
  if (qcp !== Deno.env.get("QCP_TOKEN")) {
    return new Response(JSON.stringify({ error: "unauthorised" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const pat = Deno.env.get("GITHUB_PAT");
  const body = await req.json().catch(() => ({}));
  const action = body.action || "propose";

  const { data: cfg } = await admin.from("night_review_config").select("*").eq("id", true).maybeSingle();
  if (!cfg || cfg.enabled !== true) {
    return new Response(JSON.stringify({ skipped: "panel disabled" }), { headers: { ...CORS, "Content-Type": "application/json" } });
  }
  if (!pat) {
    return new Response(JSON.stringify({ error: "no repo access configured" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  try {
    // ── Open a proposal: branch, commit, and ask CI to run the gate ─────────
    if (action === "propose") {
      const { proposal_id } = body;
      const { data: pr } = await admin.from("panel_proposals").select("*").eq("id", proposal_id).maybeSingle();
      if (!pr) throw new Error("proposal not found");

      const files = (pr.files || []) as Array<{ path: string; content: string }>;
      if (!files.length) throw new Error("proposal carries no file changes");
      for (const f of files) {
        if (forbidden(f.path)) throw new Error(`path is never editable by the panel: ${f.path}`);
      }

      const main = await ghJson(`https://api.github.com/repos/${REPO}/git/ref/heads/main`, pat);
      const branch = `panel/${String(proposal_id).slice(0, 8)}`;
      await ghJson(`https://api.github.com/repos/${REPO}/git/refs`, pat, {
        method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main.object.sha }),
      }).catch(() => { /* branch may already exist from a retry */ });

      for (const f of files) {
        let sha: string | undefined;
        try {
          const cur = await ghJson(`https://api.github.com/repos/${REPO}/contents/${f.path}?ref=${branch}`, pat);
          sha = cur.sha;
        } catch (_) { /* new file */ }
        await ghJson(`https://api.github.com/repos/${REPO}/contents/${f.path}`, pat, {
          method: "PUT",
          body: JSON.stringify({
            message: `${pr.summary}\n\nProposed by the PrismOS panel. Not merged until the gate is green.`,
            content: btoa(unescape(encodeURIComponent(f.content))), branch, sha,
          }),
        });
      }

      await admin.from("panel_proposals").update({
        status: "awaiting_review", gate_status: "running",
      }).eq("id", proposal_id);

      return new Response(JSON.stringify({ ok: true, branch, files: files.length }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // ── Check the gate, then merge if allowed ───────────────────────────────
    if (action === "check" || action === "merge") {
      const { proposal_id } = body;
      const { data: pr } = await admin.from("panel_proposals").select("*").eq("id", proposal_id).maybeSingle();
      if (!pr) throw new Error("proposal not found");
      const branch = `panel/${String(proposal_id).slice(0, 8)}`;

      const runs = await ghJson(
        `https://api.github.com/repos/${REPO}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=1`, pat);
      const run = (runs.workflow_runs || [])[0];
      const gate = !run ? "not_run"
        : run.status !== "completed" ? "running"
        : run.conclusion === "success" ? "green" : "red";

      await admin.from("panel_proposals").update({
        gate_status: gate,
        gate_detail: run ? `${run.name}: ${run.status}/${run.conclusion || "-"}` : "no run found",
      }).eq("id", proposal_id);

      if (action === "check") {
        return new Response(JSON.stringify({ ok: true, gate }), { headers: { ...CORS, "Content-Type": "application/json" } });
      }

      // THE FLOOR. Nothing merges on a gate that is not green — not an
      // allowlisted typo, not with an approval attached.
      if (gate !== "green") {
        return new Response(JSON.stringify({ refused: "gate is not green", gate }),
          { status: 409, headers: { ...CORS, "Content-Type": "application/json" } });
      }

      const approvedByHuman = pr.status === "approved";
      const eligible = (cfg.autonomy_level || 0) >= 1
        && pr.autonomous_eligible === true
        && (cfg.allowed_kinds || []).includes(pr.kind);

      if (!approvedByHuman && !eligible) {
        return new Response(JSON.stringify({ refused: "needs Dara's approval", kind: pr.kind, autonomy: cfg.autonomy_level }),
          { status: 409, headers: { ...CORS, "Content-Type": "application/json" } });
      }

      if (!approvedByHuman) {
        // The nightly cap, counted only against merges nobody approved.
        const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
        const { count } = await admin.from("panel_proposals")
          .select("id", { count: "exact", head: true })
          .eq("status", "merged").is("decided_by", null).gte("decided_at", since);
        if ((count || 0) >= (cfg.max_autonomous_per_night || 3)) {
          return new Response(JSON.stringify({ refused: "nightly autonomous limit reached", count }),
            { status: 429, headers: { ...CORS, "Content-Type": "application/json" } });
        }
      }

      const merged = await ghJson(`https://api.github.com/repos/${REPO}/merges`, pat, {
        method: "POST",
        body: JSON.stringify({ base: "main", head: branch, commit_message: `${pr.summary} (panel${approvedByHuman ? ", approved" : ", autonomous"})` }),
      });

      await admin.from("panel_proposals").update({
        status: "merged", commit_sha: merged.sha, decided_at: new Date().toISOString(),
      }).eq("id", proposal_id);

      return new Response(JSON.stringify({ ok: true, merged: merged.sha, autonomous: !approvedByHuman }),
        { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    throw new Error("unknown action");
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
