// roster-sync
//
// The MASTER ROSTER sheet is the source of truth for who works here. The agents
// table was not: it was a by-product of the commission import, so it counted 183
// "active" agents — every name that ever appeared on a transaction — of which
// 120 were name-only stubs with no email or phone. The real roster is 88.
//
// Reads through DRIVE, not the Sheets API. The Sheets API is not enabled on this
// Google Cloud project (403), and it does not need to be: Drive can export the
// whole workbook, which also gets every tab in one request instead of one call
// per tab. Same account, same drive.readonly scope already granted.
//
// Rules, from Dara:
//   Active Agents tab, every row ABOVE the row starting "Total"
//        -> agents.active = true, contact type our_agent, shared to the team
//   No Longer with ROGA
//        -> agents.active = false, contact type agent_lost
//   In the app but on NEITHER tab
//        -> active = false. They left without the sheet being updated, or they
//           were never really an agent.
//   Offboarding / Referral / Onboarding
//        -> deliberately untouched. Dara has not defined what they mean yet and
//           guessing would reclassify real people.
//
// NEVER deletes. Production history hangs off agent_id, and an agent who leaves
// still owns the sales they made.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const QCP = Deno.env.get("QCP_TOKEN") || "";
const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function freshGoogleToken(supabase: any, account: any): Promise<string> {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - now > 120 * 1000) return account.access_token;
  if (!account.refresh_token) throw new Error("No refresh_token — reconnect the Google account.");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: Deno.env.get("GOOGLE_CLIENT_ID")!,
      client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  const t = await r.json();
  await supabase.from("email_accounts").update({
    access_token: t.access_token,
    token_expires_at: new Date(now + ((t.expires_in || 3600) - 60) * 1000).toISOString(),
  }).eq("id", account.id);
  return t.access_token;
}

const norm = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => norm(v).toLowerCase();

// "Abbas, Yasameen" -> "Yasameen Abbas". The sheet is filed by surname; people
// are not called that.
function displayName(raw: string): string {
  const s = norm(raw);
  if (!s.includes(",")) return s;
  const [last, first] = s.split(",", 2);
  return (norm(first) + " " + norm(last)).trim();
}

// The sheet holds phones as "813-331-9444", "813.447.6819" and 5154448975.0.
function normPhone(v: unknown): string | null {
  let s = norm(v);
  if (!s) return null;
  if (/^\d+(\.0+)?$/.test(s)) s = s.replace(/\.0+$/, "");
  const d = s.replace(/[^0-9]/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return d ? s : null;
}

// Pull the WHOLE workbook once and pick tabs BY NAME.
//
// Drive's CSV export only ever returns the first tab, and the per-tab CSV form
// needs a gid — which means scraping the edit page (401 with a bearer token) and
// pins the sync to an id that changes if a tab is ever recreated. Dara named the
// tabs, so the sync should use the names. One request, every tab, no gids.
async function loadWorkbook(fileId: string, token: string): Promise<any> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}/export` +
    `?mimeType=${encodeURIComponent("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" });
  if (!r.ok) throw new Error(`Workbook export failed (${r.status}) — is the sheet shared with this Google account?`);
  return XLSX.read(new Uint8Array(await r.arrayBuffer()), { type: "array" });
}

