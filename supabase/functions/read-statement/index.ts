// read-statement — reads a scanned, photographed or PDF bank / card statement
// into the HOLDING AREA. It never touches the books.
//
// Dara, 6 Oct 2026 (accounting build, part 4): "Scanned or photographed
// statements and PDFs, read by AI ... Nothing imported touches the ledger
// directly. Every line lands in a holding area first ... A scanned line the AI
// is unsure of is marked for a person. It is never auto-corrected."
//
// Input:  { import_id }   an upload started with statement_begin(..., 'scan')
//         whose file(s) are already in the private "statements" bucket.
// Output: { started: true } at once. The reading carries on after the reply
//         (a long statement takes a minute or two); the screen watches the
//         upload row for read_at / read_error.
//
// What it does:
//   1. Confirms the caller may add to those books (statement_for_reading runs
//      as the caller and refuses anyone who may not).
//   2. Sends the pages to the model with one instruction: copy what is
//      printed, flag what is unclear, change nothing.
//   3. Hands the lines to statement_stage_scan, which stages them, checks the
//      statement adds up, looks for duplicates and applies confirmed rules.
//
// WHAT LEAVES PRISMOS: the statement pages themselves. aiGuard strips account
// and card numbers from TEXT, but a page image is sent as it is, so a number
// printed on the statement is seen by the model. The model is told not to
// copy account numbers into its answer, and none are stored.

import "../_shared/aiGuard.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.4";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
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
const MAX_EDGE = 1568;                 // the model sees no more than this anyway
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    for (let j = 0; j < part.length; j++) binary += String.fromCharCode(part[j]);
  }
  return btoa(binary);
}

const MEDIA: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif",
};

async function pageBlock(buf: Uint8Array, path: string): Promise<any> {
  const ext = (path.split(".").pop() || "").toLowerCase();
  const media = MEDIA[ext];
  if (!media) throw new Error(`"${path.split("/").pop()}" is not a PDF or a photo PrismOS can read (JPG, PNG or WebP).`);
  if (media === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: media, data: bytesToBase64(buf) } };
  }
  try {
    const img = await Image.decode(buf);
    const longest = Math.max(img.width, img.height);
    if (longest > MAX_EDGE) {
      const k = MAX_EDGE / longest;
      img.resize(Math.round(img.width * k), Math.round(img.height * k));
    }
    return { type: "image", source: { type: "base64", media_type: "image/jpeg", data: bytesToBase64(await img.encodeJPEG(92)) } };
  } catch (_e) {
    return { type: "image", source: { type: "base64", media_type: media, data: bytesToBase64(buf) } };
  }
}

const SYSTEM = `You copy bank and credit-card statements into data for a bookkeeping system. You are a careful clerk, not an editor.

RULES
1. Copy every transaction line exactly once, in the order printed, across all pages. Leave out lines that are not transactions: "beginning balance", "ending balance", daily balance tables, subtotals, totals, rate tables, rewards summaries, the payment coupon.
2. Fees and interest charged ARE transactions. Include them.
3. Copy the description as printed. Do not tidy, shorten, expand or correct it. Never include a full account number or card number.
4. Dates as YYYY-MM-DD. If the line shows no year, take it from the statement period. If a line shows two dates, use the transaction date, not the posting date.
5. Amount sign, from the account holder's side: NEGATIVE when it takes money from them or adds to what they owe (purchases, withdrawals, checks, debits, fees, interest charged). POSITIVE when it adds to their money or reduces what they owe (deposits, credits, refunds, and payments made TO a credit card).
6. NEVER guess silently and NEVER repair. If any character of a date, amount or description is unclear, cut off, smudged, or you had to infer it, give your best reading and FLAG the line. If a number looks wrong but is clearly printed, copy it as printed and do not flag it. A flagged line is checked by a person; an unflagged wrong line is not.
7. Balances exactly as printed (positive numbers, as statements show them): the balance at the start of the period and at the end. For a card these are "previous balance" and "new balance". null when not printed.

ANSWER with JSON only, no prose, no code fence:
{"statement_type":"bank"|"card"|"other","period_from":"YYYY-MM-DD"|null,"period_to":"YYYY-MM-DD"|null,"opening_balance":number|null,"closing_balance":number|null,
 "lines":[["YYYY-MM-DD",-12.34,"DESCRIPTION AS PRINTED","",""], ...]}
Each line is [date, amount, description, flags, note]. flags is "" or any of the letters d (date unclear), a (amount unclear), p (description unclear). note says in a few words what was unclear, or "".
If the pages are not a bank or card statement, or cannot be read at all, answer {"error":"one plain sentence saying why"}.`;

