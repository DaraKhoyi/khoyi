// deno test --allow-env --allow-net supabase/functions/_shared/googleTokens.test.ts
// Runs the REAL supabase-js client against a local stand-in for PostgREST.
import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isSealed, openToken, SEALED_PREFIX, sealToken, withTokenCrypto } from "./googleTokens.ts";

const KEY_A = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const KEY_B = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const setKey = (k?: string, prev?: string) => {
  k ? Deno.env.set("GOOGLE_TOKEN_KEY", k) : Deno.env.delete("GOOGLE_TOKEN_KEY");
  prev ? Deno.env.set("GOOGLE_TOKEN_KEY_PREVIOUS", prev) : Deno.env.delete("GOOGLE_TOKEN_KEY_PREVIOUS");
};

// Minimal PostgREST: GET returns `rows`, POST/PATCH record the body they got.
let rows: Record<string, unknown>[] = [];
let lastBody: unknown = null;
const server = Deno.serve({ port: 0, onListen() {} }, async (req) => {
  const u = new URL(req.url);
  if (req.method === "GET") {
    const single = (req.headers.get("accept") || "").includes("vnd.pgrst.object");
    return Response.json(single ? rows[0] : rows);
  }
  lastBody = JSON.parse(await req.text());
  if (u.pathname.startsWith("/rest/v1/")) return new Response(null, { status: 204 });
  return new Response("?", { status: 404 });
});
const URL_ = `http://localhost:${server.addr.port}`;
const db = () => createClient(URL_, "service-key", withTokenCrypto({ auth: { persistSession: false } }));

Deno.test("seal/open round trip; field name is bound in", async () => {
  setKey(KEY_A);
  const s = (await sealToken("1//refresh-abc", "refresh_token"))!;
  assert(s.startsWith(SEALED_PREFIX) && !s.includes("refresh-abc"));
  assertEquals(await openToken(s, "refresh_token"), "1//refresh-abc");
  await assertRejects(() => openToken(s, "access_token")); // swapped field will not open
  assertEquals(await sealToken(s, "refresh_token"), s);      // never double-sealed
  assertEquals(await openToken("plain", "refresh_token"), "plain");
  assertEquals(await sealToken(null, "refresh_token"), null);
});

Deno.test("reads: sealed values are opened (list, single, embedded); plain pass through", async () => {
  setKey(KEY_A);
  rows = [
    { id: "1", access_token: await sealToken("ya29.A", "access_token"), refresh_token: await sealToken("1//R", "refresh_token") },
    { id: "2", access_token: "ya29.plain", refresh_token: "1//plain", owner: { refresh_token: await sealToken("1//E", "refresh_token") } },
  ];
  const { data, error } = await db().from("email_accounts").select("*");
  assertEquals(error, null);
  assertEquals(data![0].access_token, "ya29.A");
  assertEquals(data![0].refresh_token, "1//R");
  assertEquals(data![1].refresh_token, "1//plain");
  assertEquals(data![1].owner.refresh_token, "1//E");
  const one = await db().from("email_accounts").select("*").eq("id", "1").single();
  assertEquals(one.data!.refresh_token, "1//R");
});

Deno.test("writes: sealed only once the key is set, and only for email_accounts", async () => {
  setKey(undefined);
  await db().from("email_accounts").update({ access_token: "ya29.X", token_expires_at: "t" }).eq("id", "1");
  assertEquals((lastBody as Record<string, unknown>).access_token, "ya29.X");

  setKey(KEY_A);
  await db().from("email_accounts").update({ access_token: "ya29.X", token_expires_at: "t" }).eq("id", "1");
  const b = lastBody as Record<string, string>;
  assert(isSealed(b.access_token)); assertEquals(b.token_expires_at, "t");
  assertEquals(await openToken(b.access_token, "access_token"), "ya29.X");

  await db().from("email_accounts").insert([{ user_id: "u", refresh_token: "1//N", access_token: null }]);
  const ins = (lastBody as Record<string, string>[])[0];
  assert(isSealed(ins.refresh_token)); assertEquals(ins.access_token, null);

  await db().from("cloud_tokens").update({ access_token: "dropbox" }).eq("connection_id", "c");
  assertEquals((lastBody as Record<string, string>).access_token, "dropbox");
});

Deno.test("a value that will not open fails the query instead of handing back ciphertext", async () => {
  setKey(KEY_A);
  rows = [{ id: "1", refresh_token: await sealToken("1//R", "refresh_token") }];
  setKey(KEY_B);
  const r = await db().from("email_accounts").select("*").then((x) => x, (e) => ({ data: null, error: e }));
  assertEquals(r.data, null);
  assertEquals((r.error as { code?: string }).code, "TOKEN_DECRYPT");
  setKey(undefined);
  const r2 = await db().from("email_accounts").select("*").then((x) => x, (e) => ({ data: null, error: e }));
  assertEquals(r2.data, null);
});

Deno.test("key rotation: GOOGLE_TOKEN_KEY_PREVIOUS still opens old values", async () => {
  setKey(KEY_A);
  const old = (await sealToken("1//R", "refresh_token"))!;
  setKey(KEY_B, KEY_A);
  assertEquals(await openToken(old, "refresh_token"), "1//R");
});

Deno.test({ name: "stop stub server", fn: async () => { await server.shutdown(); }, sanitizeOps: false, sanitizeResources: false });
