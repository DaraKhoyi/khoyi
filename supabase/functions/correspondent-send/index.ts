// correspondent-send — the only path from an approved note to a mailbox.
//
// IT SENDS APPROVED NOTES AND NOTHING ELSE. Status must be 'approved'. Not
// 'drafted', not 'newsletter_only' that was never approved, not a note whose text
// changed after approval — the edit guard reverts those to 'drafted' precisely so
// this function refuses them.
//
// WHY EACH SEND IS ITS OWN MESSAGE, one at a time, from the agent's own address:
// forty near-identical messages in one batch from an individual mailbox is what a
// mailbox provider classifies as bulk, and that classification follows the AGENT's
// reputation, not the brokerage's. Short, varied, low-image, link-out mail sent
// individually is what gets treated as personal correspondence. The publish-first
// architecture is therefore also the deliverability architecture.
//
// EVERY SEND LOGS A TOUCH. Without that the frequency budget is fiction — the
// budget can only arbitrate across campaigns if every campaign records what it
// spent. This is the line that makes running several automations unattended safe.
//
// It does NOT send the email itself: gmail-send already owns accounts, tokens,
// aliases and threading. One rule, one place.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey" };
const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Plain text with the link on its own line. No template, no header image, no
// tracking pixel — a note from a person does not have a masthead.
function compose(body: string, url: string, disclosure: string) {
  return String(body).trim() + "\n\n" + url + "\n\n--\n" + disclosure;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return j({ ok: false, error: "not authenticated" }, 401);

  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: who } = await asUser.auth.getUser();
  const uid = who?.user?.id;
  if (!uid) return j({ ok: false, error: "not authenticated" }, 401);

  const b = await req.json().catch(() => ({}));
  const pieceId = b.piece_id;
  if (!pieceId) return j({ ok: false, error: "piece_id required" });

  const { data: piece } = await asUser.from("correspondent_pieces").select("*").eq("id", pieceId).maybeSingle();
  if (!piece) return j({ ok: false, error: "piece not found" });
  if (!piece.published_at) return j({ ok: false, error: "the piece is not published — the link would arrive dead" });
  if (piece.status !== "approved") return j({ ok: false, error: "this piece has not been approved" });

  const { data: agent } = await asUser.from("agents")
    .select("name,license_number,phone").eq("auth_user_id", uid).maybeSingle();
  // Required brokerage advertising disclosure. Present on every send AND on the
  // hosted page, because the email is from the agent and the page is hosted by the
  // brokerage and the reader must experience one continuous identity.
  const disclosure = [
    String(agent?.name || "").trim(),
    "Realty ONE Group Advantage",
    agent?.license_number ? "Lic. " + agent.license_number : null,
    "Reply STOP and I will take you off this list.",
  ].filter(Boolean).join(" · ");

  const url = "https://darasapp.com/c/" + (piece.slug || piece.id);

  const { data: sends } = await asUser.from("correspondent_sends")
    .select("id,contact_id,subject,body,tier,status").eq("piece_id", pieceId)
    .eq("user_id", uid).eq("status", "approved");
  const queue = (sends || []).slice(0, 60);
  if (!queue.length) return j({ ok: false, error: "nothing approved to send" });

  const results: any[] = [];
  for (const s of queue) {
    // Re-check at the moment of sending, not only when the batch was assembled.
    // A reply that arrived two minutes ago must stop this.
    const { data: fresh } = await asUser.from("correspondent_sends")
      .select("status").eq("id", s.id).maybeSingle();
    if (fresh?.status !== "approved") { results.push({ id: s.id, ok: false, error: "no longer approved: " + fresh?.status }); continue; }

    const { data: c } = await asUser.from("contacts").select("email,name").eq("id", s.contact_id).maybeSingle();
    if (!c?.email) { results.push({ id: s.id, ok: false, error: "no email" }); continue; }

    try {
      const r = await fetch(Deno.env.get("SUPABASE_URL")! + "/functions/v1/gmail-send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({
          to: c.email,
          subject: s.subject || piece.title,
          body: compose(s.body || "", url, disclosure),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { results.push({ id: s.id, ok: false, error: d?.error || ("HTTP " + r.status) }); continue; }

      await asUser.from("correspondent_sends")
        .update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", s.id);
      // The touch is what keeps the budget honest.
      await asUser.from("correspondent_touches")
        .insert({ user_id: uid, contact_id: s.contact_id, channel: "email", tier: s.tier, piece_id: pieceId });
      results.push({ id: s.id, ok: true, to: c.name });
    } catch (err) {
      results.push({ id: s.id, ok: false, error: String(err) });
    }
  }

  const sent = results.filter((r) => r.ok).length;
  if (sent > 0) await asUser.from("correspondent_pieces").update({ status: "sent" }).eq("id", pieceId);
  return j({ ok: true, sent, failed: results.length - sent, results });
});