function tabRows(wb: any, name: string): string[][] {
  const ws = wb.Sheets[name];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" }) as string[][];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const internal = (QCP && (req.headers.get("x-qcp-token") || "") === QCP) || auth === SERVICE_KEY;
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    let ownerId: string | null = null;
    if (!internal) {
      const { data: { user } } = await admin.auth.getUser(auth);
      if (!user) return json({ error: "Not authenticated" }, 401);
      const { data: me } = await admin.from("agents").select("role").eq("auth_user_id", user.id).maybeSingle();
      if (!me || !["owner", "broker_admin"].includes(String(me.role))) {
        return json({ error: "Only the broker can sync the roster." }, 403);
      }
      ownerId = user.id;
    }

    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;

    const { data: cfg } = await admin.from("roster_sheet_config")
      .select("*").eq("is_active", true).order("updated_at", { ascending: false }).limit(1);
    const c = cfg?.[0];
    if (!c) return json({ ok: false, error: "No active roster sheet configured." });
    ownerId = ownerId || c.user_id;

    const { data: acct } = await admin.from("email_accounts")
      .select("*").eq("user_id", c.user_id).eq("is_active", true)
      .order("is_default", { ascending: false }).limit(1);
    if (!acct?.[0]) return json({ ok: false, error: "No connected Google account to read the sheet with." });
    const token = await freshGoogleToken(admin, acct[0]);

    const tabs = c.tab_map || {};
    const activeTab = tabs.active || "Active Agents";
    const leftTab = tabs.left || "No Longer with ROGA";
    const wb = await loadWorkbook(c.spreadsheet_id, token);
    const activeCsv = tabRows(wb, activeTab);
    const goneCsv = tabRows(wb, leftTab);
    if (!activeCsv.length) {
      return json({ ok: false, error: `Tab "${activeTab}" not found. Tabs present: ${Object.keys(wb.Sheets).join(", ")}` });
    }

    // Column positions come from the header row, not hard-coded indexes — a
    // column inserted in the sheet must not silently shift everything.
    const head = (activeCsv[0] || []).map(lower);
    const col = (...names: string[]) => {
      for (const n of names) { const i = head.findIndex(h => h.includes(n)); if (i >= 0) return i; }
      return -1;
    };
    const iEmail = col("email"), iPhone = col("cell phone", "phone"), iPlan = col("agent plan"),
      iLic = col("license number"), iNrds = col("nrds");

    if (iEmail < 0) return json({ ok: false, error: "No EMAIL_ADDRESS column found on the active tab." });

    // Everything ABOVE the row whose first cell starts with "Total".
    const activeRows: any[] = [];
    for (let i = 1; i < activeCsv.length; i++) {
      const r = activeCsv[i];
      const first = lower(r[0]);
      if (first.startsWith("total")) break;
      if (!norm(r[0]) || !norm(r[iEmail]).includes("@")) continue;
      activeRows.push({
        name: displayName(r[0]),
        email: lower(r[iEmail]),
        phone: iPhone >= 0 ? normPhone(r[iPhone]) : null,
        plan: iPlan >= 0 ? norm(r[iPlan]) : null,
        license_no: iLic >= 0 ? norm(r[iLic]) : null,
        nrds_number: iNrds >= 0 ? norm(r[iNrds]) : null,
      });
    }
    const goneEmails = new Set<string>();
    if (goneCsv.length) {
      const gh = (goneCsv[0] || []).map(lower);
      const gi = gh.findIndex(h => h.includes("email"));
      for (let i = 1; i < goneCsv.length; i++) {
        const e = lower(goneCsv[i][gi >= 0 ? gi : 2]);
        if (e.includes("@")) goneEmails.add(e);
      }
    }
    if (!activeRows.length) return json({ ok: false, error: "Read 0 agents from the active tab — refusing to deactivate everyone." });

    const activeEmails = new Set(activeRows.map(r => r.email));
    // SCOPED TO THE BROKERAGE OWNER. This is a multi-user system and roster-sync
    // must not reach into another user's roster — the smoke gate seeds a
    // throwaway user with an our_agent contact, which becomes an agents row under
    // THAT user, and an unscoped sync deactivated four of them this morning.
    // Someone else's agents are not this roster's business.
    const { data: existing } = await admin.from("agents")
      .select("id, email, name, active, auth_user_id").eq("user_id", ownerId);
    const byEmail = new Map<string, any>();
    for (const a of existing || []) { const e = lower(a.email); if (e) byEmail.set(e, a); }

    const report = { read: activeRows.length, added: 0, updated: 0, deactivated: 0, marked_left: 0, contacts_typed: 0 };

    for (const r of activeRows) {
      const found = byEmail.get(r.email);
      const patch: any = { name: r.name, email: r.email, active: true, role: "agent" };
      if (r.phone) patch.phone = r.phone;
      if (r.plan) patch.team = r.plan;
      if (r.license_no) patch.license_no = r.license_no;
      if (r.nrds_number) patch.nrds_number = r.nrds_number;
      if (found) {
        // Never demote the owner or an admin to "agent" on a roster pass.
        if (found.auth_user_id) delete patch.role;
        if (!dryRun) await admin.from("agents").update(patch).eq("id", found.id);
        report.updated++;
      } else {
        if (!dryRun) await admin.from("agents").insert({ ...patch, user_id: ownerId });
        report.added++;
      }
    }

    // On the leavers tab, or in the app but on neither tab.
    for (const a of existing || []) {
      const e = lower(a.email);
      if (e && activeEmails.has(e)) continue;
      if (!a.active) continue;
      // NEVER deactivate someone who can log in. The broker and the admins are
      // not on the Active Agents tab — that tab lists agents — so the first run
      // switched Dara off, and lead-notify skips inactive people, so his own 36
      // pending leads were never judged. Anyone with an account stays active;
      // the roster decides who is an AGENT, not who works here.
      if (a.auth_user_id) continue;
      const left = e && goneEmails.has(e);
      if (!dryRun) await admin.from("agents").update({ active: false }).eq("id", a.id);
      if (left) report.marked_left++; else report.deactivated++;
    }

    // Contacts follow the roster: our_agent for the active, agent_lost for the
    // rest. The share trigger sets team_id, so Alex and Josh see them.
    if (!dryRun) {
      const act = [...activeEmails];
      for (let i = 0; i < act.length; i += 100) {
        const chunk = act.slice(i, i + 100);
        const { count } = await admin.from("contacts")
          .update({ type: "our_agent" }, { count: "exact" })
          .in("email", chunk).neq("type", "our_agent");
        report.contacts_typed += count || 0;
      }
      const gone = [...goneEmails];
      for (let i = 0; i < gone.length; i += 100) {
        const chunk = gone.slice(i, i + 100);
        await admin.from("contacts").update({ type: "agent_lost" }).in("email", chunk).eq("type", "our_agent");
      }
      await admin.from("roster_sheet_config")
        .update({ last_synced_at: new Date().toISOString(), last_sync_result: report })
        .eq("id", c.id);
    }

    return json({ ok: true, dry_run: dryRun, ...report });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) });
  }
});
