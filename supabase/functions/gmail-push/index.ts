// gmail-push — public webhook that Google Pub/Sub calls when Gmail pushes a
// change notification. On a valid notification it triggers an immediate
// incremental sync for the affected account. Always acks 200 on a valid caller
// so Pub/Sub doesn't retry-storm.
//
// AUTH (changed 7 Oct 2026). Until now the only check was a ?token= in the URL.
// Supabase writes every request URL into the edge logs, so that secret sat in
// ~1,150 log lines a day. Pub/Sub CAN prove who it is: an authenticated push
// subscription sends a Google-signed OIDC JWT in the Authorization header.
//   1. OIDC (preferred): signature checked against Google's public keys,
//      issuer = accounts.google.com, audience = GMAIL_PUSH_AUDIENCE (default:
//      this function's URL), email = GMAIL_PUSH_SA_EMAIL and email_verified.
//      The email check is what makes it ours: anyone can get Google to sign a
//      token for any audience, but only our project can sign as our account.
//   2. Legacy ?token= : still accepted during the cutover so not one
//      notification is refused. Turn it off with GMAIL_PUSH_ALLOW_URL_TOKEN=false,
//      then delete PUSH_VERIFY_TOKEN.
// Each request logs which door it came through, so the cutover is measurable.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createRemoteJWKSet, jwtVerify } from "npm:jose@5.9.6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function safeEqual(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  if (x.length !== y.length || x.length === 0) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function authorize(req: Request, url: URL): Promise<"oidc" | "url-token" | null> {
  const sa = (Deno.env.get("GMAIL_PUSH_SA_EMAIL") || "").trim().toLowerCase();
  const audience = Deno.env.get("GMAIL_PUSH_AUDIENCE") || `${SUPABASE_URL}/functions/v1/gmail-push`;
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (bearer && sa) {
    try {
      const { payload } = await jwtVerify(bearer, GOOGLE_JWKS, {
        issuer: ["https://accounts.google.com", "accounts.google.com"],
        audience,
      });
      if (String(payload.email || "").toLowerCase() === sa && payload.email_verified === true) return "oidc";
      console.warn("gmail-push: OIDC token valid but not from the expected service account");
    } catch (e) {
      console.warn("gmail-push: OIDC token rejected:", String((e as Error)?.message || e).slice(0, 120));
    }
  }
  const allowUrlToken = (Deno.env.get("GMAIL_PUSH_ALLOW_URL_TOKEN") || "true").toLowerCase() !== "false";
  const legacy = Deno.env.get("PUSH_VERIFY_TOKEN") || "";
  if (allowUrlToken && legacy && safeEqual(url.searchParams.get("token") || "", legacy)) return "url-token";
  return null;
}

serve(async (req) => {
  const url = new URL(req.url);
  const via = await authorize(req, url);
  if (!via) {
    console.warn("gmail-push: refused (no valid OIDC token or URL token)");
    return new Response("forbidden", { status: 401 });
  }
  console.log(`gmail-push auth=${via}`);
  try {
    const body = await req.json().catch(() => ({}));
    const dataB64 = body?.message?.data;
    if (dataB64) {
      const decoded = JSON.parse(atob(dataB64));
      const email = (decoded.emailAddress || "").toLowerCase();
      if (email) {
        const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));
        const { data: acct } = await supabase.from("email_accounts")
          .select("id").eq("email_address", email).eq("is_active", true).maybeSingle();
        if (acct) {
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/gmail-sync`, {
            method: "POST",
            headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
            body: JSON.stringify({ account_id: acct.id }),
          });
        }
      }
    }
  } catch (_) { /* swallow — always ack */ }
  return new Response("ok", { status: 200 });
});
