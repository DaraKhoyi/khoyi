// One text. One name. Before the deadline.
//
// Marguerite, on the panel, reading our 248 expired commitments:
//
//   "The screen I'd walk away from is any screen that shows me a list of overdue
//    things I already know I avoided. The one thing that would keep me is if the
//    app texted me one name — one — and said 'you said you would call Maria by
//    Tuesday.' Build the text, not the list."
//
// Ray arrived at the same wall from the other side: he would close the app
// rather than read a list of what he had failed at. Two agents, two devices, two
// skill levels, one conclusion — the system knows what was missed and never says
// so while it can still be kept.
//
// So this fires BEFORE the deadline, never after. A nudge you can still act on
// is help; the same message a day later is an accusation.
//
// DESIGN RULES, all of them load-bearing:
//   ONE name, never a list. A list is the thing they already ignore.
//   ONE text a day, per agent, at most. Two is nagging and nagging gets blocked.
//   Only to the AGENT'S OWN phone. Texting yourself is permitted; texting a
//     client is TCPA territory and this function must never be pointed there.
//   Nothing outside 8am-8pm in their own day.
//   Silence when there is nothing due. No "you have 0 items" text, ever.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-qcp-token",
};

const firstName = (s: string) => String(s || "").trim().split(/\s+/)[0] || "them";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.headers.get("x-qcp-token") !== Deno.env.get("QCP_TOKEN")) {
    return new Response(JSON.stringify({ error: "unauthorised" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const sent: unknown[] = [];

  try {
    const { data: today } = await admin.rpc("today_ny");
    const nyHour = parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: "America/New_York", hour: "2-digit", hour12: false }).format(new Date()), 10);
    if (nyHour < 8 || nyHour >= 20) {
      return new Response(JSON.stringify({ skipped: "outside 8am-8pm" }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Due today or tomorrow, still open, and not already nudged.
    const { data: due } = await admin
      .from("commitments")
      .select("id, user_id, title, owner, due_date, nudged_at")
      .in("status", ["open", "accepted", "proposed"])
      .not("due_date", "is", null)
      .lte("due_date", new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10))
      .gte("due_date", today)
      .is("nudged_at", null)
      .limit(200);

    // Group by agent and pick ONE — the soonest, then the oldest promise. The
    // one they are most likely to lose.
    const byUser = new Map<string, any[]>();
    for (const c of due || []) {
      if (!byUser.has(c.user_id)) byUser.set(c.user_id, []);
      byUser.get(c.user_id)!.push(c);
    }

    for (const [userId, list] of byUser) {
      list.sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
      const pick = list[0];

      // One a day, per agent.
      const { count: already } = await admin
        .from("commitments")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .gte("nudged_at", new Date(Date.now() - 20 * 3600 * 1000).toISOString());
      if ((already || 0) > 0) continue;

      // Their own mobile, from the roster. No phone, no text.
      const { data: agent } = await admin
        .from("agents").select("phone, name").eq("auth_user_id", userId).maybeSingle();
      const to = String(agent?.phone || "").replace(/[^0-9+]/g, "");
      if (to.length < 10) continue;

      const who = firstName(pick.owner || "");
      const when = pick.due_date === today ? "today" : "tomorrow";
      // Written the way Marguerite asked for it: a name, a promise, a deadline.
      // No app name, no link, no list, nothing to scroll.
      const body = `You said you'd ${String(pick.title || "follow up").replace(/^\s*[A-Z][a-z]+ (will|to) /, "")} — ${who ? who + ", " : ""}due ${when}.`;

      const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/quo-proxy`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ user_id: userId, path: "/v1/messages", method: "POST",
          body: { to: [to], text: body.slice(0, 300) } }),
      });

      // Stamp it whatever happened, so a failing send cannot become a loop that
      // texts someone every ten minutes.
      await admin.from("commitments").update({ nudged_at: new Date().toISOString() }).eq("id", pick.id);
      sent.push({ user_id: userId, commitment: pick.id, ok: r.ok });
    }

    return new Response(JSON.stringify({ ok: true, sent: sent.length, detail: sent }),
      { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
