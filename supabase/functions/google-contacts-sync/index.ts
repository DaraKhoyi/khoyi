// google-contacts-sync
// Pull the agent's Google address book into public.google_contacts (a STAGING
// mirror — never into `contacts`; see the table comment for why).
//
// POST { user_id: uuid, account_id?: uuid, full?: boolean }
//
// Flow:
//   1. Find the connected Google account that actually holds a contacts scope.
//   2. Refresh the access token if it has expired.
//   3. people.connections.list, paged, incremental via syncToken when we have one.
//   4. Upsert by (user_id, resource_name) — the People API resourceName is the
//      only stable key. Names, emails and phones all change; that does not.
//   5. Persist the new syncToken.
//
// READ ONLY. This function never writes to Google and never deletes a PrismOS
// contact. A contact removed in Google is flagged, not destroyed, because the
// agent may already have built history on it here.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PERSON_FIELDS =
  "names,emailAddresses,phoneNumbers,organizations,photos,metadata,memberships";

async function refreshAccessToken(refreshToken: string) {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refreshToken, grant_type: "refresh_token",
    }).toString(),
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return await r.json();
}

// Normalised match keys, computed here so matching never depends on a caller
// remembering to lowercase or strip punctuation.
const normEmail = (e: string) => (e || "").trim().toLowerCase() || null;
const normPhone = (p: string) => {
  const d = (p || "").replace(/[^0-9]/g, "");
  if (!d) return null;
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;   // US 1-prefix
};

