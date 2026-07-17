import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── brokerage-import ─────────────────────────────────────────────────────────
// The browser only READS the workbook and posts raw cells. Every RULE lives here:
// which rows are real, what counts as a sale, who an agent is. Same reason the NBA
// engine is a single shared file — a second copy of "what counts as a sale" living
// in the client would drift from this one, and then the office board and the import
// preview would disagree about the office's own revenue.
//
// Nothing is written unless dry_run === false, so staff always sees the damage first.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Subtotal rows live INSIDE the sheet ("January ⬆️" carries $7.8M in the Gross
// column). Counting them adds ~$23M of revenue that never happened.
const SKIP = /^(january|janary|febuary|february|march|april|may|june|july|august|september|october|november|december|total|totals|unknown files|e\/o renewal|average commission)/i;

// Leases top out at $3,500 and the next real sale is $36,500 — a clean gap in the
// data. Their commission is roughly one month's rent, so averaging them into the
// commission rate reports agents earning 50%+.
const RENTAL_MAX = 3500;

const norm = (s: string) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[⬆️\u2b06\ufe0f]/g, "")
    .replace(/\bP\.?A\.?\b/gi, "")
    .replace(/[^A-Za-z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : 0);

function findCol(header: unknown[], re: RegExp) {
  for (let i = 0; i < header.length; i++) {
    if (re.test(String(header[i] ?? ""))) return i;
  }
  return -1;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const J = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await anon.auth.getUser();
    if (!user) return J({ error: "not signed in" }, 401);

    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Staff only. This rewrites the office's revenue record.
    const { data: me } = await db.from("agents").select("role").eq("auth_user_id", user.id).maybeSingle();
    if (!me || !["owner", "broker_admin"].includes(me.role)) return J({ error: "staff only" }, 403);

    const { tab, year, rows, dry_run = true } = await req.json();
    if (!tab || !year || !Array.isArray(rows)) return J({ error: "need tab, year, rows" }, 400);

    // ── find the header row, then map columns BY NAME ──────────────────────
    // Positions are not a contract: someone will insert a column one day. The
    // agent column has no header at all, so that one is positional (col 0).
    let h = -1;
    for (let i = 0; i < Math.min(rows.length, 8); i++) {
      if ((rows[i] || []).some((c: unknown) => /gross sale/i.test(String(c ?? "")))) { h = i; break; }
    }
    if (h < 0) return J({ error: "couldn't find a 'Gross Sale' header — is this the right tab?" }, 400);
    const H = rows[h];
    const cAgent = 0;
    const cBuy   = findCol(H, /^buy/i);
    const cList  = findCol(H, /^list/i);
    const cAddr  = findCol(H, /street|address/i);
    const cGross = findCol(H, /gross sale/i);
    const cComm  = findCol(H, /gross commission/i);
    const cDate  = findCol(H, /date rcvd|date received/i);
    const cPaid  = findCol(H, /amount to pay agent/i);
    if (cGross < 0 || cComm < 0) return J({ error: "missing Gross Sale / Gross Commission columns" }, 400);

    // ── resolve names: aliases first, then roster ─────────────────────────
    const [{ data: aliases }, { data: agents }] = await Promise.all([
      db.from("agent_aliases").select("alias_norm, agent_id"),
      db.from("agents").select("id, name"),
    ]);
    const byAlias = new Map((aliases || []).map((a) => [a.alias_norm, a.agent_id]));
    const byName  = new Map((agents  || []).map((a) => [norm(a.name), a.id]));
    const resolve = (raw: string) => byAlias.get(norm(raw)) || byName.get(norm(raw)) || null;

    const out: Record<string, unknown>[] = [];
    const unmatched = new Map<string, number>();
    let sales = 0, rentals = 0, fees = 0, volume = 0, gci = 0, skipped = 0;

    for (let i = h + 1; i < rows.length; i++) {
      const r = rows[i] || [];
      const rawName = String(r[cAgent] ?? "").trim();
      if (!rawName) { skipped++; continue; }
      if (SKIP.test(rawName)) { skipped++; continue; }

      const gross = num(r[cGross]);
      const comm  = num(r[cComm]);
      const paid  = cPaid >= 0 ? num(r[cPaid]) : 0;
      const kind  = gross > RENTAL_MAX ? "sale" : gross > 0 ? "rental" : "fee";

      const agent_id = resolve(rawName);
      if (!agent_id) { unmatched.set(rawName, (unmatched.get(rawName) || 0) + 1); continue; }

      if (kind === "sale") { sales++; volume += gross; } else if (kind === "rental") rentals++; else fees++;
      gci += comm;

      let d: string | null = null;
      const dv = cDate >= 0 ? r[cDate] : null;
      if (typeof dv === "string" && /^\d{4}-\d{2}-\d{2}/.test(dv)) d = dv.slice(0, 10);

      out.push({
        agent_id, agent_name_raw: rawName, year, source_tab: tab, source_row: i + 1,
        address: cAddr >= 0 ? String(r[cAddr] ?? "").slice(0, 120) || null : null,
        buy_side: cBuy >= 0 ? !!r[cBuy] : false,
        list_side: cList >= 0 ? !!r[cList] : false,
        gross_sale: gross, gross_commission: comm, amount_to_agent: paid,
        date_received: d, kind,
      });
    }

    // What changes if we commit? Staff should never be surprised by an import.
    const { data: existing } = await db
      .from("brokerage_transactions").select("source_row").eq("source_tab", tab);
    const had = new Set((existing || []).map((e) => e.source_row));
    const incoming = new Set(out.map((o) => o.source_row as number));
    const added = out.filter((o) => !had.has(o.source_row as number)).length;
    const updated = out.length - added;
    // Rows deleted from the sheet must disappear here too, or a correction leaves
    // a ghost transaction on someone's record forever.
    const removed = [...had].filter((x) => !incoming.has(x));

    const summary = {
      tab, year, dry_run,
      rows: out.length, sales, rentals, fees, skipped,
      volume: Math.round(volume), gci: Math.round(gci),
      added, updated, removed: removed.length,
      unmatched: [...unmatched.entries()].map(([name, n]) => ({ name, rows: n })),
    };

    if (dry_run) return J({ ...summary, note: "nothing written" });

    if (out.length) {
      for (let i = 0; i < out.length; i += 200) {
        const { error } = await db.from("brokerage_transactions")
          .upsert(out.slice(i, i + 200), { onConflict: "source_tab,source_row" });
        if (error) return J({ error: "write failed: " + error.message, ...summary }, 500);
      }
    }
    if (removed.length) {
      await db.from("brokerage_transactions").delete().eq("source_tab", tab).in("source_row", removed);
    }
    return J({ ...summary, note: "committed" });
  } catch (e) {
    return J({ error: String((e as Error)?.message || e) }, 500);
  }
});
