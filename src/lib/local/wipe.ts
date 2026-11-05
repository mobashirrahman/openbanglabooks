"use client";

import { localDB, markHasProgress } from "./db";
import { markUntracked } from "./outbox";
import { READER_SETTINGS_KEY } from "@/lib/reader/settings";
import { forgetOfflinePages } from "@/lib/offline/pages";

/** Tables holding a reader's own data (what an account owns). */
const PERSONAL = ["positions", "remotePositions", "library", "bookmarks", "annotations", "days", "remoteDays", "shelves", "shelfItems", "outbox", "personalBooks"] as const;
/** Of those, the tables whose rows belong to one book (by `workSlug`, or the book's own id). */
const PER_BOOK = new Set(["positions", "library", "bookmarks", "annotations", "personalBooks"]);

/**
 * Removes the account's data from this device, without telling the server
 * (an untracked transaction: nothing is pushed as deleted). Used on sign-out
 * and when a different account signs in. Downloaded books and settings stay.
 *
 * The reader's own books kept on this device only were never in the account,
 * and this device holds their only copy: they stay, with their highlights,
 * notes and place. "Clear this device" (wipeDevice) removes them too.
 */
export async function clearAccountData() {
  const db = localDB();
  const kept = (await db.personalBooks.filter((b) => !b.cloud).toArray().catch(() => [])) ?? [];
  const keep = new Set(kept.map((b) => b.id));
  const accountBooks = await db.personalBooks.filter((b) => b.cloud).toArray().catch(() => []);
  await db.transaction("rw", [...PERSONAL.map((n) => db.table(n)), db.meta, db.personalCovers, db.files], async (tx) => {
    markUntracked(tx.idbtrans);
    for (const n of PERSONAL) {
      const table = db.table(n);
      if (!keep.size || !PER_BOOK.has(n)) await table.clear();
      else await table.filter((row: { workSlug?: string; id?: string }) => !keep.has(row.workSlug ?? row.id ?? "")).delete();
    }
    // the account's own books: their files and covers go with it
    for (const b of accountBooks) {
      await db.personalCovers.delete(b.id);
      await db.files.delete(b.fileSha);
    }
    await db.meta.bulkDelete(["owner", "sync-cursor", "last-synced"]);
  });
  markHasProgress((await db.positions.count()) > 0);
}

/** Empties this device completely (also downloaded books, the reader's own books, pages kept offline and settings). The account, if any, is untouched. */
export async function wipeDevice() {
  const db = localDB();
  await clearAccountData();
  await db.transaction("rw", [...PERSONAL.map((n) => db.table(n)), db.files, db.settings, db.personalCovers], async (tx) => {
    markUntracked(tx.idbtrans);
    for (const n of PERSONAL) await db.table(n).clear();
    await db.files.clear();
    await db.settings.clear();
    await db.personalCovers.clear();
  });
  markHasProgress(false);
  await forgetOfflinePages().catch(() => {});
  try {
    localStorage.removeItem(READER_SETTINGS_KEY);
  } catch {
    /* private mode */
  }
}
