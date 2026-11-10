"use client";

export type OAuthProvider = "google" | "facebook";

/**
 * Which social providers the Supabase project has credentials for. The public
 * settings endpoint tells us, so a provider that has not been configured asks
 * for a friendly message instead of sending the reader to an error page.
 * Unknown (offline, endpoint blocked) is treated as available: a configured
 * provider should still work.
 */
let settings: Promise<Partial<Record<OAuthProvider, boolean>> | null> | null = null;

function externalProviders() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Promise.resolve(null);
  settings ??= fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
    .then(async (res) => (res.ok ? (((await res.json()) as { external?: Partial<Record<OAuthProvider, boolean>> }).external ?? {}) : null))
    .catch(() => null);
  return settings;
}

export async function providerEnabled(provider: OAuthProvider): Promise<boolean> {
  const external = await externalProviders();
  return external?.[provider] ?? true;
}
