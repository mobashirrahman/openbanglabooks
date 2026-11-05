"use client";

import { useSyncExternalStore } from "react";

/**
 * Sync status as a tiny store, kept apart from the engine so the header can
 * show it without loading Dexie or Supabase.
 */
export type SyncPhase = "off" | "idle" | "syncing" | "offline" | "error";
export type SyncStatus = { phase: SyncPhase; pending: number; lastSyncedAt: number | null };

const OFF: SyncStatus = { phase: "off", pending: 0, lastSyncedAt: null };
let status: SyncStatus = OFF;
const listeners = new Set<() => void>();

export function setSyncStatus(patch: Partial<SyncStatus>) {
  const next = { ...status, ...patch };
  if (next.phase === status.phase && next.pending === status.pending && next.lastSyncedAt === status.lastSyncedAt) return;
  status = next;
  for (const l of listeners) l();
}

export function syncStatus() {
  return status;
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
    () => OFF,
  );
}

/** Asks the engine (if running) to sync now. */
export function requestSyncNow() {
  window.dispatchEvent(new Event("obb:sync-now"));
}
