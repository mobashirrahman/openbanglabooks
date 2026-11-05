"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The browser's Supabase client. Sessions live in cookies (not
 * localStorage) so server code – the admin pages and their actions – sees
 * the same signed-in user. Loaded lazily: catalog pages never pay for it
 * unless the reader has signed in on this device.
 */
let client: SupabaseClient | null = null;

export function supabaseBrowser(): SupabaseClient {
  client ??= createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: "pkce", detectSessionInUrl: false },
  });
  return client;
}
