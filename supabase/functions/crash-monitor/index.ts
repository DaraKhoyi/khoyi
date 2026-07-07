// crash-monitor — watches public.client_errors, groups distinct crashes, asks
// Claude to diagnose each NEW one (likely cause + code area + suggested fix),
// records it in crash_signatures, and alerts the owner (agent_runs + push).
// It deliberately does NOT change code or deploy — it hands a fix-ready
// diagnosis to a human. Safety infra, so it is never pause-gated.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODELS = ["claude-sonnet-4-6", "claude-3-5-sonnet-20241022"];
const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

function normalize(msg: string): string {
  return String(msg || "").toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/0x[0-9a-f]+/g, "<hex>").replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ").trim().slice(0, 160);
}

async function diagnose(sig: any): Promise<any> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  const prompt = `A view in a React (single large src/App.js + lazy src/views/*.jsx) real-estate app crashed. Diagnose it for the developer.

View: ${sig.view || "(unknown)"}
Error: ${sig.message || ""}
Kind: ${sig.kind || ""}
Stack:
${(sig.stack || "(none)").slice(0, 2500)}
${sig.component_stack ? "Component stack:\n" + sig.component_stack.slice(0, 1500) : ""}

Return STRICT JSON only:
{ "cause": "one or two sentences, plain-language, what likely went wrong",
  "area": "the file/component/function most likely at fault (best guess)",
  "suggested_fix": "one or two sentences on the most likely fix direction" }`;
  for (const model of MODELS) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key!, "anthropic-version": "2023-06-01", "Content-Type": "application/json" }, body: JSON.stringify({ model, max_tokens: 500, messages: [{ role: "user", content: prompt }] }) });
      if (!r.ok) continue;
      const d = await r.json(); const t = (d.content || []).map((c: any) => c.text || "").join("");
      const m = t.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]);
    } catch (_) {}
  }
  return { cause: "", area: "", suggested_fix: "" };
}

serve(async (req) => {
  try {
    const internal = req.headers.get("x-internal-token") || "";
    if (internal !== (Deno.env.get("QCP_TOKEN") || "")) return J({ error: "unauthorized" }, 401);
    const admin = createClient(SUPABASE_URL, SERVICE);
    const body = await req.json().catch(() => ({}));
    const windowMin = Number(body.window_min) || 1440; // look back 24h by default
    const since = new Date(Date.now() - windowMin * 60000).toISOString();

    // owner(s) to alert
    const { data: owners } = await admin.from("agents").select("auth_user_id").eq("role", "owner");
    const ownerIds = (owners || []).map((o: any) => o.auth_user_id).filter(Boolean);

    const { data: errs } = await admin.from("client_errors").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(2000);
    if (!errs || !errs.length) return J({ ok: true, groups: 0, new_alerts: 0 });

    // group by signature
    const groups: Record<string, any> = {};
    for (const e of errs) {
      const signature = `${e.view || "?"}::${e.kind || "?"}::${normalize(e.message)}`;
      if (!groups[signature]) groups[signature] = { signature, view: e.view, message: e.message, kind: e.kind, count: 0, users: new Set(), versions: new Set(), first: e.created_at, last: e.created_at, sample: e };
      const g = groups[signature];
      g.count++;
      if (e.email) g.users.add(e.email);
      if (e.app_version) g.versions.add(e.app_version);
      if (e.created_at < g.first) g.first = e.created_at;
      if (e.created_at > g.last) g.last = e.created_at;
    }

    let newAlerts = 0;
    for (const sig of Object.values(groups) as any[]) {
      const { data: existing } = await admin.from("crash_signatures").select("id,status").eq("signature", sig.signature).maybeSingle();
      const row: any = {
        signature: sig.signature, view: sig.view, message: (sig.message || "").slice(0, 1000), kind: sig.kind,
        first_seen: sig.first, last_seen: sig.last, hit_count: sig.count, users_affected: sig.users.size,
        app_versions: Array.from(sig.versions), updated_at: new Date().toISOString(),
      };
      if (existing) {
        await admin.from("crash_signatures").update(row).eq("id", existing.id);
        continue; // already known — stats refreshed, no re-alert
      }
      // NEW crash — diagnose + alert
      const dx = await diagnose({ view: sig.view, message: sig.message, kind: sig.kind, stack: sig.sample.stack, component_stack: sig.sample.component_stack });
      row.ai_diagnosis = dx.cause || null; row.ai_area = dx.area || null; row.ai_suggested_fix = dx.suggested_fix || null;
      row.status = "notified"; row.notified_at = new Date().toISOString();
      const { data: ins } = await admin.from("crash_signatures").insert(row).select("id").single();
      newAlerts++;

      const who = sig.users.size ? `${sig.users.size} user${sig.users.size === 1 ? "" : "s"}` : "someone";
      const summary = `${sig.view || "A view"} is crashing for ${who}: ${(sig.message || "").slice(0, 120)}`;
      const steps = [
        { label: "What", detail: `${sig.count} hit(s), ${sig.users.size} user(s), on ${Array.from(sig.versions).join(", ") || "?"}` },
        ...(dx.cause ? [{ label: "Likely cause", detail: dx.cause }] : []),
        ...(dx.area ? [{ label: "Where", detail: dx.area }] : []),
        ...(dx.suggested_fix ? [{ label: "Suggested fix", detail: dx.suggested_fix }] : []),
      ];
      for (const uid of ownerIds) {
        try { await admin.from("agent_runs").insert({ user_id: uid, agent: "crash_monitor", target_type: "crash", target_id: ins?.id || null, status: "alert", summary, steps, output: { signature: sig.signature, ...dx } }); } catch (_) {}
      }
      // best-effort push
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/push-send`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE}` }, body: JSON.stringify({ user_id: ownerIds[0], title: "⚠️ PrismOS crash detected", body: summary, url: "https://darasapp.com" }) });
      } catch (_) {}
    }
    return J({ ok: true, groups: Object.keys(groups).length, new_alerts: newAlerts });
  } catch (e) { return J({ error: String(e) }, 500); }
});
