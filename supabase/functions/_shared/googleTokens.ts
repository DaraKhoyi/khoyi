// googleTokens.ts — Google OAuth tokens are encrypted at rest (8 Oct 2026,
// Google verification packet: "encrypt the tokens").
//
// WHAT IS STORED
//   email_accounts.access_token / refresh_token hold either the plain token
//   (every row before this change) or "enc:v1:" + base64(iv ‖ AES-256-GCM
//   ciphertext). The field name is the GCM additional data, so a sealed
//   refresh_token cannot be pasted into access_token and still open.
//   has_refresh_token (a generated column, "refresh_token is not null") keeps
//   working either way.
//
// THE KEY
//   GOOGLE_TOKEN_KEY: 32 random bytes, base64. An edge-function secret only; it
//   is never in the database, so a database dump or a leaked backup holds no
//   usable Google token. GOOGLE_TOKEN_KEY_PREVIOUS (optional) still opens values
//   sealed with the key before a rotation.
//   NEVER unset GOOGLE_TOKEN_KEY while any row is sealed. Run google-token-seal
//   {"mode":"unseal"} first (see ROLLBACK in google-token-seal/index.ts).
//
// HOW FUNCTIONS USE IT
//   One line per client: createClient(URL, KEY, withTokenCrypto()). The client's
//   fetch then
//     - OPENS every sealed access_token / refresh_token in any REST response, at
//       any depth (embedded selects included). Plain values pass through as they
//       are, which is what makes the rollout safe in either order.
//     - SEALS access_token / refresh_token in insert / update / upsert bodies
//       sent to email_accounts, but only once GOOGLE_TOKEN_KEY is set. With no
//       key, it writes plain text exactly as before.
//   A sealed value that will not open (key missing or wrong) makes the query
//   FAIL (HTTP 500, code TOKEN_DECRYPT), so the caller sees a database error.
//   It never sees a garbage token that it might send to Google, get
//   invalid_grant back, and wrongly mark the account "needs reconnecting".
//   smoke/token_crypto_guard.mjs fails the gate if a function that reads
//   email_accounts tokens builds a client without withTokenCrypto().

export const SEALED_PREFIX = "enc:v1:";
export const TOKEN_FIELDS = ["access_token", "refresh_token"] as const;
const SEAL_TABLES = /\/rest\/v1\/email_accounts(?:\?|$)/;

const enc = new TextEncoder();
const dec = new TextDecoder();
const keyCache = new Map<string, Promise<CryptoKey | null>>();

function b64decode(s: string) {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64encode(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function importKey(raw: string | undefined): Promise<CryptoKey | null> {
  const k = (raw || "").trim();
  if (!k) return Promise.resolve(null);
  if (!keyCache.has(k)) {
    keyCache.set(k, (async () => {
      const bytes = b64decode(k);
      if (bytes.length !== 32) throw new Error("GOOGLE_TOKEN_KEY must be 32 bytes, base64-encoded");
      return await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
    })());
  }
  return keyCache.get(k)!;
}
const currentKey = () => importKey(Deno.env.get("GOOGLE_TOKEN_KEY"));
const previousKey = () => importKey(Deno.env.get("GOOGLE_TOKEN_KEY_PREVIOUS"));

/** True once GOOGLE_TOKEN_KEY is set (new writes are sealed). */
export async function sealingEnabled(): Promise<boolean> {
  return (await currentKey()) !== null;
}

export function isSealed(v: unknown): v is string {
  return typeof v === "string" && v.startsWith(SEALED_PREFIX);
}

/** Seal one token. Already-sealed values, null and empty strings are returned unchanged. */
export async function sealToken(value: string | null | undefined, field: string, key?: CryptoKey | null): Promise<string | null | undefined> {
  if (value == null || value === "" || isSealed(value)) return value;
  const k = key === undefined ? await currentKey() : key;
  if (!k) throw new Error("GOOGLE_TOKEN_KEY is not set");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(field) }, k, enc.encode(value)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0); out.set(ct, iv.length);
  return SEALED_PREFIX + b64encode(out);
}

/** Open one token. Plain values are returned unchanged; a sealed value that cannot be opened THROWS. */
export async function openToken(value: string | null | undefined, field: string): Promise<string | null | undefined> {
  if (!isSealed(value)) return value;
  const raw = b64decode(value.slice(SEALED_PREFIX.length));
  const iv = raw.slice(0, 12), ct = raw.slice(12);
  for (const k of [await currentKey(), await previousKey()]) {
    if (!k) continue;
    try {
      return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: enc.encode(field) }, k, ct));
    } catch { /* try the next key */ }
  }
  throw new Error(`A stored Google ${field} could not be decrypted (GOOGLE_TOKEN_KEY missing or wrong)`);
}

async function openDeep(node: unknown): Promise<void> {
  if (Array.isArray(node)) { for (const n of node) await openDeep(n); return; }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  for (const [k, v] of Object.entries(o)) {
    if ((TOKEN_FIELDS as readonly string[]).includes(k) && isSealed(v)) o[k] = await openToken(v, k);
    else if (v && typeof v === "object") await openDeep(v);
  }
}

async function sealRows(node: unknown, key: CryptoKey): Promise<void> {
  const rows = Array.isArray(node) ? node : [node];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    for (const f of TOKEN_FIELDS) {
      if (typeof o[f] === "string") o[f] = await sealToken(o[f] as string, f, key);
    }
  }
}

function urlOf(input: Request | URL | string): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** fetch for supabase-js: seals token writes to email_accounts, opens sealed tokens in REST responses. */
export async function tokenFetch(input: Request | URL | string, init?: RequestInit): Promise<Response> {
  const url = urlOf(input);
  if (!url.includes("/rest/v1/")) return fetch(input, init);

  let nextInit = init;
  const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (SEAL_TABLES.test(url) && (method === "POST" || method === "PATCH" || method === "PUT")
      && typeof init?.body === "string" && /"(access|refresh)_token"/.test(init.body)) {
    const key = await currentKey();
    if (key) {
      const body = JSON.parse(init.body);
      await sealRows(body, key);
      nextInit = { ...init, body: JSON.stringify(body) };
    }
  }

  const res = await fetch(input, nextInit);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) return res;
  const text = await res.clone().text();
  if (!text.includes(SEALED_PREFIX)) return res;
  const data = JSON.parse(text);
  try {
    await openDeep(data);
  } catch (e) {
    // Answer like PostgREST does for a failed query, so the caller gets
    // { data: null, error } at once (a thrown fetch would be retried as a
    // network error, and no caller could mistake this for an empty result).
    return new Response(JSON.stringify({
      code: "TOKEN_DECRYPT", message: String((e as Error).message || e), details: null, hint: "Set GOOGLE_TOKEN_KEY (and GOOGLE_TOKEN_KEY_PREVIOUS after a rotation).",
    }), { status: 500, headers: { "content-type": "application/json" } });
  }
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(JSON.stringify(data), { status: res.status, statusText: res.statusText, headers });
}

// deno-lint-ignore no-explicit-any
type ClientOptions = Record<string, any>;
/** Merge into createClient options: createClient(URL, KEY, withTokenCrypto({ global: { headers } })). */
export function withTokenCrypto(opts: ClientOptions = {}): ClientOptions {
  return { ...opts, global: { ...(opts.global || {}), fetch: tokenFetch } };
}
