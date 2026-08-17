// investor-transition-answer — where the two buttons in the letter land.
//
// GET  ?t=<token>              -> the confirm page (nothing is recorded yet)
// GET  ?t=<token>&a=continue   -> records "keep me on the list"
// GET  ?t=<token>&a=remove     -> records "take me off"
//
// WHY A CONFIRM STEP AND NOT A BARE LINK: mail clients and security scanners
// PREFETCH links. A one-click unsubscribe that acts on GET gets triggered by
// software the investor never touched, and we would archive a live investor and
// never know why. So the link opens a page, and the page's button records the
// answer. One extra tap, and the record actually means something.
//
// The page is deliberately plain and final: it never argues with "remove me", and
// never asks "are you sure?" a second time. An unsubscribe that fights back is
// how a courtesy notice turns into a complaint.
//
// Print/Prism Editorial dark styling to match the app; static gold, no motion.
// verify_jwt: false — this is a public page reached from an email.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const HTML = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" };
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const shell = (inner: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Realty ONE Group Advantage</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400&family=Barlow+Condensed:wght@600;700&family=Manrope:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}
body{margin:0;background:#100D09;color:#F6F1E7;font-family:Manrope,-apple-system,system-ui,sans-serif;
 display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px;line-height:1.6}
.card{max-width:560px;width:100%;background:#1B1610;border:1px solid rgba(203,163,92,.22);
 border-radius:18px;padding:30px 26px}
.eyebrow{font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;letter-spacing:.24em;
 font-size:11px;font-weight:700;color:#C5A95E}
h1{font-family:Fraunces,Georgia,serif;font-weight:300;font-size:26px;line-height:1.2;margin:8px 0 12px}
p{font-size:15px;color:#C8BFAE;margin:0 0 14px}
.rule{height:1px;background:linear-gradient(90deg,#C5A95E,transparent);margin:18px 0}
.btns{display:flex;flex-direction:column;gap:10px;margin-top:20px}
button,a.btn{font-family:inherit;font-size:15px;font-weight:700;border-radius:12px;padding:15px 18px;
 cursor:pointer;border:1px solid rgba(203,163,92,.4);text-align:center;text-decoration:none;display:block}
.primary{background:#EBCB82;color:#100D09;border:none}
.ghost{background:transparent;color:#C8BFAE}
.mark{font-family:'Barlow Condensed',sans-serif;font-weight:700;letter-spacing:.08em;font-size:12px;color:#8C8475;margin-top:24px}
.mark .one{color:#C5A95E}
.mark .prism{font-family:Fraunces,Georgia,serif;font-style:italic;color:#9A8038;letter-spacing:0}
</style></head><body><div class="card">${inner}
<div class="mark">REALTY<span class="one">ONE</span>GROUP Advantage &nbsp;<span class="prism">powered by Prism</span></div>
</div></body></html>`;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  const action = (url.searchParams.get("a") || "").toLowerCase();

  if (!token) {
    return new Response(shell(`<div class="eyebrow">Realty ONE Group Advantage</div>
      <h1>This link isn't complete.</h1>
      <p>Please open the link directly from the email we sent you, or reply to that email and we'll sort it out.</p>`), { status: 400, headers: HTML });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Look up first so we can greet by name and show what they are deciding about.
  const { data: rows } = await admin.from("investor_transition_notices")
    .select("id,status,decision,new_name,departing_name,stats,buyer_id,investor_buyers(name)")
    .eq("token", token).limit(1);
  const n: any = rows && rows[0];
  if (!n) {
    return new Response(shell(`<div class="eyebrow">Realty ONE Group Advantage</div>
      <h1>We couldn't find that link.</h1>
      <p>It may have already been used, or the address may have been broken across two lines by your email program. Replying to our email is the surest way to reach us.</p>`), { status: 404, headers: HTML });
  }
  const first = String(n.investor_buyers?.name || "").trim().split(/\s+/)[0] || "there";

  // Already answered — say what we recorded rather than asking again.
  if (n.status === "answered" && n.decision && !action) {
    const kept = n.decision === "continue";
    return new Response(shell(`<div class="eyebrow">Already recorded</div>
      <h1>${kept ? "You're still on the list." : "You've been taken off the list."}</h1>
      <p>${kept
        ? "We have you down to keep receiving properties that match your criteria. Nothing further is needed."
        : "We've stopped sending you property matches. Nothing further is needed."}</p>
      <p>If that isn't what you meant, reply to our email and we'll change it.</p>`), { headers: HTML });
  }

  if (action === "continue" || action === "remove") {
    const { data } = await admin.rpc("investor_transition_answer", { p_token: token, p_decision: action });
    if (!data || data.ok === false) {
      return new Response(shell(`<div class="eyebrow">Something went wrong</div>
        <h1>We couldn't record that.</h1>
        <p>Please reply to our email and a person will take care of it.</p>`), { status: 500, headers: HTML });
    }
    if (action === "remove") {
      return new Response(shell(`<div class="eyebrow">Done</div>
        <h1>You're off the list.</h1>
        <p>We've stopped sending you property matches, effective now. We won't follow up about it.</p>
        <p>If you ever want back on, any of us can set that up in a minute.</p>`), { headers: HTML });
    }
    return new Response(shell(`<div class="eyebrow">Done</div>
      <h1>You're all set.</h1>
      <p>We'll keep sending properties that match your criteria${n.new_name ? `, and ${esc(n.new_name)} is looking after your account` : ""}.</p>
      <p>If your criteria have changed, tell us and we'll update them before the next one goes out.</p>`), { headers: HTML });
  }

  // The confirm page. Buttons POST-like via links with &a=, but only a real tap
  // gets here, because a prefetcher only ever fetches the page itself.
  return new Response(shell(`<div class="eyebrow">Your investor account</div>
    <h1>${esc(first)}, shall we keep sending you properties?</h1>
    <p>${n.departing_name ? esc(n.departing_name) + " is no longer with the firm" : "Your agent is no longer with the firm"}${n.new_name ? `, and ${esc(n.new_name)} is looking after your account now` : ""}. We'd rather ask than assume.</p>
    <div class="rule"></div>
    <div class="btns">
      <a class="btn primary" href="?t=${esc(token)}&a=continue">Yes — keep sending me matches</a>
      <a class="btn ghost" href="?t=${esc(token)}&a=remove">No — take me off the list</a>
    </div>
    <p style="margin-top:18px;font-size:13px;color:#8C8475">Either answer is fine, and it takes effect immediately. You can change your mind at any time.</p>`), { headers: HTML });
});
