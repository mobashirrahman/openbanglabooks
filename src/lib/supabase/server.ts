import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * A per-request Supabase client acting as the signed-in user (cookie
 * session), for route handlers, server actions and the admin pages. Row
 * level security applies exactly as in the browser.
 */
export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll(list) {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // called from a Server Component, where cookies are read-only: the
          // proxy refreshes sessions for the pages that need them
        }
      },
    },
  });
}