function mapPerson(p: any, userId: string, accountId: string) {
  const name = (p.names || [])[0] || {};
  const emails = (p.emailAddresses || []).map((e: any) => ({ value: e.value, type: e.type || null }))
    .filter((e: any) => e.value);
  const phones = (p.phoneNumbers || []).map((v: any) => ({ value: v.value, type: v.type || null }))
    .filter((v: any) => v.value);
  const orgs = (p.organizations || []).map((o: any) => ({ name: o.name || null, title: o.title || null }))
    .filter((o: any) => o.name || o.title);
  const groups = (p.memberships || [])
    .map((m: any) => m?.contactGroupMembership?.contactGroupId).filter(Boolean);
  return {
    user_id: userId,
    account_id: accountId,
    resource_name: p.resourceName,
    etag: p.etag || null,
    display_name: name.displayName || [name.givenName, name.familyName].filter(Boolean).join(" ") || null,
    given_name: name.givenName || null,
    family_name: name.familyName || null,
    emails, phones, organizations: orgs,
    photo_url: ((p.photos || [])[0] || {}).url || null,
    google_groups: groups,
    primary_email: normEmail(emails[0]?.value),
    primary_phone: normPhone(phones[0]?.value),
    google_updated_at: p.metadata?.sources?.[0]?.updateTime || null,
    last_seen_at: new Date().toISOString(),
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { user_id, account_id, full } = await req.json();
    if (!user_id) return json({ ok: false, error: "user_id required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. the account. Must actually hold a contacts scope — a Gmail-only
    //    account will 403 on People and the error would look like a bug.
    const { data: candidates, error: accErr } = await supabase
      .from("email_accounts").select("*")
      .eq("user_id", user_id).eq("provider", "google").eq("is_active", true)
      .order("updated_at", { ascending: false });
    if (accErr) throw accErr;
    let account = account_id
      ? (candidates || []).find((a: any) => a.id === account_id)
      : (candidates || []).find((a: any) => (a.scopes || []).some((s: string) => s.includes("auth/contacts")));
    if (!account) {
      return json({ ok: false, error: "NO_CONTACTS_ACCOUNT",
        message: "No Google account is connected with Contacts access. Settings → Connected Google Accounts → Connect Contacts." }, 400);
    }
    if (!account.refresh_token) {
      return json({ ok: false, error: "REAUTH_REQUIRED", message: "Reconnect this Google account." }, 400);
    }

    // 2. token
    let accessToken = account.access_token;
    if (!account.token_expires_at || new Date(account.token_expires_at) <= new Date()) {
      const r = await refreshAccessToken(account.refresh_token);
      accessToken = r.access_token;
      await supabase.from("email_accounts").update({
        access_token: accessToken,
        token_expires_at: new Date(Date.now() + ((r.expires_in || 3600) - 60) * 1000).toISOString(),
      }).eq("id", account.id);
    }

    // 3. cursor
    const { data: cur } = await supabase.from("google_contacts_sync")
      .select("*").eq("account_id", account.id).maybeSingle();
    let syncToken = full ? null : (cur?.sync_token || null);

    let pageToken: string | null = null;
    let seen = 0, upserted = 0, removed = 0, pages = 0;
    let newSyncToken: string | null = null;

    do {
      const u = new URL("https://people.googleapis.com/v1/people/me/connections");
      u.searchParams.set("personFields", PERSON_FIELDS);
      u.searchParams.set("pageSize", "500");
      u.searchParams.set("requestSyncToken", "true");
      if (syncToken) u.searchParams.set("syncToken", syncToken);
      if (pageToken) u.searchParams.set("pageToken", pageToken);

      const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });

      // An expired syncToken is normal, not an error: Google drops them after
      // ~7 days of inactivity. Fall back to a full pull once rather than
      // failing the sync and leaving the agent stuck forever.
      if (r.status === 400 && syncToken) {
        syncToken = null; pageToken = null;
        await supabase.from("google_contacts_sync").upsert(
          { account_id: account.id, user_id, sync_token: null, last_error: "syncToken expired — full resync" },
          { onConflict: "account_id" });
        continue;
      }
      if (r.status === 403) {
        const body = (await r.text()).slice(0, 300);
        return json({ ok: false, error: "PEOPLE_API_FORBIDDEN",
          message: "Google refused the request. Usually the People API is not enabled on the Cloud project, or the contacts scope was not granted.",
          detail: body }, 400);
      }
      if (r.status === 429 || r.status >= 500) {
        // Back off once, then give up cleanly and keep the cursor intact so the
        // next run resumes instead of restarting.
        await new Promise((res) => setTimeout(res, 2000));
        const retry = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!retry.ok) throw new Error(`People API ${retry.status}: ${(await retry.text()).slice(0, 200)}`);
        var data = await retry.json();
      } else if (!r.ok) {
        throw new Error(`People API ${r.status}: ${(await r.text()).slice(0, 200)}`);
      } else {
        var data = await r.json();
      }

      const people = data.connections || [];
      seen += people.length;
      pages += 1;

      // Deletions arrive as tombstones during an incremental sync. Flag, never
      // delete: the agent may have built real history on this person here.
      const gone = people.filter((p: any) => p.metadata?.deleted).map((p: any) => p.resourceName);
      if (gone.length) {
        await supabase.from("google_contacts")
          .update({ deleted_in_google: true, last_seen_at: new Date().toISOString() })
          .eq("user_id", user_id).in("resource_name", gone);
        removed += gone.length;
      }

      const rows = people.filter((p: any) => !p.metadata?.deleted && p.resourceName)
        .map((p: any) => mapPerson(p, user_id, account.id));
      if (rows.length) {
        const { error } = await supabase.from("google_contacts")
          .upsert(rows, { onConflict: "user_id,resource_name" });
        if (error) throw error;
        upserted += rows.length;
      }

      pageToken = data.nextPageToken || null;
      if (data.nextSyncToken) newSyncToken = data.nextSyncToken;
    } while (pageToken && pages < 40);   // 40 x 500 = 20k contacts, a hard stop

    // 4. auto-link anything that unambiguously already exists in PrismOS, so the
    //    review queue only ever shows genuinely new people.
    const { data: linked } = await supabase.rpc("link_google_contacts", { p_user: user_id });

    await supabase.from("google_contacts_sync").upsert({
      account_id: account.id, user_id,
      sync_token: newSyncToken || syncToken,
      last_sync_at: new Date().toISOString(),
      last_error: null,
      total_seen: (cur?.total_seen || 0) + seen,
    }, { onConflict: "account_id" });

    return json({ ok: true, account: account.email_address, pages, seen, upserted,
                  removed, auto_linked: linked ?? 0, incremental: !!syncToken });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e).slice(0, 300) }, 500);
  }
});
