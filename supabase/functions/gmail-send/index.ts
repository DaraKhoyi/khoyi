// gmail-send
// Sends an email through the user's connected Gmail account.
//
// Body: {
//   account_id: uuid,
//   to: string | string[],
//   cc?: string | string[],
//   bcc?: string | string[],
//   subject: string,
//   body_text?: string,
//   body_html?: string,
//   reply_to_message_id?: string,   // gmail message id (provider id) for threading
//   in_reply_to_thread_id?: string  // gmail thread id
// }
//
// Returns: { ok: true, provider_message_id, provider_thread_id }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Token refresh failed: ${r.status} ${t.slice(0, 300)}`);
  }
  const tokens = await r.json();
  const newExp = new Date(now + ((tokens.expires_in || 3600) - 60) * 1000).toISOString();
  await supabase
    .from("email_accounts")
    .update({ access_token: tokens.access_token, token_expires_at: newExp })
    .eq("id", account.id);
  return tokens.access_token;
}

function arrayify(v) {
  if (!v) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v].filter(Boolean);
}

function buildBodyPart({ bodyText, bodyHtml }) {
  const b = `=_alt_${Math.random().toString(36).slice(2)}`;
  const L = [];
  if (bodyText && bodyHtml) {
    L.push(`Content-Type: multipart/alternative; boundary="${b}"`, "",
      `--${b}`, `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: 7bit`, "", bodyText,
      `--${b}`, `Content-Type: text/html; charset="UTF-8"`, `Content-Transfer-Encoding: 7bit`, "", bodyHtml,
      `--${b}--`);
  } else if (bodyHtml) {
    L.push(`Content-Type: text/html; charset="UTF-8"`, `Content-Transfer-Encoding: 7bit`, "", bodyHtml);
  } else {
    L.push(`Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: 7bit`, "", bodyText || "");
  }
  return L.join("\r\n");
}

