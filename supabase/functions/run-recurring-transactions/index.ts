// run-recurring-transactions
//
// For the calling user, find every active recurring template whose
// next_run_date <= today, and:
//   1. Insert a real transactions row using the template fields
//   2. Advance the template's next_run_date forward by its frequency
//   3. Set last_run_date = today
//
// Returns { created: number, transactions: [..] } — the client refreshes
// its transaction list when created > 0.
//
// Idempotency: runs are guarded by next_run_date check. Calling twice on
// the same day will not double-charge, because after step 2 the
// next_run_date is in the future.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.43.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

function jsonResponse(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Add `months` calendar months to YYYY-MM-DD. Handles month-end correctly
// (e.g. Jan 31 + 1 month = Feb 28/29, not March 3).
function addMonths(ymd: string, months: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDayOfTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDayOfTarget);
  target.setUTCDate(day);
  return target.toISOString().slice(0, 10);
}

function advanceDate(ymd: string, frequency: string): string {
  if (frequency === 'monthly')   return addMonths(ymd, 1);
  if (frequency === 'quarterly') return addMonths(ymd, 3);
  if (frequency === 'yearly')    return addMonths(ymd, 12);
  return addMonths(ymd, 1);  // safe default
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ error: 'POST only' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Missing Authorization header' }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return jsonResponse({ error: 'Not authenticated' }, 401);

    const today = new Date().toISOString().slice(0, 10);

    // Find due active templates for this user. RLS guarantees only the
    // user's own rows are visible/writable.
    const { data: due, error: dueErr } = await userClient
      .from('recurring_transactions')
      .select('*')
      .eq('is_active', true)
      .lte('next_run_date', today);
    if (dueErr) return jsonResponse({ error: dueErr.message }, 500);

    const created: any[] = [];

    // Process each template. For each, we may need to fire MULTIPLE times
    // if the next_run_date is far in the past (e.g. user hadn't opened
    // the app for 3 months). The loop runs until next_run_date > today.
    // Cap at 60 iterations to prevent runaway in edge cases (a yearly
    // template missed for 60 years is plenty).
    for (const tpl of (due || [])) {
      let runDate = tpl.next_run_date;
      let iterations = 0;
      while (runDate <= today && iterations < 60) {
        const txnPayload = {
          user_id: user.id,
          date: runDate,
          amount: Number(tpl.template_amount),
          scope: tpl.template_scope,
          tax_category_id: tpl.template_tax_category_id || null,
          lead_gen_system_id: tpl.template_system_id || null,
          payee: tpl.template_payee,
          description: tpl.template_description,
          account: tpl.template_account,
          entered_via: 'recurring',
        };
        const { data: txn, error: txnErr } = await userClient
          .from('transactions').insert(txnPayload).select().single();
        if (txnErr) {
          // Don't fail the whole batch — log and continue with the next template
          console.error(`Failed to insert recurring txn for tpl ${tpl.id}:`, txnErr.message);
          break;
        }
        created.push(txn);
        runDate = advanceDate(runDate, tpl.frequency);
        iterations++;
      }

      // Persist the advanced next_run_date + last_run_date back to the template
      if (iterations > 0) {
        await userClient
          .from('recurring_transactions')
          .update({ next_run_date: runDate, last_run_date: today })
          .eq('id', tpl.id);
      }
    }

    return jsonResponse({
      created: created.length,
      transactions: created,
      checked: due?.length || 0,
    });
  } catch (e: any) {
    return jsonResponse({ error: 'Internal error', message: String(e?.message || e) }, 500);
  }
});
