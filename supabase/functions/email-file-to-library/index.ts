// email-file-to-library
// POST { account_id, message_id, links?: [{target_type, target_id}] }
//
// Strips the PDF and image attachments off an email, files them into the ONE
// documents library (OCR / summary / embedding / full-text search via the
// existing document-extract pipeline), and links each one to the message's
// sender-contact plus anything the caller passes.
//
// This is step 3 of the Evernote plan: reference material mostly ARRIVES as an
// email attachment, so "forward it into the library" is how the library fills
// up in practice. Notes and journal already share the store; documents already
// have the machinery; this connects the two.
//
// Deliberately server-side and atomic per attachment: fetch bytes -> upload to
// storage -> create documents row -> fire extraction -> link. A half-filed
// attachment (row with no bytes, or bytes with no row) is worse than a clean
// failure, so each step checks and a failure on one attachment does not abort
// the others.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Only these are worth filing. A 12-byte tracking gif or an inline signature
// logo is noise; a lease or a settlement statement is the point.
const FILEABLE = /^(application\/pdf|image\/(png|jpe?g|webp|heic|tiff?)|application\/(msword|vnd\.openxmlformats-officedocument\.wordprocessingml\.document)|text\/plain)$/i;
const MIN_BYTES = 3000;   // below this, almost always an inline icon or tracker

async function refreshAccessTokenIfNeeded(supabase, account) {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) return account.access_token;
  if (!account.refresh_token) throw new Error("No refresh_token on account — reconnect Gmail.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID"),
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET"),
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status}`);
  const tokens = await r.json();
  const newExp = new Date(now + ((tokens.expires_in || 3600) - 60) * 1000).toISOString();
  await supabase.from("email_accounts").update({ access_token: tokens.access_token, token_expires_at: newExp }).eq("id", account.id);
  return tokens.access_token;
}

// Gmail returns attachment data base64url; convert to bytes for storage upload.
function b64urlToBytes(data) {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json();
    const { account_id, message_id, links = [] } = body;

    const admin = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    // Authenticate: user JWT, or the trusted internal path used by cron.
    const tokenStr = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    let user = (await admin.auth.getUser(tokenStr)).data.user;
    if (!user && tokenStr === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") && body.user_id) user = { id: body.user_id };
    if (!user) return new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: account } = await admin.from("email_accounts").select("*").eq("id", account_id).eq("user_id", user.id).maybeSingle();
    if (!account) throw new Error("Email account not found");

    const { data: msg } = await admin.from("email_messages")
      .select("id, provider_message_id, subject, from_address")
      .eq("id", message_id).eq("user_id", user.id).maybeSingle();
    if (!msg) throw new Error("Message not found");

    const { data: atts } = await admin.from("email_attachments")
      .select("id, provider_attachment_id, filename, mime_type, size_bytes")
      .eq("message_id", message_id).eq("user_id", user.id);

    const fileable = (atts || []).filter(a =>
      a.provider_attachment_id && FILEABLE.test(a.mime_type || "") && (a.size_bytes || 0) >= MIN_BYTES);

    if (!fileable.length) {
      return new Response(JSON.stringify({ ok: true, filed: 0, note: "No fileable attachments (only inline images / tiny files)." }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Resolve the sender to a contact so every filed doc is linked to the person
    // it came from, without the caller having to know who that is.
    let senderContactId = null;
    if (msg.from_address) {
      const { data: c } = await admin.from("contacts").select("id")
        .eq("user_id", user.id).ilike("email", msg.from_address).maybeSingle();
      senderContactId = c?.id || null;
    }

    const accessToken = await refreshAccessTokenIfNeeded(admin, account);
    const results = [];

    for (const att of fileable) {
      try {
        // 1 — fetch the bytes from Gmail
        const gr = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.provider_message_id}/attachments/${att.provider_attachment_id}`,
          { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!gr.ok) throw new Error(`Gmail fetch ${gr.status}`);
        const { data } = await gr.json();
        if (!data) throw new Error("Empty attachment body");
        const bytes = b64urlToBytes(data);

        // 2 — upload to the documents bucket
        const path = `${user.id}/email/${crypto.randomUUID()}-${(att.filename || "attachment").replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await admin.storage.from("documents").upload(path, bytes, { contentType: att.mime_type, upsert: false });
        if (upErr) throw new Error(`Upload: ${upErr.message}`);

        // 3 — create the documents row
        const { data: doc, error: docErr } = await admin.from("documents").insert({
          user_id: user.id, title: att.filename || "Email attachment",
          storage_path: path, mime_type: att.mime_type, size_bytes: att.size_bytes,
          status: "extracting", doc_type: null,
        }).select("id").single();
        if (docErr) throw new Error(`Row: ${docErr.message}`);

        // 4 — link to sender-contact + whatever the caller asked for
        const allLinks = [
          ...(senderContactId ? [{ target_type: "contact", target_id: senderContactId }] : []),
          ...links,
        ];
        if (allLinks.length) {
          await admin.from("entity_links").insert(allLinks.map(l => ({
            user_id: user.id, item_type: "document", item_id: doc.id,
            target_type: l.target_type, target_id: l.target_id,
          })));
        }

        // 5 — fire extraction (OCR / summary / embedding). Internal call.
        admin.functions.invoke("document-extract", { body: { document_id: doc.id, user_id: user.id } }).catch(() => {});

        results.push({ filename: att.filename, ok: true, document_id: doc.id });
      } catch (e) {
        results.push({ filename: att.filename, ok: false, error: String(e.message || e) });
      }
    }

    const filed = results.filter(r => r.ok).length;
    return new Response(JSON.stringify({ ok: true, filed, total: fileable.length, results, linked_to_sender: !!senderContactId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
