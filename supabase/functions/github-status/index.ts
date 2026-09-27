// github-status — server-side GitHub/Pages health for the Systems dashboard.
// Holds the GitHub PAT as a Supabase secret (never shipped to the public frontend).
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const REPO = "DaraKhoyi/khoyi";

async function gh(path: string, pat: string) {
  return await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "KhoyiApp/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const J = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const pat = Deno.env.get("GITHUB_PAT");
    if (!pat) return J({ ok: false, error: "GITHUB_PAT not set" }, 500);

    const repoR = await gh("", pat);
    if (!repoR.ok) {
      const t = await repoR.text();
      return J({ ok: false, stage: "repo", status: repoR.status, message: t.slice(0, 200) });
    }
    const repo = await repoR.json();

    // Latest Pages build (needs pages:read; degrade gracefully if not permitted).
    let pages: Record<string, unknown> | null = null;
    try {
      const pb = await gh("/pages/builds/latest", pat);
      if (pb.ok) {
        const j = await pb.json();
        pages = { status: j.status, updated_at: j.updated_at, error: j.error?.message || null };
      } else {
        pages = { status: `http_${pb.status}` };
      }
    } catch (e) {
      pages = { status: "error", error: String(e) };
    }

    return J({
      ok: true,
      repo_full_name: repo.full_name,
      default_branch: repo.default_branch,
      pushed_at: repo.pushed_at,
      pages,
    });
  } catch (e) {
    return J({ ok: false, error: String(e) }, 500);
  }
});
