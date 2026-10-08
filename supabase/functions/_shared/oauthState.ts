// _shared/oauthState.ts — the Google OAuth `state` value, signed.
//
// WHY THIS EXISTS (8 Oct 2026). `state` used to be plain base64 JSON:
// { uid, rt, purpose, ts }. The callback decoded it and believed it. Anyone who
// knew a PrismOS user's internal id could build their own state, send a Google
// consent link with it, and the callback would attach whatever Google account
// finished that flow to the named user — and send the browser to whatever `rt`
// said (an open redirect on our own Supabase domain). Nothing was checked.
//
// Now the state is `v1.<payload>.<signature>`:
//   payload   = base64url(JSON { uid, rt, p, n, exp })
//   signature = base64url(HMAC-SHA256(key, "v1." + payload))
// The start function issues it ONLY for the user in the caller's JWT, the
// callback rejects anything unsigned, tampered with, or older than STATE_TTL_MS,
// and the return address must be one of our own origins.
//
// KEY. A dedicated secret, OAUTH_STATE_SECRET, is preferred. Until one is set,
// the key is derived from SUPABASE_SERVICE_ROLE_KEY (always present in every
// edge function, never sent to a browser) with a fixed label, so the derived
// key is useless for anything except signing this state. Setting
// OAUTH_STATE_SECRET later only voids flows started in the previous 15 minutes.

export const STATE_TTL_MS = 15 * 60 * 1000;
export const DEFAULT_RETURN = "https://darasapp.com/";

// Where the callback may send the browser afterwards. Production, the staging
// site, and a developer's own machine. Nothing else.
const ALLOWED_RETURN_ORIGINS = new Set([
  "https://darasapp.com",
  "https://www.darasapp.com",
  "https://darakhoyi.github.io",
]);
function isLocalDev(u: URL) {
  return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
}

/** A safe return address: the given one if it is ours, otherwise the app home. */
export function safeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return DEFAULT_RETURN;
  try {
    const u = new URL(raw);
    if (u.username || u.password) return DEFAULT_RETURN;
    if (!ALLOWED_RETURN_ORIGINS.has(u.origin) && !isLocalDev(u)) return DEFAULT_RETURN;
    u.hash = "";
    return u.toString();
  } catch (_) {
    return DEFAULT_RETURN;
  }
}

const enc = new TextEncoder();

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function bytesFromB64url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

let cachedKey: CryptoKey | null = null;
async function signingKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const dedicated = Deno.env.get("OAUTH_STATE_SECRET");
  let raw: Uint8Array;
  if (dedicated && dedicated.length >= 32) {
    raw = enc.encode(dedicated);
  } else {
    const base = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!base) throw new Error("OAuth state key unavailable");
    // Domain-separated subkey: HMAC(base, label). Never the base key itself.
    const baseKey = await crypto.subtle.importKey("raw", enc.encode(base), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    raw = new Uint8Array(await crypto.subtle.sign("HMAC", baseKey, enc.encode("prismos/google-oauth-state/v1")));
  }
  cachedKey = await crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  return cachedKey;
}

export type OAuthState = { uid: string; rt: string; purposes: string[] };

/** Issue a signed state for an AUTHENTICATED user id (from their JWT, never the body). */
export async function signState(s: OAuthState, now = Date.now()): Promise<string> {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const body = {
    uid: s.uid,
    rt: safeReturnTo(s.rt),
    p: s.purposes,
    n: b64urlFromBytes(nonce),
    exp: now + STATE_TTL_MS,
  };
  const payload = b64urlFromBytes(enc.encode(JSON.stringify(body)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await signingKey(), enc.encode("v1." + payload)));
  return `v1.${payload}.${b64urlFromBytes(sig)}`;
}

/** Verify a state from the callback. Throws on anything not issued by us, or expired. */
export async function verifyState(state: string, now = Date.now()): Promise<OAuthState> {
  const parts = (state || "").split(".");
  if (parts.length !== 3 || parts[0] !== "v1" || !parts[1] || !parts[2]) {
    throw new Error("This connection link is not valid. Start again from Settings.");
  }
  let sigBytes: Uint8Array;
  try { sigBytes = bytesFromB64url(parts[2]); } catch (_) { throw new Error("This connection link is not valid. Start again from Settings."); }
  // crypto.subtle.verify compares in constant time.
  const ok = await crypto.subtle.verify("HMAC", await signingKey(), sigBytes as BufferSource, enc.encode("v1." + parts[1]));
  if (!ok) throw new Error("This connection link is not valid. Start again from Settings.");
  let body: any;
  try { body = JSON.parse(new TextDecoder().decode(bytesFromB64url(parts[1]))); }
  catch (_) { throw new Error("This connection link is not valid. Start again from Settings."); }
  if (!body || typeof body.uid !== "string" || !body.uid || typeof body.exp !== "number") {
    throw new Error("This connection link is not valid. Start again from Settings.");
  }
  if (now > body.exp) throw new Error("This connection link expired. Start again from Settings.");
  return {
    uid: body.uid,
    rt: safeReturnTo(body.rt),
    purposes: Array.isArray(body.p) ? body.p.filter((x: unknown) => typeof x === "string") : [],
  };
}

/** Escape text for the small HTML pages the callbacks render. */
export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
