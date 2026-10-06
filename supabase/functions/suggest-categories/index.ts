// suggest-categories — proposes a category for payees nobody has decided yet.
// A PROPOSAL ONLY: it never posts and never makes a rule.
//
// Dara, 6 Oct 2026 (accounting build, part 4): "A new payee gets an AI
// suggestion and waits for the user. An AI suggestion is never posted on its
// own; only a rule a person has confirmed is."
//
// Input:  { import_id }
// Output: { started: true } at once; the screen watches the upload's
//         suggested_at. The suggestions land on the waiting lines marked
//         proposed_by 'ai', which the database treats as "nobody has decided".
//
// What the model is shown: the cleaned payee name, the bank's text for one
// such line (aiGuard strips any account or card number from it), whether money
// came in or went out, a typical amount, and this set of books' category
// names. No balances, no account names, no people.

import "../_shared/aiGuard.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import { logAiUsage } from "../_shared/aiUsage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "claude-sonnet-4-6";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function suggest(admin: any, importId: string, ctx: any, userId: string) {
  let items: any[] = [];
  try {
    const payees: any[] = ctx?.payees || [];
    const cats: any[] = ctx?.categories || [];
    if (payees.length && cats.length && ANTHROPIC_API_KEY) {
      const catList = cats.map((c, i) => `${i + 1}. ${c.name} [${c.kind}]${c.about ? " — " + String(c.about).slice(0, 90) : ""}`).join("\n");
      const payeeList = payees.map((p, i) =>
        `${i + 1}. ${p.payee || p.key} | bank text: ${String(p.text || "").slice(0, 90)} | ${p.money_in ? "money IN" : "money OUT"} | about $${p.typical}`).join("\n");
      const system = `You help a real-estate ${ctx.personal_book ? "agent" : "brokerage or team"} in Florida file bank and card lines into their own chart of accounts.
For each payee choose the ONE category from the list that fits best, or none when you cannot tell.
- Money IN belongs in an income category, or one for money held for others or owners' contributions; money OUT in an expense category or similar. Never file money in under an expense or money out under income.
- A payee that sells many kinds of things (Amazon, Costco, Walmart, Target, Venmo, Zelle, PayPal, a check) cannot be known from its name: choose none (0) with low confidence.
- confidence is 0 to 1: how sure a careful bookkeeper would be from the name alone.${ctx.personal_book ? '\n- These are one person\'s own books and hold personal spending too. When a payee is plainly personal (groceries, a streaming service, a pharmacy, a clothing shop), answer "p":true and category 0.' : ""}
ANSWER with JSON only, no prose, no code fence: [{"n":payee number,"c":category number or 0,"p":true|false,"conf":0.0}]`;
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: MODEL, max_tokens: 12000, temperature: 0, system,
          messages: [{ role: "user", content: `CATEGORIES\n${catList}\n\nPAYEES\n${payeeList}\n\nJSON only.` }] }),
      });
      if (resp.ok) {
        const data = await resp.json();
        await logAiUsage(admin, { userId, fn: "suggest-categories", model: MODEL, usage: data?.usage, usedOwn: false });
        const raw = (data?.content || []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("");
        try {
          const arr = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim());
          if (Array.isArray(arr)) {
            items = arr.map((a) => {
              const p = payees[Number(a?.n) - 1];
              const c = cats[Number(a?.c) - 1];
              if (!p) return null;
              const personal = !!ctx.personal_book && a?.p === true;
              if (!c && !personal) return null;
              return { key: p.key, category_id: personal ? null : c.id, personal, confidence: Number(a?.conf) || 0.5 };
            }).filter(Boolean);
          }
        } catch (_e) { console.error("[suggest-categories] unparseable answer", raw.slice(0, 300)); }
      } else {
        console.error("[suggest-categories] model error", resp.status, (await resp.text()).slice(0, 300));
      }
    }
  } catch (e) {
    console.error("[suggest-categories] threw", e);
  }
  // Always report back, even with nothing: it marks the upload as asked, so the
  // screen stops waiting. No suggestion is a fine answer.
  const { error } = await admin.rpc("statement_ai_propose", { p_import: importId, p_items: items });
  if (error) console.error("[suggest-categories] could not save", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing Authorization header" }, 401);
    const body = await req.json();
    const importId = String(body?.import_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(importId)) return json({ error: "import_id required" }, 400);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: "Not authenticated" }, 401);

    // Runs as the caller: refuses anyone who may not add to those books.
    const { data: ctx, error: ctxErr } = await userClient.rpc("statement_ai_context", { p_import: importId });
    if (ctxErr || !ctx) return json({ error: ctxErr?.message || "not allowed" }, 403);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const work = suggest(admin, importId, ctx, user.id);
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) { rt.waitUntil(work); return json({ started: true, payees: (ctx.payees || []).length }); }
    await work;
    return json({ started: true, finished: true });
  } catch (e) {
    return json({ error: "Internal error", message: String((e as any)?.message || e) }, 500);
  }
});