function buildRfc822({ from, to, cc, bcc, subject, bodyText, bodyHtml, headers, attachments }) {
  const head = [];
  head.push(`From: ${from}`);
  if (to.length > 0) head.push(`To: ${to.join(", ")}`);
  if (cc.length > 0) head.push(`Cc: ${cc.join(", ")}`);
  if (bcc.length > 0) head.push(`Bcc: ${bcc.join(", ")}`);
  if (subject) head.push(`Subject: ${subject}`);
  head.push(`MIME-Version: 1.0`);
  if (headers) for (const [k, v] of Object.entries(headers)) head.push(`${k}: ${v}`);

  const atts = Array.isArray(attachments) ? attachments.filter((a) => a && a.content_base64) : [];
  if (atts.length === 0) {
    return head.join("\r\n") + "\r\n" + buildBodyPart({ bodyText, bodyHtml });
  }
  const mixed = `=_mixed_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const out = [...head];
  out.push(`Content-Type: multipart/mixed; boundary="${mixed}"`, "", `--${mixed}`, buildBodyPart({ bodyText, bodyHtml }));
  for (const a of atts) {
    const fn = String(a.filename || "attachment").replace(/"/g, "");
    const mime = a.mime_type || "application/octet-stream";
    const b64 = String(a.content_base64).replace(/\s+/g, "").replace(/.{76}/g, (m) => m + "\r\n");
    out.push(`--${mixed}`, `Content-Type: ${mime}; name="${fn}"`, `Content-Transfer-Encoding: base64`, `Content-Disposition: attachment; filename="${fn}"`, "", b64);
  }
  out.push(`--${mixed}--`);
  return out.join("\r\n");
}

function toBase64Url(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { account_id, to, cc, bcc, subject, body_text, body_html, reply_to_message_id, in_reply_to_thread_id, from_address, from_name, attachments, track, contact_id, variant, batch_id } = body || {};
    if (!account_id || !to || !subject) {
      return new Response(
        JSON.stringify({ error: "Missing account_id, to, or subject" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL"),
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
    );

    // Authenticate the caller
    const authHeader = req.headers.get("Authorization") || "";
    const tokenStr = authHeader.replace("Bearer ", "");
    let user = (await supabase.auth.getUser(tokenStr)).data.user;

    // Internal (function-to-function / cron) calls.
    //
    // This used to rest ENTIRELY on `tokenStr === SUPABASE_SERVICE_ROLE_KEY`.
    // That string comparison is not stable on this project: two service
    // credential formats are live (the legacy JWT and an sb_secret key), and
    // which one a caller presents depends on which the platform injected into
    // THAT function. When they differ the compare silently fails and the caller
    // is told "Not authenticated" — which is what Dara saw trying to reply to
    // Marge, and what silently broke four functions before that.
    //
    // A shared internal token removes the guesswork: it either matches or it
    // does not, and it does not care what shape anyone's service key is.
    // Identity still comes from body.user_id and is still verified below — the
    // account must belong to that user or the send is refused.
    const qcp = Deno.env.get("QCP_TOKEN") || "";
    const internal =
      (qcp && (req.headers.get("x-qcp-token") || "") === qcp) ||
      (tokenStr && tokenStr === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
    if (!user && internal && body && body.user_id) {
      user = { id: body.user_id };   // trusted internal call (cron delivery)
    }
    if (!user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load the account, ensure it belongs to the user
    const { data: account } = await supabase
      .from("email_accounts")
      .select("*")
      .eq("id", account_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!account) {
      return new Response(JSON.stringify({ error: "Account not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshAccessTokenIfNeeded(supabase, account);

    // Resolve the From address. If the caller specified one, it must be a
    // verified alias for this user (mirrors Gmail's own server-side check
    // but gives us a friendly error before we round-trip).
    let resolvedFromEmail = account.email_address;
    let resolvedFromName = account.display_name;
    if (from_address) {
      const cleanFrom = String(from_address).trim().toLowerCase();
      const { data: alias } = await supabase
        .from("email_aliases")
        .select("*")
        .eq("user_id", user.id)
        .eq("email_address", cleanFrom)
        .maybeSingle();
      if (!alias) {
        return new Response(JSON.stringify({
          error: "Unknown sender address",
          details: `${cleanFrom} is not configured as a send-as alias on this account. Sync aliases in Settings → Email.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (!alias.verified) {
        return new Response(JSON.stringify({
          error: "Sender address not verified",
          details: `${cleanFrom} is configured but not verified in Gmail. Verify it in Gmail Settings → Accounts → Send mail as.`,
        }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      resolvedFromEmail = alias.email_address;
      resolvedFromName = from_name || alias.display_name || account.display_name;
    }

    // Optionally fetch the message we're replying to in order to include In-Reply-To / References
    let extraHeaders = null;
    if (reply_to_message_id) {
      try {
        const r = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${reply_to_message_id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (r.ok) {
          const j = await r.json();
          const hh = (j.payload && j.payload.headers) || [];
          const messageId = (hh.find((h) => h.name && h.name.toLowerCase() === "message-id") || {}).value;
          const refs = (hh.find((h) => h.name && h.name.toLowerCase() === "references") || {}).value;
          if (messageId) {
            extraHeaders = {
              "In-Reply-To": messageId,
              References: refs ? `${refs} ${messageId}` : messageId,
            };
          }
        }
      } catch { /* non-fatal */ }
    }

    // --- Open tracking (opt-in) ------------------------------------------
    // Only when track === true. Adds an invisible pixel to an HTML part and
    // records a tracking row. Never blocks the send.
    let trackedBodyHtml = body_html || null;
    if (track) {
      const token = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "").slice(0, 40);
      const base = Deno.env.get("TRACK_BASE_URL") || `${Deno.env.get("SUPABASE_URL")}/functions/v1/track-open`;
      const pixelTag = `<img src="${base}?t=${token}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;max-height:1px;overflow:hidden;">`;
      let html = trackedBodyHtml;
      if (!html) {
        const esc = String(body_text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
        html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f1f1f;">${esc}</div>`;
      }
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, pixelTag + "</body>") : (html + pixelTag);
      trackedBodyHtml = html;
      try {
        await supabase.from("email_tracking").insert({
          user_id: user.id, token, account_id,
          contact_id: contact_id || null,
          to_address: Array.isArray(to) ? to[0] : to,
          subject, variant: variant || null, batch_id: batch_id || null,
          sent_at: new Date().toISOString(), status: "sent",
        });
      } catch (_e) { /* tracking is best-effort — never fail the send */ }
    }

    const rfc822 = buildRfc822({
      from: resolvedFromName
        ? `"${resolvedFromName}" <${resolvedFromEmail}>`
        : resolvedFromEmail,
      to: arrayify(to),
      cc: arrayify(cc),
      bcc: arrayify(bcc),
      subject,
      bodyText: body_text || null,
      bodyHtml: trackedBodyHtml,
      headers: extraHeaders,
      attachments,
    });

    const payload = { raw: toBase64Url(rfc822) };
    if (in_reply_to_thread_id) payload.threadId = in_reply_to_thread_id;

    const sendResp = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!sendResp.ok) {
      const t = await sendResp.text();
      return new Response(
        JSON.stringify({ error: "Gmail send failed", details: t.slice(0, 600) }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const sent = await sendResp.json();

    // The sent message will be picked up on the next gmail-sync run, so we don't
    // need to insert it here. (Could insert eagerly if we want it to appear instantly.)

    return new Response(
      JSON.stringify({
        ok: true,
        provider_message_id: sent.id,
        provider_thread_id: sent.threadId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
