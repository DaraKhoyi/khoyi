// What this person has told PrismOS was "not a thing" (2 Oct 2026).
//
// Dara: "I want to train my AI to give me relevant items… Not a thing should
// teach the AI it brought up something that maybe it shouldn't have."
//
// The lesson is the person's own most recent "Not a thing" choices
// (commitments.not_a_thing_at), given back to the model that reads their calls
// as examples of what NOT to raise. Each person teaches only their own PrismOS.
// Returns "" when there is nothing to learn from, or on any error — a missing
// lesson must never stop a call being read.
export async function notAThingLessons(db: any, userId?: string | null, limit = 12): Promise<string> {
  try {
    if (!userId) return "";
    const { data, error } = await db.from("commitments").select("title,quote,owner_name")
      .eq("user_id", userId).not("not_a_thing_at", "is", null)
      .order("not_a_thing_at", { ascending: false }).limit(limit);
    if (error || !data?.length) return "";
    const lines = data.map((r: any) => {
      const t = String(r.title || "").replace(/\s+/g, " ").trim().slice(0, 140);
      const q = String(r.quote || "").replace(/\s+/g, " ").trim().slice(0, 160);
      return t ? `- ${t}${q ? ` (the words were: "${q}")` : ""}` : "";
    }).filter(Boolean);
    if (!lines.length) return "";
    return "\nTHIS PERSON'S OWN CORRECTIONS. They marked each of these past suggestions \"Not a thing\" — it should never have been raised. " +
      "Learn the KIND of thing each one is and do not extract anything like it again (the same sort of remark, the same sort of vagueness, the same sort of person's own business). " +
      "They are examples of what to leave out, not a list of banned words:\n" + lines.join("\n") + "\n";
  } catch (_) { return ""; }
}

// What the call reader may pick up about the person's PRIVATE life (4 Oct 2026).
//
// Ray (panel): a "Get showered and ready" item in the queue — "the app is
// tracking things that will make an agent feel watched, not helped." Dara's
// decision the same day: OFF by default. What the person adds to their own list
// is welcome whatever it is about (the task list is their whole life); what the
// AI overhears on a call is limited to their work unless they ask for more
// (user_settings.calls_personal). One rule, here, for every call reader.
export async function personalRule(db: any, userId?: string | null): Promise<string> {
  let on = false;
  try {
    if (userId) {
      const { data } = await db.from("user_settings").select("calls_personal").eq("user_id", userId).maybeSingle();
      on = data?.calls_personal === true;
    }
  } catch (_) { on = false; }
  const never = "- NEVER extract a remark about the person's own body, routine or getting ready ('I need to shower', 'let me eat first', 'I'm going to get dressed and head over') from anyone on the call. Nobody is owed those and nobody should be tracked on them.\n";
  return on
    ? never + "- Personal and family promises made to another person count exactly as much as real-estate ones: this person asked for them to be picked up.\n"
    : never + "- WORK ONLY. Extract a promise only when it concerns this person's work: a client, a deal, a property, a listing, a tenant, a vendor, the brokerage, money or paperwork for any of those. Personal, family, household, health and social plans heard on the call ('I'll pick up the kids', 'dinner Saturday', 'I'll call Mom back') are private conversation, not suggestions — leave them out. They are still in the call summary.\n";
}

// What this person BROUGHT BACK from the record (4 Oct 2026): a suggestion that
// was left out or set aside, which they said should not have been. The mirror of
// "Not a thing" — examples of what to raise, in their own history.
export async function broughtBackLessons(db: any, userId?: string | null, limit = 8): Promise<string> {
  try {
    if (!userId) return "";
    const [a, b] = await Promise.all([
      db.from("dropped_suggestions").select("title,quote").eq("user_id", userId).not("picked_up_at", "is", null).order("picked_up_at", { ascending: false }).limit(limit),
      db.from("commitment_events").select("title").eq("user_id", userId).eq("actor", userId).eq("to_status", "proposed").in("from_status", ["expired", "archived"]).order("at", { ascending: false }).limit(limit),
    ]);
    const lines = [...(a.data || []), ...(b.data || [])].map((r: any) => {
      const t = String(r.title || "").replace(/\s+/g, " ").trim().slice(0, 140);
      const q = String(r.quote || "").replace(/\s+/g, " ").trim().slice(0, 160);
      return t ? `- ${t}${q ? ` (the words were: "${q}")` : ""}` : "";
    }).filter(Boolean).slice(0, limit);
    if (!lines.length) return "";
    return "\nTHIS PERSON BROUGHT THESE BACK after PrismOS left them out or set them aside — each one mattered to them. " +
      "Learn the KIND of thing each is and do raise things like it:\n" + lines.join("\n") + "\n";
  } catch (_) { return ""; }
}
