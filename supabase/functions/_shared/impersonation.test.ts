// deno test --allow-env supabase/functions/_shared/impersonation.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sessionIdFromJwt, isImpersonatedRequest } from "./impersonation.ts";

const b64u = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const jwt = (payload: unknown) => `${b64u({ alg: "HS256" })}.${b64u(payload)}.sig`;
const SID = "0b0e7f3c-1d2e-4f50-8a9b-0c1d2e3f4a5b";

function fakeAdmin(rows: unknown[] | null, error: unknown = null) {
  return { from: () => ({ select: () => ({ eq: (_c: string, v: string) => ({ limit: async () => ({ data: rows === null ? null : rows.filter((r: any) => r.session_id === v), error }) }) }) }) };
}

Deno.test("reads session_id from a bearer token", () => {
  assertEquals(sessionIdFromJwt("Bearer " + jwt({ sub: "u", session_id: SID })), SID);
  assertEquals(sessionIdFromJwt(jwt({ sub: "u" })), null);
  assertEquals(sessionIdFromJwt(jwt({ session_id: "not-a-uuid" })), null);
  assertEquals(sessionIdFromJwt("garbage"), null);
  assertEquals(sessionIdFromJwt(""), null);
});

Deno.test("a recorded session is a support session", async () => {
  assertEquals(await isImpersonatedRequest(fakeAdmin([{ session_id: SID }]), jwt({ session_id: SID })), true);
});

Deno.test("the agent's own session is not", async () => {
  assertEquals(await isImpersonatedRequest(fakeAdmin([{ session_id: SID }]), jwt({ session_id: "11111111-1111-4111-8111-111111111111" })), false);
});

Deno.test("service-role / cron tokens (no session) are not", async () => {
  assertEquals(await isImpersonatedRequest(fakeAdmin([]), jwt({ role: "service_role" })), false);
});

Deno.test("a failed lookup fails closed", async () => {
  assertEquals(await isImpersonatedRequest(fakeAdmin(null, { message: "boom" }), jwt({ session_id: SID })), true);
});
