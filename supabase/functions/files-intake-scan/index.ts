import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const MODEL = "claude-sonnet-4-6";

const DOC_TYPES = ["farbar_contract","as_is_rider","addendum","amendment","counteroffer","buyer_brokerage","agency_disclosure","seller_disclosure","lead_paint","hoa_condo","financing","loan_estimate","emd_receipt","inspection","wdo","appraisal","dd_waiver","appraisal_waiver","financing_waiver","title_commitment","closing_disclosure","cda","wire_instructions","misc"];

async function refreshToken(supabase: any, account: any) {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) return account.access_token;
  if (!account.refresh_token) throw new Error("No refresh_token");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error("Token refresh failed " + r.status);
  const t = await r.json();
  const newExp = new Date(now + ((t.expires_in || 3600) - 60) * 1000).toISOString();
  await supabase.from("email_accounts").update({ access_token: t.access_token, token_expires_at: newExp }).eq("id", account.id);
  return t.access_token;
}

function pad(b64: string) { return b64 + "=".repeat((4 - (b64.length % 4)) % 4); }
function b64FromUrl(s: string) { return pad(s.replace(/-/g, "+").replace(/_/g, "/")); }
function bytesFromB64(b64: string) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
function norm(s: string) { return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }

function matchFile(address: string | null, files: any[]) {
  if (!address) return null;
  const a = norm(address);
  const head = a.split(" ").slice(0, 3).join(" "); // street number + first words
  if (head.length < 4) return null;
  for (const f of files) {
    const fa = norm(f.address || "");
    if (!fa) continue;
    if (fa.includes(head) || a.includes(fa.split(" ").slice(0, 3).join(" "))) return f.id;
  }
  return null;
}

