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
