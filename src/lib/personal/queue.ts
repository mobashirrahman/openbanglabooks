"use client";

import { localDB, type PersonalBook } from "@/lib/local/db";
import { outboxKey, stamp, type OutboxEntry, type SyncedTable } from "@/lib/local/outbox";

/**
 * Queues every row of one of the reader's own books for the next push. Used
 * when a book kept on this device moves into the account: its reading data
 * was never sent (sync skips device-only books), so it is sent now.
 */
export async function requeueBook(id: string) {
  const db = localDB();
  const now = stamp();
  await db.transaction("rw", [db.library, db.positions, db.bookmarks, db.annotations, db.shelfItems, db.personalBooks, db.outbox], async () => {
    const entries: OutboxEntry[] = [];
    const add = (t: SyncedTable, pk: unknown) => entries.push({ key: outboxKey(t, pk), t, pk: String(pk), changedAt: now, deleted: false });
    if (await db.personalBooks.get(id)) add("personalBooks", id);
    if (await db.library.get(id)) add("library", id);
    if (await db.positions.get(id)) add("positions", id);
    for (const k of await db.bookmarks.where("workSlug").equals(id).primaryKeys()) add("bookmarks", k);
    for (const k of await db.annotations.where("workSlug").equals(id).primaryKeys()) add("annotations", k);
    for (const k of await db.shelfItems.where("workSlug").equals(id).primaryKeys()) add("shelfItems", k);
    await db.outbox.bulkPut(entries);
  });
}

/** Drops the cover and file of own books that are gone (removed here or on another device). */
export async function forgetPersonalFiles(books: Pick<PersonalBook, "id" | "fileSha">[]) {
  const db = localDB();
  for (const b of books) {
    await db.personalCovers.delete(b.id);
    const stillUsed = b.fileSha ? await db.personalBooks.filter((x) => x.fileSha === b.fileSha).count() : 1;
    if (!stillUsed) await db.files.delete(b.fileSha);
  }
}