async function classify(bytesB64: string, mime: string, ctx: string) {
  const isPdf = (mime || "").includes("pdf");
  const docBlock = isPdf
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: bytesB64 } }
    : { type: "image", source: { type: "base64", media_type: mime || "image/jpeg", data: bytesB64 } };
  const prompt = `You classify Florida (FAR/BAR) real estate transaction documents.
Read the attached document and the email context, then return ONLY a JSON object (no prose, no code fences) with these keys:
{"doc_type": one of ${JSON.stringify(DOC_TYPES)},
"is_executed": boolean (true only if it appears signed/executed),
"address": street address string or null,
"buyer": string or null, "seller": string or null,
"price": number or null, "emd": number or null,
"effective_date": "YYYY-MM-DD" or null, "closing_date": "YYYY-MM-DD" or null,
"inspection_deadline": "YYYY-MM-DD" or null, "financing_deadline": "YYYY-MM-DD" or null, "appraisal_deadline": "YYYY-MM-DD" or null,
"waives": array subset of ["inspection","appraisal","financing"] that THIS document waives,
"confidence": number 0..1, "summary": one short sentence}
If it is not a real-estate transaction document, use doc_type "misc" with low confidence.
Email context: ${ctx}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 1024, messages: [{ role: "user", content: [docBlock, { type: "text", text: prompt }] }] }),
  });
  if (!r.ok) throw new Error("Claude " + r.status + " " + (await r.text()).slice(0, 200));
  const data = await r.json();
  let txt = (data.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
  txt = txt.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  return JSON.parse(txt);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    const uid = user.id;
    const db = createClient(SUPABASE_URL, SERVICE);

    const body = await req.json().catch(() => ({}));
    const lookbackDays = body.lookback_days || 60;
    const BATCH = Math.min(body.limit || 8, 12);

    // candidate PDF/image attachments for this user
    const { data: atts } = await db.from("email_attachments")
      .select("id,message_id,provider_attachment_id,filename,mime_type,size_bytes,created_at")
      .eq("user_id", uid)
      .or("mime_type.ilike.%pdf%,filename.ilike.%.pdf%")
      .order("created_at", { ascending: false })
      .limit(80);
    if (!atts || !atts.length) return new Response(JSON.stringify({ ok: true, scanned: 0, staged: 0, message: "No PDF attachments found." }), { headers: { ...cors, "Content-Type": "application/json" } });

    // de-dupe against already-ingested
    const { data: existing } = await db.from("file_intake").select("provider_attachment_id").eq("user_id", uid);
    const seen = new Set((existing || []).map((e: any) => e.provider_attachment_id));
    const fresh = atts.filter((a: any) => a.provider_attachment_id && !seen.has(a.provider_attachment_id)).slice(0, BATCH);
    if (!fresh.length) return new Response(JSON.stringify({ ok: true, scanned: atts.length, staged: 0, message: "Nothing new to file." }), { headers: { ...cors, "Content-Type": "application/json" } });

    // hydrate messages + accounts
    const msgIds = [...new Set(fresh.map((a: any) => a.message_id))];
    const { data: msgs } = await db.from("email_messages").select("id,provider_message_id,account_id,subject,from_address,from_name,internal_date").in("id", msgIds);
    const msgById: any = Object.fromEntries((msgs || []).map((m: any) => [m.id, m]));
    const { data: accts } = await db.from("email_accounts").select("*").eq("user_id", uid);
    const acctById: any = Object.fromEntries((accts || []).map((a: any) => [a.id, a]));
    const tokenCache: any = {};
    const { data: files } = await db.from("files").select("id,address").eq("user_id", uid);

    let staged = 0;
    for (const att of fresh) {
      try {
        const m = msgById[att.message_id];
        if (!m) continue;
        const acct = acctById[m.account_id];
        if (!acct) continue;
        if (!tokenCache[acct.id]) tokenCache[acct.id] = await refreshToken(db, acct);
        const token = tokenCache[acct.id];
        // download attachment bytes
        const aRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.provider_message_id}/attachments/${att.provider_attachment_id}`, { headers: { Authorization: `Bearer ${token}` } });
        if (!aRes.ok) throw new Error("attachment fetch " + aRes.status);
        const aJson = await aRes.json();
        const b64 = b64FromUrl(aJson.data || "");
        const bytes = bytesFromB64(b64);
        const safe = (att.filename || "document.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `${uid}/_intake/${att.id}-${safe}`;
        await db.storage.from("file-docs").upload(path, bytes, { contentType: att.mime_type || "application/pdf", upsert: true });

        // AI classify (cap size for cost/time)
        let ai: any = {}; let conf = 0; let dtype = "misc";
        const sizeOk = (att.size_bytes || bytes.length) < 8 * 1024 * 1024;
        if (sizeOk) {
          try {
            const ctx = `Subject: ${m.subject || ""} | From: ${m.from_name || ""} <${m.from_address || ""}> | File: ${att.filename || ""}`;
            ai = await classify(b64, att.mime_type || "application/pdf", ctx);
            if (ai && DOC_TYPES.includes(ai.doc_type)) dtype = ai.doc_type;
            conf = typeof ai?.confidence === "number" ? ai.confidence : 0;
          } catch (e) { ai = { error: String(e).slice(0, 200) }; }
        } else { ai = { skipped: "too_large_for_ai" }; }

        const suggestedFile = matchFile(ai?.address || null, files || []);
        await db.from("file_intake").upsert({
          user_id: uid, account_id: acct.id, email_message_id: m.id,
          provider_message_id: m.provider_message_id, provider_attachment_id: att.provider_attachment_id,
          filename: att.filename, mime: att.mime_type, size_bytes: att.size_bytes, storage_path: path,
          email_subject: m.subject, email_from: m.from_address, email_date: m.internal_date,
          status: "pending", suggested_doc_type: dtype, suggested_file_id: suggestedFile,
          confidence: conf, ai: ai || {}, updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,provider_attachment_id" });
        staged++;
      } catch (e) {
        await db.from("file_intake").upsert({
          user_id: uid, provider_attachment_id: att.provider_attachment_id, filename: att.filename,
          mime: att.mime_type, size_bytes: att.size_bytes, status: "error", error: String(e).slice(0, 300),
          updated_at: new Date().toISOString(),
        }, { onConflict: "user_id,provider_attachment_id" });
      }
    }

    return new Response(JSON.stringify({ ok: true, scanned: atts.length, staged }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
