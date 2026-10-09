// deno test supabase/functions/_shared/oauthState.test.ts
// Proves the signed Google OAuth state cannot be forged, altered, replayed late,
// or used to redirect off our own sites.
import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role-key-not-real");
const { signState, verifyState, safeReturnTo, STATE_TTL_MS, escapeHtml } = await import("./oauthState.ts");

const uid = "11111111-2222-3333-4444-555555555555";

Deno.test("round trip keeps uid, return address and purposes", async () => {
  const s = await signState({ uid, rt: "https://darasapp.com/?view=settings", purposes: ["email", "calendar"] });
  const v = await verifyState(s);
  assertEquals(v.uid, uid);
  assertEquals(v.rt, "https://darasapp.com/?view=settings");
  assertEquals(v.purposes, ["email", "calendar"]);
});

Deno.test("the old unsigned base64 state is rejected", async () => {
  const legacy = btoa(JSON.stringify({ uid, rt: "https://evil.example/", purpose: "email", ts: Date.now() }));
  await assertRejects(() => verifyState(legacy));
});

Deno.test("swapping the user id breaks the signature", async () => {
  const s = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"] });
  const [v, payload, sig] = s.split(".");
  const pad = (x: string) => x + "=".repeat((4 - (x.length % 4)) % 4);
  const body = JSON.parse(atob(pad(payload.replace(/-/g, "+").replace(/_/g, "/"))));
  body.uid = "99999999-9999-9999-9999-999999999999";
  const forged = btoa(JSON.stringify(body)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await assertRejects(() => verifyState(`${v}.${forged}.${sig}`));
});

Deno.test("a garbage signature is rejected", async () => {
  const s = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"] });
  const [v, payload] = s.split(".");
  await assertRejects(() => verifyState(`${v}.${payload}.AAAA`));
  await assertRejects(() => verifyState(`${v}.${payload}`));
  await assertRejects(() => verifyState(""));
});

Deno.test("an expired state is rejected", async () => {
  const t0 = Date.now();
  const s = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"] }, t0);
  await verifyState(s, t0 + STATE_TTL_MS - 1000);
  await assertRejects(() => verifyState(s, t0 + STATE_TTL_MS + 1));
});

Deno.test("two states for the same request differ (nonce)", async () => {
  const a = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"] });
  const b = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"] });
  if (a === b) throw new Error("nonce missing");
});

Deno.test("return address is limited to our own origins", () => {
  assertEquals(safeReturnTo("https://darasapp.com/"), "https://darasapp.com/");
  assertEquals(safeReturnTo("https://darakhoyi.github.io/khoyi-staging/"), "https://darakhoyi.github.io/khoyi-staging/");
  assertEquals(safeReturnTo("http://localhost:5173/"), "http://localhost:5173/");
  assertEquals(safeReturnTo("https://evil.example/"), "https://darasapp.com/");
  assertEquals(safeReturnTo("https://darasapp.com.evil.example/"), "https://darasapp.com/");
  assertEquals(safeReturnTo("https://user:pw@darasapp.com/"), "https://darasapp.com/");
  assertEquals(safeReturnTo("javascript:alert(1)"), "https://darasapp.com/");
  assertEquals(safeReturnTo(undefined), "https://darasapp.com/");
});

Deno.test("a state signed with another key is rejected", async () => {
  const s = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"] });
  // Fresh module instance with a different key.
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "a-different-key");
  const mod2 = await import("./oauthState.ts?other=" + Date.now());
  await assertRejects(() => mod2.verifyState(s));
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-only-service-role-key-not-real");
});

Deno.test("error text is escaped on the HTML pages", () => {
  assertEquals(escapeHtml('<script>x</script>"'), "&lt;script&gt;x&lt;/script&gt;&quot;");
});

// The redirect_uri travels in the signed state so the token exchange can repeat
// it exactly (Google rejects a mismatch). Only our own URIs are honoured.
Deno.test("redirect uri round-trips when it is one of ours", async () => {
  const { RELAY_REDIRECT_URI } = await import("./oauthState.ts");
  const s = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"], ru: RELAY_REDIRECT_URI });
  assertEquals((await verifyState(s)).ru, RELAY_REDIRECT_URI);
});

Deno.test("legacy GOOGLE_REDIRECT_URI is honoured, a foreign one is dropped", async () => {
  Deno.env.set("GOOGLE_REDIRECT_URI", "https://example-ref.supabase.co/functions/v1/google-oauth-callback");
  const ok = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"], ru: "https://example-ref.supabase.co/functions/v1/google-oauth-callback" });
  assertEquals((await verifyState(ok)).ru, "https://example-ref.supabase.co/functions/v1/google-oauth-callback");
  const bad = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"], ru: "https://evil.example/cb" });
  assertEquals((await verifyState(bad)).ru, undefined);
  Deno.env.delete("GOOGLE_REDIRECT_URI");
});

Deno.test("a state with no redirect uri (issued before the change) still verifies", async () => {
  const s = await signState({ uid, rt: "https://darasapp.com/", purposes: ["email"] });
  assertEquals((await verifyState(s)).ru, undefined);
});

Deno.test("currentRedirectUri prefers the relay secret and falls back to the legacy one", async () => {
  const { currentRedirectUri } = await import("./oauthState.ts");
  Deno.env.set("GOOGLE_REDIRECT_URI", "https://legacy.example/cb");
  assertEquals(currentRedirectUri(), "https://legacy.example/cb");
  Deno.env.set("GOOGLE_RELAY_REDIRECT_URI", "https://darasapp.com/oauth/google/callback");
  assertEquals(currentRedirectUri(), "https://darasapp.com/oauth/google/callback");
  Deno.env.delete("GOOGLE_RELAY_REDIRECT_URI");
  Deno.env.delete("GOOGLE_REDIRECT_URI");
  assertEquals(currentRedirectUri(), null);
});
