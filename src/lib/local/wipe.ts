"use client";

import { localDB, markHasProgress } from "./db";
import { markUntracked } from "./outbox";
import { READER_SETTINGS_KEY } from "@/lib/reader/settings";

/** Tables holding a reader's own data (what an account owns). */
const PERSONAL = ["positions", "remotePositions", "library", "bookmarks", "annotations", "days", "remoteDays", "shelves", "shelfItems", "outbox"] as const;

/**
 * Removes the account's data from this device, without telling the server
 * (an untracked transaction: nothing is pushed as deleted). Used on sign-out
 * and when a different account signs in. Downloaded books and settings stay.
 */
export async function clearAccountData() {
  const db = localDB();
  await db.transaction("rw", [...PERSONAL.map((n) => db.table(n)), db.meta], async (tx) => {
    markUntracked(tx.idbtrans);
    for (const n of PERSONAL) await db.table(n).clear();
    await db.meta.bulkDelete(["owner", "sync-cursor", "last-synced"]);
  });
  markHasProgress(false);
}

/** Empties this device completely (also downloaded books and settings). The account, if any, is untouched. */
export async function wipeDevice() {
  const db = localDB();
  await clearAccountData();
  await db.transaction("rw", db.files, db.settings, async (tx) => {
    markUntracked(tx.idbtrans);
    await db.files.clear();
    await db.settings.clear();
  });
  try {
    localStorage.removeItem(READER_SETTINGS_KEY);
  } catch {
    /* private mode */
  }
}