async function readIt(admin: any, info: any, userId: string) {
  const fail = async (message: string) => {
    await admin.rpc("statement_stage_scan", { p_import: info.id, p_payload: { error: message }, p_user: userId });
  };
  try {
    const paths: string[] = Array.isArray(info.file_paths) ? info.file_paths : [];
    if (!paths.length) return await fail("The file did not finish uploading. Please upload it again.");
    const blocks: any[] = [];
    let total = 0;
    for (const p of paths) {
      const { data: file, error } = await admin.storage.from("statements").download(p);
      if (error || !file) return await fail("PrismOS could not open the file that was uploaded. Please upload it again.");
      const buf = new Uint8Array(await file.arrayBuffer());
      total += buf.length;
      if (total > MAX_TOTAL_BYTES) return await fail("That is too large to read in one go. Upload one statement at a time (about 24 MB at most).");
      blocks.push(await pageBlock(buf, p));
    }
    blocks.push({ type: "text", text: `These pages are one statement for the account the person calls "${String(info.account || "").slice(0, 80)}". Copy it out as instructed. JSON only.` });

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: 30000, temperature: 0, system: SYSTEM, messages: [{ role: "user", content: blocks }] }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      console.error("[read-statement] model error", resp.status, t.slice(0, 400));
      return await fail(resp.status === 413 || /too large|exceed|maximum/i.test(t)
        ? "That statement is too long to read in one go. Upload it a few pages at a time."
        : "The reader is not answering right now. Nothing was lost: open this upload and tap Read again.");
    }
    const data = await resp.json();
    await logAiUsage(admin, { userId, fn: "read-statement", model: MODEL, usage: data?.usage, usedOwn: false });
    if (data?.stop_reason === "max_tokens") return await fail("That statement is too long to read in one go. Upload it a few pages at a time.");
    const raw = (data?.content || []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("");
    let parsed: any;
    try {
      parsed = JSON.parse(raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim());
    } catch (_e) {
      console.error("[read-statement] unparseable answer", raw.slice(0, 300));
      return await fail("The reader's answer could not be understood. Nothing was lost: open this upload and tap Read again.");
    }
    if (parsed?.error) return await fail(String(parsed.error).slice(0, 280));
    const rows: any[] = Array.isArray(parsed?.lines) ? parsed.lines : [];
    if (!rows.length) return await fail("No transactions were found on those pages.");

    const FLAG: Record<string, string> = { d: "date", a: "amount", p: "payee" };
    const lines = rows.map((r) => {
      const a = Array.isArray(r) ? r : [r?.date, r?.amount, r?.description, r?.flags, r?.note];
      const flags = String(a[3] || "").toLowerCase().split("").map((c) => FLAG[c]).filter(Boolean);
      const note = String(a[4] || "").trim();
      // A note with no flag still means the reader hesitated.
      if (note && !flags.length) flags.push("reader");
      return { date: a[0] ?? null, amount: a[1] ?? null, text: String(a[2] ?? "").slice(0, 300), unsure: flags, note };
    });
    // A card's printed balance is money owed; the books count that as negative.
    const owed = parsed?.statement_type === "card" || (parsed?.statement_type !== "bank" && info.account_kind === "card");
    const bal = (v: any) => (typeof v === "number" && isFinite(v) ? (owed ? -v : v) : null);
    const { error: stageErr } = await admin.rpc("statement_stage_scan", {
      p_import: info.id,
      p_payload: { lines, opening_balance: bal(parsed?.opening_balance), closing_balance: bal(parsed?.closing_balance),
                   period_from: parsed?.period_from || null, period_to: parsed?.period_to || null },
      p_user: userId,
    });
    if (stageErr) {
      console.error("[read-statement] staging failed", stageErr.message);
      await fail(String(stageErr.message || "The lines could not be saved.").slice(0, 280));
    }
  } catch (e) {
    console.error("[read-statement] threw", e);
    try { await fail(String((e as any)?.message || "Something went wrong while reading.").slice(0, 280)); } catch (_) { /* the row keeps waiting; the screen offers Read again */ }
  }
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
    const { data: info, error: infoErr } = await userClient.rpc("statement_for_reading", { p_import: importId });
    if (infoErr || !info) return json({ error: infoErr?.message || "That statement is not waiting to be read" }, 403);
    if (!ANTHROPIC_API_KEY) return json({ error: "The reader is not set up" }, 500);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
    const work = readIt(admin, info, user.id);
    // deno-lint-ignore no-explicit-any
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) { rt.waitUntil(work); return json({ started: true }); }
    await work;
    return json({ started: true, finished: true });
  } catch (e) {
    return json({ error: "Internal error", message: String((e as any)?.message || e) }, 500);
  }
});
