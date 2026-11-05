"use client";

import { useEffect } from "react";
import { useAccount } from "@/lib/account/session";

/**
 * Starts the sync engine once someone is signed in on this device. Readers
 * without an account never download it (nor Supabase).
 */
export function SyncAgent() {
  const account = useAccount();
  const signedIn = account.status === "signed-in";
  useEffect(() => {
    if (signedIn) void import("@/lib/sync/engine").then((m) => m.startSync());
  }, [signedIn]);
  return null;
}
