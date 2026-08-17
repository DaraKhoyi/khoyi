// investor-transition-send — puts the approved letters in the post.
//
// It does NOT send email itself. gmail-send already handles accounts, tokens,
// threading and logging, so this function assembles the letter and delegates.
// A second sender would be a second set of bugs.
//
// WHAT THIS ADDS AROUND THE MANAGER'S TEXT, and why it is not left to the drafter:
//   - the greeting, using the investor's first name
//   - THE TWO ANSWER BUTTONS, carrying the signed token. These are the whole point
//     of the exercise, so they are assembled here where they cannot be edited
//     away, reworded into something ambiguous, or accidentally deleted from a
//     draft. A letter that asks a question with no way to answer it is worse than
//     no letter.
//   - the brokerage sign-off. Dara's rule: the company sends this, never the
//     departing agent and never the incoming one, so the signature is not a field
//     anyone can change.
//
// Sends one at a time and records each result individually: a failure on investor
// four must not silently swallow five through twenty.
// verify_jwt: false — called with the manager's JWT, re-checked as the caller.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const BASE = "https://xlgfspnojjgvkuitcoaf.supabase.co/functions/v1/investor-transition-answer";
const BROKERAGE = "Realty ONE Group Advantage";

function letterHtml(firstName: string, bodyText: string, token: string) {
  const paras = String(bodyText || "").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p style="margin:0 0 15px;font-size:15px;line-height:1.65;color:#22201c">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const yes = `${BASE}?t=${encodeURIComponent(token)}&a=continue`;
  const no  = `${BASE}?t=${encodeURIComponent(token)}&a=remove`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4f1e9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1e9;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;background:#ffffff;border:1px solid #e2ddd0;border-radius:12px;padding:28px 26px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <tr><td>
    <div style="font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#9A7B2E;font-weight:700;margin-bottom:14px">${esc(BROKERAGE)}</div>
    <p style="margin:0 0 15px;font-size:15px;color:#22201c">${firstName ? "Hi " + esc(firstName) + "," : "Hello,"}</p>
    ${paras}
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px">
      <tr><td style="padding-bottom:10px">
        <a href="${yes}" style="display:block;background:#9A7B2E;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:10px;text-align:center">Yes — keep sending me matches</a>
      </td></tr>
      <tr><td>
        <a href="${no}" style="display:block;background:#ffffff;color:#5A554C;text-decoration:none;font-weight:600;font-size:15px;padding:14px 22px;border:1px solid #d6d2c8;border-radius:10px;text-align:center">No — take me off the list</a>
      </td></tr>
    </table>
    <p style="margin:14px 0 0;font-size:12.5px;color:#7a746a;line-height:1.55">Either answer is fine and takes effect straight away. If you would rather talk, just reply to this email.</p>
    <div style="border-top:1px solid #e2ddd0;margin-top:22px;padding-top:16px">
      <p style="margin:0;font-size:14px;color:#22201c;font-weight:700">${esc(BROKERAGE)}</p>
      <p style="margin:3px 0 0;font-size:12.5px;color:#7a746a">Investor team</p>
    </div>
  </td></tr>
</table>
</td></tr></table></body></html>`;
}

function letterText(firstName: string, bodyText: string, token: string) {
  return `${firstName ? "Hi " + firstName + "," : "Hello,"}\n\n${bodyText}\n\n` +
    `Keep sending me matches:\n${BASE}?t=${token}&a=continue\n\n` +
    `Take me off the list:\n${BASE}?t=${token}&a=remove\n\n` +
    `Either answer is fine and takes effect straight away. If you would rather talk, just reply to this email.\n\n` +
    `${BROKERAGE}\nInvestor team\n`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return j({ ok: false, error: "not authenticated" }, 401);

  const SB = Deno.env.get("SUPABASE_URL")!;
  const admin = createClient(SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const asUser = createClient(SB, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });

  const { data: isStaff } = await asUser.rpc("is_brokerage_staff");
  if (!isStaff) return j({ ok: false, error: "broker only" }, 403);
  const { data: me } = await asUser.auth.getUser();
  const uid = me?.user?.id || null;

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.notice_ids) ? body.notice_ids : [];
  if (!ids.length) return j({ ok: false, error: "nothing to send" });

  // The brokerage's default account — the letter goes out as the company.
  const { data: acct } = await admin.from("email_accounts")
    .select("id,email_address").eq("user_id", uid).eq("is_default", true).maybeSingle();
  if (!acct) return j({ ok: false, error: "No default email account is connected." });

  const results: any[] = [];
  for (const id of ids.slice(0, 50)) {
    const { data: rows } = await admin.from("investor_transition_notices")
      .select("id,status,token,draft_subject,draft_body,thin_history,buyer_id,investor_buyers(name,email)")
      .eq("id", id).limit(1);
    const n: any = rows && rows[0];
    if (!n) { results.push({ id, ok: false, error: "not found" }); continue; }
    // Only approved letters. A draft nobody opened must never go out, even if the
    // client asks for it.
    if (n.status !== "ready") { results.push({ id, ok: false, error: "not approved" }); continue; }
    if (n.thin_history) { results.push({ id, ok: false, error: "thin history — call, don't email" }); continue; }
    const to = n.investor_buyers?.email;
    if (!to) { results.push({ id, ok: false, error: "no email on file" }); continue; }
    if (!n.draft_body) { results.push({ id, ok: false, error: "no letter" }); continue; }

    const first = String(n.investor_buyers?.name || "").trim().split(/\s+/)[0] || "";
    try {
      const r = await fetch(`${SB}/functions/v1/gmail-send`, {
        method: "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: JSON.stringify({
          account_id: acct.id, to,
          subject: n.draft_subject || `About your investor account — ${BROKERAGE}`,
          body_text: letterText(first, n.draft_body, n.token),
          body_html: letterHtml(first, n.draft_body, n.token),
          from_name: BROKERAGE,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { results.push({ id, ok: false, error: d?.error || ("HTTP " + r.status) }); continue; }
      await admin.from("investor_transition_notices")
        .update({ status: "sent", sent_at: new Date().toISOString(), sent_by: uid, updated_at: new Date().toISOString() })
        .eq("id", id);
      results.push({ id, ok: true, to });
    } catch (err) {
      results.push({ id, ok: false, error: String(err) });
    }
  }
  return j({ ok: true, sent: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length, results });
});
