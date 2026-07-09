// icloud-connect — validates an agent's iCloud app-specific password over CalDAV,
// discovers their calendar home, ensures a dedicated "PrismOS" calendar exists,
// and stores the (encrypted) credential + URLs on their icloud_connections row.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ENC_KEY_B64 = Deno.env.get("ICLOUD_ENC_KEY")!;

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };

async function encKey() {
  const raw = Uint8Array.from(atob(ENC_KEY_B64), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function encrypt(plain: string) {
  const key = await encKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + ct.length); out.set(iv); out.set(ct, iv.length);
  return btoa(String.fromCharCode(...out));
}

const basic = (email: string, pw: string) => "Basic " + btoa(email + ":" + pw);
async function dav(method: string, url: string, auth: string, body?: string, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { Authorization: auth, "User-Agent": "PrismOS/1.0", ...extra };
  if (body != null && !headers["Content-Type"]) headers["Content-Type"] = "application/xml; charset=utf-8";
  const res = await fetch(url, { method, headers, body });
  return { status: res.status, text: await res.text() };
}
const rx = (s: string, re: RegExp) => (re.exec(s) || [])[1] || null;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const authHeader = req.headers.get("Authorization") || "";
    const asUser = createClient(SUPABASE_URL, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

    const { apple_id, app_password } = await req.json();
    if (!apple_id || !app_password) return new Response(JSON.stringify({ error: "Missing Apple ID or password." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    // Normalize: Apple app-specific passwords are lowercase; phones auto-capitalize.
    const pw = String(app_password).toLowerCase().replace(/\s+/g, "");
    const email = String(apple_id).trim();
    const auth = basic(email, pw);

    // Discover principal → calendar home
    const p = await dav("PROPFIND", "https://caldav.icloud.com/", auth,
      '<A:propfind xmlns:A="DAV:"><A:prop><A:current-user-principal/></A:prop></A:propfind>', { Depth: "0" });
    if (p.status === 401) return new Response(JSON.stringify({ error: "Apple rejected those credentials. Make sure it's an app-specific password from appleid.apple.com (not your main password)." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const principalPath = rx(p.text, /current-user-principal[^>]*>\s*<href[^>]*>([^<]+)</is);
    if (!principalPath) return new Response(JSON.stringify({ error: "Could not read your iCloud account (no principal). Status " + p.status }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const principalUrl = principalPath.startsWith("http") ? principalPath : "https://caldav.icloud.com" + principalPath;

    const h = await dav("PROPFIND", principalUrl, auth,
      '<A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><A:prop><C:calendar-home-set/></A:prop></A:propfind>', { Depth: "0" });
    const homeUrl = rx(h.text, /calendar-home-set[^>]*>\s*<href[^>]*>([^<]+)</is);
    if (!homeUrl) return new Response(JSON.stringify({ error: "Could not find your iCloud calendar home." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    const origin = new URL(homeUrl).origin;

    // Find or create the dedicated PrismOS calendar
    const list = await dav("PROPFIND", homeUrl, auth,
      '<A:propfind xmlns:A="DAV:"><A:prop><A:displayname/><A:resourcetype/></A:prop></A:propfind>', { Depth: "1" });
    let prismUrl: string | null = null;
    for (const blk of list.text.split(/<response/i).slice(1)) {
      const nm = rx(blk, /displayname[^>]*>([^<]*)</i);
      const href = rx(blk, /<href[^>]*>([^<]+)</i);
      if (nm && nm.trim() === "PrismOS" && href) prismUrl = href.startsWith("http") ? href : origin + href;
    }
    if (!prismUrl) {
      prismUrl = homeUrl.replace(/\/$/, "") + "/prismos-" + crypto.randomUUID().slice(0, 12) + "/";
      const mk = await dav("MKCALENDAR", prismUrl, auth,
        '<?xml version="1.0" encoding="utf-8"?><C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:set><D:prop><D:displayname>PrismOS</D:displayname><C:supported-calendar-component-set><C:comp name="VEVENT"/></C:supported-calendar-component-set></D:prop></D:set></C:mkcalendar>');
      if (mk.status >= 400) return new Response(JSON.stringify({ error: "Could not create the PrismOS calendar (status " + mk.status + ")." }), { status: 400, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE);
    await svc.from("icloud_connections").upsert({
      user_id: user.id, apple_id: email, app_password_enc: await encrypt(pw),
      principal_url: principalUrl, calendar_home_url: homeUrl, prismos_calendar_url: prismUrl,
      enabled: true, status: "connected", last_error: null, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

    return new Response(JSON.stringify({ ok: true, apple_id: email, calendar: "PrismOS" }), { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error)?.message || String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
