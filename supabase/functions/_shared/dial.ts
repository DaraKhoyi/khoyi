// THE DIAL (4 Oct 2026): may PrismOS do this on its own for this person?
//
// Dara: "I do want to be able to throttle what is being done for me." One rule,
// in one place: public.dial_level(user, category) in
// supabase/sql/2026-10-04c_the_dial.sql. Every job that acts on its own asks it.
// Levels: off | suggest | tell | quiet. A paused person is 'off' everywhere.
// If the question cannot be asked (a network blip), the answer is the category's
// DEFAULT — the behaviour the person had before they touched anything — never a
// silent stop and never more than the default.
export type DialCat = "call_followups" | "tidy_followups" | "lead_drafts" | "calendar" | "calls_personal";
const DEFAULTS: Record<DialCat, string> = { call_followups: "suggest", tidy_followups: "tell", lead_drafts: "suggest", calendar: "off", calls_personal: "off" };

export async function dialLevel(db: any, userId: string | null | undefined, cat: DialCat): Promise<string> {
  if (!userId) return DEFAULTS[cat];
  try {
    const { data, error } = await db.rpc("dial_level", { p_user: userId, p_cat: cat });
    if (error || typeof data !== "string" || !data) { console.error("dial_level:", error?.message || "no answer"); return DEFAULTS[cat]; }
    return data;
  } catch (e) { console.error("dial_level:", String((e as Error)?.message || e)); return DEFAULTS[cat]; }
}
