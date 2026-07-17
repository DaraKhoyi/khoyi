// propose-patch — given a crash + a slice of the offending code, returns a
// minimal, surgical patch (exact old_str -> new_str). Keeps the Anthropic key
// server-side so the CI auto-fix job never needs it. Internal-token guarded.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, x-internal-token", "Access-Control-Allow-Methods": "POST, OPTIONS" };
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
  // Auth: accept EITHER the shared internal token or propose-patch's own AUTOFIX_TOKEN.
  // Why two: the GitHub Actions runner needs a token it can hold, but QCP_TOKEN is
  // shared by 14 edge functions (and by cron callers that may carry it literally), so
  // rotating or exporting it to CI would risk breaking all of them. AUTOFIX_TOKEN is a
  // dedicated credential scoped to this one endpoint — blast radius of one.
  // Constant-time-ish compare and a non-empty guard: if BOTH secrets were unset, an
  // empty header would otherwise match "" and leave this endpoint wide open.
  const presented = req.headers.get("x-internal-token") || "";
  const accepted = [Deno.env.get("QCP_TOKEN") || "", Deno.env.get("AUTOFIX_TOKEN") || ""].filter((t) => t.length > 0);
  if (!presented || !accepted.some((t) => t === presented)) return J({ error: "unauthorized" }, 401);
  const b = await req.json().catch(() => ({}));
  const prompt = `You are fixing a crash in a React app. Produce a MINIMAL, surgical patch.

File: ${b.file}
Error: ${b.message || ""}
Likely cause: ${b.diagnosis || ""}
Stack:
${(b.stack || "").slice(0, 1500)}

Relevant code (with line numbers):
${(b.code_slice || "").slice(0, 12000)}

Return STRICT JSON only:
{ "old_str": "an EXACT, unique substring copied verbatim from the code above (NO line-number prefixes), long enough to be unique",
  "new_str": "the replacement",
  "explanation": "one or two sentences on what you changed and why",
  "confidence": "high" | "medium" | "low" }
Rules: change as little as possible; old_str must appear EXACTLY ONCE in the file; do not reformat unrelated code; if you cannot produce a safe fix, set old_str to "".`;
  for (const model of ["claude-sonnet-4-6", "claude-3-5-sonnet-20241022"]) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }) });
      if (!r.ok) continue;
      const d = await r.json(); const t = (d.content || []).map((c: any) => c.text || "").join("");
      const m = t.match(/\{[\s\S]*\}/); if (m) return J(JSON.parse(m[0]));
    } catch (_) {}
  }
  return J({ old_str: "", explanation: "model unavailable", confidence: "low" });
});
