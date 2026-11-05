import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export type EditorSession = {
  supabase: Awaited<ReturnType<typeof supabaseServer>>;
  user: { id: string; email: string | null };
  role: "editor" | "admin";
};

export type Gate = { kind: "signed-out" } | { kind: "forbidden"; email: string | null } | ({ kind: "editor" } & EditorSession);

/**
 * Who is asking, checked with the auth server (not just the cookie) and
 * the profile's role. Every admin page, action and upload goes through
 * this; row level security is the second, independent check. Cached per
 * request (the layout and the page ask once).
 */
export const adminGate = cache(async function adminGate(): Promise<Gate> {
  // request time only: the auth client reads the clock (token expiry), which
  // must never happen in a prerender
  await connection();
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { kind: "signed-out" };
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  const role = profile?.role as string | undefined;
  if (role !== "editor" && role !== "admin") return { kind: "forbidden", email: user.email ?? null };
  return { kind: "editor", supabase, user: { id: user.id, email: user.email ?? null }, role };
});

export class AdminError extends Error {
  constructor(public code: "signed-out" | "forbidden") {
    super(code);
  }
}

/** For actions and route handlers: an editor session, or an AdminError. */
export async function requireEditor(): Promise<EditorSession> {
  const gate = await adminGate();
  if (gate.kind === "signed-out") throw new AdminError("signed-out");
  if (gate.kind === "forbidden") throw new AdminError("forbidden");
  return gate;
}
