// google-token-seal — encrypt (or decrypt) the Google tokens already stored in
// email_accounts. Service role only. Answers with counts, never with a token.
//
// Body: { "mode": "status" | "seal" | "unseal", "dry_run"?: boolean }
//   status  (default) how many access/refresh tokens are sealed vs plain.
//   seal    every plain token becomes "enc:v1:..." (needs GOOGLE_TOKEN_KEY).
//           Each value is opened again and compared before it is written.
//   unseal  every sealed token goes back to plain text (the rollback).
// Every write is a compare-and-swap (public.google_token_swap), so a token a
// sync or a reconnect changed mid-run is left alone and counted as "skipped";
// run it again and it picks those up.
//
// ROLLOUT (after the PR is merged and deployed; each step only with Dara's yes)
//   1. Generate a key on Dara's machine and set it, without printing it:
//        openssl rand -base64 32 | tr -d '\n' > /tmp/gtk && \
//        npx supabase secrets set GOOGLE_TOKEN_KEY="$(cat /tmp/gtk)" --project-ref xlgfspnojjgvkuitcoaf && \
//        (store /tmp/gtk in the password manager) && rm /tmp/gtk
//      From now on new and refreshed tokens are written sealed; every function
//      reads both forms.
//   2. curl -X POST .../functions/v1/google-token-seal -H "Authorization: Bearer $SERVICE_KEY" \
//        -d '{"mode":"seal","dry_run":true}'   → then without dry_run.
//   3. {"mode":"status"} should say plain_access = 0 and plain_refresh = 0.
//      Watch one gmail-push, calendar-poll and google-connection-watch run.
//
// ROLLBACK (in this order, never the other way round)
//   1. {"mode":"unseal"} until status says sealed_access = 0 and sealed_refresh = 0.
//   2. npx supabase secrets unset GOOGLE_TOKEN_KEY  (new writes are plain again).
//   3. Only then may the code be reverted. Old code reading a sealed token
//      would send ciphertext to Google.
//   Losing the key while rows are sealed means every Google account must be
//   reconnected. Keep the key in the password manager.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/serviceCaller.ts";
import { isSealed, openToken, sealToken, sealingEnabled, TOKEN_FIELDS } from "../_shared/googleTokens.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await isServiceCaller(req))) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const mode = String(body.mode || "status");
  const dryRun = body.dry_run === true;
  if (!["status", "seal", "unseal"].includes(mode)) return json({ error: "mode must be status, seal or unseal" }, 400);
  if (mode !== "status" && !(await sealingEnabled())) {
    return json({ error: "GOOGLE_TOKEN_KEY is not set; nothing changed" }, 400);
  }

  // A RAW client on purpose (no withTokenCrypto): this function must see what is stored.
  const raw = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const counts = { rows: 0, sealed_access: 0, sealed_refresh: 0, plain_access: 0, plain_refresh: 0, changed: 0, skipped: 0, failed: 0 };
  const failures: string[] = [];

  for (let from = 0; ; from += 500) {
    const { data, error } = await raw.from("email_accounts")
      .select("id, access_token, refresh_token").order("id").range(from, from + 499);
    if (error) return json({ error: "could not read email_accounts: " + error.message, ...counts }, 500);
    for (const row of data || []) {
      counts.rows++;
      for (const field of TOKEN_FIELDS) {
        const v = row[field] as string | null;
        if (v == null || v === "") continue;
        const sealed = isSealed(v);
        const short = field === "access_token" ? "access" : "refresh";
        if (sealed) (counts as Record<string, number>)[`sealed_${short}`]++;
        else (counts as Record<string, number>)[`plain_${short}`]++;
        if (mode === "status" || (mode === "seal" && sealed) || (mode === "unseal" && !sealed)) continue;
        try {
          let next: string;
          if (mode === "seal") {
            next = (await sealToken(v, field)) as string;
            if ((await openToken(next, field)) !== v) throw new Error("round-trip mismatch");
          } else {
            next = (await openToken(v, field)) as string;
          }
          if (dryRun) { counts.changed++; continue; }
          const { data: swapped, error: sErr } = await raw.rpc("google_token_swap", { p_id: row.id, p_field: field, p_old: v, p_new: next });
          if (sErr) throw new Error(sErr.message);
          if (swapped) counts.changed++; else counts.skipped++;
        } catch (e) {
          counts.failed++;
          failures.push(`${row.id} ${field}: ${String((e as Error).message || e).slice(0, 120)}`);
        }
      }
    }
    if (!data || data.length < 500) break;
  }

  return json({ ok: counts.failed === 0, mode, dry_run: dryRun, ...counts, failures: failures.slice(0, 20) });
});
