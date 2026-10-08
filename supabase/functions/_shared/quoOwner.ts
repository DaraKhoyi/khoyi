// quoOwner.ts — whose account does a Quo (OpenPhone) message or call belong to?
// One answer, used by quo-webhook (live events) and quo-sync (backfill).
//
// 8 Oct 2026. quo-sync used to file every backfilled row under WHOEVER CALLED
// IT, and upserted on op_id, so each run took existing rows away from their
// owner. The smoke-test harness signs up ~40 throwaway accounts per run; each
// one opened the Quo screen, quo-sync re-filed Dara's texts and calls under
// that account, and deleting the account afterwards (quo_* user_id FK is ON
// DELETE CASCADE) deleted them. Rows now belong to the LINE's owner, never to
// the caller, and an existing row's owner is never changed (the database
// enforces that too: trigger quo_keep_owner).
//
// Order (same as quo-webhook has used since August):
//   1. the user who has that Quo line (phoneNumberId) selected in quo_settings.
//      If several have, QUO_OWNER_USER_ID wins, else whoever chose it first;
//   2. the user whose saved active_number matches the event's number;
//   3. QUO_OWNER_USER_ID (single-operator fallback);
//   4. null = nobody: the caller must skip the row rather than guess.

const _digits = (s: unknown) => String(s ?? "").replace(/[^0-9]/g, "");
export const last10 = (s: unknown) => { const d = _digits(s); return d.length >= 10 ? d.slice(-10) : d; };

type Setting = { user_id: string; active_phone_number_id: string | null; active_number: string | null; updated_at: string | null };

export class QuoOwners {
  private settings: Setting[] | null = null;
  constructor(private supabase: any, private fallback: string | null = Deno.env.get("QUO_OWNER_USER_ID") || null) {}

  private async load(): Promise<Setting[]> {
    if (this.settings) return this.settings;
    const { data } = await this.supabase.from("quo_settings")
      .select("user_id, active_phone_number_id, active_number, updated_at")
      .order("updated_at", { ascending: true });
    this.settings = (data || []) as Setting[];
    return this.settings;
  }

  /** How the owner was found, for logging: line | number | fallback | none. */
  async resolve(phoneNumberId: string | null | undefined, numbers: unknown[] = []): Promise<{ owner: string | null; via: "line" | "number" | "fallback" | "none" }> {
    const rows = await this.load();
    if (phoneNumberId) {
      const onLine = rows.filter((r) => r.active_phone_number_id === phoneNumberId);
      if (onLine.length) {
        const pick = onLine.find((r) => r.user_id === this.fallback) || onLine[0];
        return { owner: pick.user_id, via: "line" };
      }
    }
    for (const n of numbers) {
      const k = last10(n);
      if (!k) continue;
      const hit = rows.find((r) => r.active_number && last10(r.active_number) === k);
      if (hit) return { owner: hit.user_id, via: "number" };
    }
    if (this.fallback) return { owner: this.fallback, via: "fallback" };
    return { owner: null, via: "none" };
  }
}
