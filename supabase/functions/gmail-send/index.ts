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

function buildRfc822({ from, to, cc, bcc, subject, bodyText, bodyHtml, headers }) {
  // Multipart/alternative when both text and html are present
  const boundary = `=_prism_${Math.random().toString(36).slice(2)}_${Date.now()}`;
  const lines = [];
  lines.push(`From: ${from}`);
  if (to.length > 0) lines.push(`To: ${to.join(", ")}`);
  if (cc.length > 0) lines.push(`Cc: ${cc.join(", ")}`);
  if (bcc.length > 0) lines.push(`Bcc: ${bcc.join(", ")}`);
  if (subject) lines.push(`Subject: ${subject}`);
  lines.push(`MIME-Version: 1.0`);
  if (headers) for (const [k, v] of Object.entries(headers)) lines.push(`${k}: ${v}`);

  if (bodyText && bodyHtml) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: text/plain; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: 7bit`);
    lines.push("");
    lines.push(bodyText);
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: text/html; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: 7bit`);
    lines.push("");
    lines.push(bodyHtml);
    lines.push(`--${boundary}--`);
  } else if (bodyHtml) {
    lines.push(`Content-Type: text/html; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: 7bit`);
    lines.push("");
    lines.push(bodyHtml);
  } else {
    lines.push(`Content-Type: text/plain; charset="UTF-8"`);
    lines.push(`Content-Transfer-Encoding: 7bit`);
    lines.push("");
    lines.push(bodyText || "");
  }
  return lines.join("\r\n");
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
    const { account_id, to, cc, bcc, subject, body_text, body_html, reply_to_message_id, in_reply_to_thread_id, from_address, from_name } = body || {};
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
    const { data: { user } } = await supabase.auth.getUser(tokenStr);
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

    const rfc822 = buildRfc822({
      from: resolvedFromName
        ? `"${resolvedFromName}" <${resolvedFromEmail}>`
        : resolvedFromEmail,
      to: arrayify(to),
      cc: arrayify(cc),
      bcc: arrayify(bcc),
      subject,
      bodyText: body_text || null,
      bodyHtml: body_html || null,
      headers: extraHeaders,
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
