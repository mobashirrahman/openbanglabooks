"use client";

import { useSyncExternalStore } from "react";
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Who is signed in on this device, as a tiny external store. Reading needs
 * no account: when this browser holds no session cookie the Supabase library
 * is never downloaded, and the state is "signed-out" straight away. The
 * library is loaded on demand (sign-in form, or an existing session).
 */

export type AccountUser = { id: string; email: string | null };
export type AccountState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "signed-in"; user: AccountUser };

const LOADING: AccountState = { status: "loading" };
let state: AccountState = LOADING;
const listeners = new Set<() => void>();
let started: Promise<SupabaseClient> | null = null;
const enabled = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

function emit(next: AccountState) {
  const same =
    state.status === next.status &&
    (state.status !== "signed-in" || (next.status === "signed-in" && state.user.id === next.user.id && state.user.email === next.user.email));
  if (same) return;
  state = next;
  for (const l of listeners) l();
}

const toUser = (u: User): AccountUser => ({ id: u.id, email: u.email ?? null });

/** True when this browser holds a Supabase session cookie (checked without loading the library). */
export function hasSessionCookie() {
  return typeof document !== "undefined" && /(?:^|;\s*)sb-[^=;]+-auth-token(?:\.0)?=/.test(document.cookie);
}

/** The Supabase client, loading it on first use and starting to follow the session. */
export function getSupabase(): Promise<SupabaseClient> {
  started ??= import("@/lib/supabase/browser").then(({ supabaseBrowser }) => {
    const sb = supabaseBrowser();
    // fires INITIAL_SESSION straight away, then on every sign-in, refresh and sign-out
    sb.auth.onAuthStateChange((_event, session) => {
      emit(session?.user ? { status: "signed-in", user: toUser(session.user) } : { status: "signed-out" });
    });
    return sb;
  });
  return started;
}

function settle() {
  if (started) return;
  if (enabled && hasSessionCookie()) void getSupabase();
  else emit({ status: "signed-out" });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  queueMicrotask(settle);
  // a sign-in in another tab: pick it up when this one comes back into view
  const onVisible = () => document.visibilityState === "visible" && settle();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    listeners.delete(listener);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function useAccount(): AccountState {
  return useSyncExternalStore(subscribe, () => state, () => LOADING);
}

export function accountState(): AccountState {
  return state;
}

/** Waits until the session state is known (for non-React callers such as sync). */
export function onAccountChange(listener: (s: AccountState) => void): () => void {
  const wrapped = () => listener(state);
  const unsubscribe = subscribe(wrapped);
  if (state.status !== "loading") queueMicrotask(wrapped);
  return unsubscribe;
}

export const accountsEnabled = enabled;

/** Signs out on this device only (other devices stay signed in). */
export async function signOut() {
  const sb = await getSupabase();
  await sb.auth.signOut({ scope: "local" });
  emit({ status: "signed-out" });
}
