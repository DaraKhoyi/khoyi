// icloudCredential.ts — the only way an edge function touches an iCloud password.
//
// Since 27 Sep 2026 the encryption key lives in Supabase Vault ('icloud_key'),
// not in any function's environment: encryption and decryption happen inside
// the database through icloud_set_password / icloud_get_password, which only the
// service role may call. See supabase/sql/2026-09-27_credential_isolation.sql.
//
// appleUrl() is the other half. icloud-sync sends the Apple ID + app password to
// the stored calendar URL on every run. A URL that is not Apple's — typed in by
// a hijacked session, or returned by a spoofed response — would hand the
// credential to a stranger. So credentials only ever go to https://*.icloud.com.

export function appleUrl(u: string | null | undefined): string | null {
  try {
    const url = new URL(String(u || ""));
    if (url.protocol !== "https:") return null;
    const h = url.hostname.toLowerCase();
    return h === "icloud.com" || h.endsWith(".icloud.com") ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function setIcloudPassword(svc: any, userId: string, password: string): Promise<void> {
  const { error } = await svc.rpc("icloud_set_password", { p_user: userId, p_password: password });
  if (error) throw new Error("could not store the iCloud password: " + error.message);
}

export async function getIcloudPassword(svc: any, userId: string): Promise<string | null> {
  const { data, error } = await svc.rpc("icloud_get_password", { p_user: userId });
  if (error) throw new Error("could not read the iCloud password: " + error.message);
  return (data as string) || null;
}
