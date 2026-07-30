// Shared AI-usage logger. ONE copy, imported everywhere — so the cost model and
// the ai_usage_log write never drift across functions.
//
// Usage inside a function, right after you parse the Anthropic response:
//   import { logAiUsage } from "../_shared/aiUsage.ts";
//   const data = await resp.json();
//   await logAiUsage(supabase, { userId, fn: "plan-my-day", model: MODEL, usage: data?.usage, usedOwn });
//
// - supabase: a service-role client (createClient(...)).
// - userId:   the agent the call is billed to. If null/unknown, the row is skipped
//             (we never attribute a cost to the wrong agent).
// - usage:    the `usage` object from the Anthropic response (input_tokens,
//             output_tokens, server_tool_use.web_search_requests).
// - usedOwn:  true if the call ran on the agent's own API key (billed by Anthropic).

const AI_RATES: Record<string, [number, number]> = {
  "claude-opus-4-8": [5, 25], "claude-opus-4-7": [5, 25],
  "claude-sonnet-4-6": [3, 15], "claude-sonnet-5": [3, 15],
  "claude-haiku-4-5": [1, 5], "claude-haiku-4-5-20251001": [1, 5],
};

export async function logAiUsage(
  supabase: any,
  { userId, fn, model, usage, usedOwn }: { userId?: string | null; fn: string; model: string; usage?: any; usedOwn?: boolean },
): Promise<void> {
  try {
    if (!userId) return;                       // never mis-attribute
    const inTok = usage?.input_tokens || 0;
    const outTok = usage?.output_tokens || 0;
    const searches = usage?.server_tool_use?.web_search_requests || 0;
    const [ri, ro] = AI_RATES[model] || [3, 15];
    const cost = (inTok / 1e6) * ri + (outTok / 1e6) * ro + searches * 0.01;
    const { error } = await supabase.from("ai_usage_log").insert({
      user_id: userId, fn, model, input_tokens: inTok, output_tokens: outTok,
      web_searches: searches, cost_usd: cost, used_own_key: !!usedOwn,
    });
    if (error) console.error(`[aiUsage] ${fn} log failed:`, error.message);
  } catch (e) {
    console.error(`[aiUsage] ${fn} log threw:`, e);
  }
}
