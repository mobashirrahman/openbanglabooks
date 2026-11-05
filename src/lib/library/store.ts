"use client";

import { localDB, snapshotOf, type LibraryEntry, type LibraryStatus, type WorkSnapshot } from "@/lib/local/db";

/**
 * The reader's library: reading status, favourites, ratings, private
 * reflections and their own shelves. Plain local writes; the sync outbox
 * picks every change up on its own.
 */

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** Fields that follow from a status change: when a book was started and finished. */
function datesFor(status: LibraryStatus, prev: Partial<LibraryEntry> | undefined, now: number) {
  return {
    startedAt: prev?.startedAt ?? (status === "reading" || status === "finished" || status === "dnf" ? now : null),
    finishedAt: status === "finished" ? (prev?.status === "finished" ? (prev.finishedAt ?? now) : now) : (prev?.finishedAt ?? null),
  };
}

export async function addToLibrary(work: WorkSnapshot, status?: LibraryStatus) {
  const db = localDB();
  await db.transaction("rw", db.library, db.positions, async () => {
    const existing = await db.library.get(work.slug);
    if (existing) return;
    const position = await db.positions.get(work.slug);
    const now = Date.now();
    const s: LibraryStatus = status ?? (position ? (position.finished ? "finished" : "reading") : "want");
    await db.library.put({
      workSlug: work.slug,
      status: s,
      favourite: false,
      rating: null,
      reflection: null,
      addedAt: now,
      ...datesFor(s, undefined, now),
      updatedAt: now,
      work: snapshotOf(work),
    });
  });
}

async function patch(work: WorkSnapshot, change: (entry: LibraryEntry | undefined, now: number) => Partial<LibraryEntry>) {
  const db = localDB();
  await db.transaction("rw", db.library, db.positions, async () => {
    const entry = await db.library.get(work.slug);
    const now = Date.now();
    if (!entry) {
      const position = await db.positions.get(work.slug);
      const status: LibraryStatus = position ? (position.finished ? "finished" : "reading") : "want";
      await db.library.put({
        workSlug: work.slug,
        status,
        favourite: false,
        rating: null,
        reflection: null,
        addedAt: now,
        ...datesFor(status, undefined, now),
        updatedAt: now,
        work: snapshotOf(work),
        ...change(undefined, now),
      });
    } else {
      await db.library.put({ ...entry, ...change(entry, now), updatedAt: now });
    }
  });
}

export const setStatus = (work: WorkSnapshot, status: LibraryStatus) => patch(work, (e, now) => ({ status, ...datesFor(status, e, now) }));
export const setFavourite = (work: WorkSnapshot, favourite: boolean) => patch(work, () => ({ favourite }));
export const setRating = (work: WorkSnapshot, rating: number | null) =>
  patch(work, () => ({ rating: rating && rating >= 1 && rating <= 5 ? Math.round(rating) : null }));
export const setReflection = (work: WorkSnapshot, reflection: string) =>
  patch(work, () => ({ reflection: reflection.trim() ? reflection.slice(0, 20000) : null }));

/** Takes a book out of the library, and off the reader's shelves. */
export async function removeFromLibrary(slug: string) {
  const db = localDB();
  await db.transaction("rw", db.library, db.shelfItems, async () => {
    await db.library.delete(slug);
    await db.shelfItems.where("workSlug").equals(slug).delete();
  });
}

// ── shelves ────────────────────────────────────────────────────────────────

export const SHELF_NAME_MAX = 80;

export async function createShelf(name: string): Promise<string | null> {
  const clean = name.trim().slice(0, SHELF_NAME_MAX);
  if (!clean) return null;
  const db = localDB();
  const last = await db.shelves.orderBy("position").last();
  const id = newId();
  const now = Date.now();
  await db.shelves.put({ id, name: clean, position: (last?.position ?? 0) + 1, createdAt: now, updatedAt: now });
  return id;
}

export async function renameShelf(id: string, name: string) {
  const clean = name.trim().slice(0, SHELF_NAME_MAX);
  if (clean) await localDB().shelves.update(id, { name: clean });
}

/** Deletes a shelf; its books stay in the library. */
export async function deleteShelf(id: string) {
  const db = localDB();
  await db.transaction("rw", db.shelves, db.shelfItems, async () => {
    await db.shelfItems.where("shelfId").equals(id).delete();
    await db.shelves.delete(id);
  });
}

export const shelfItemId = (shelfId: string, slug: string) => `${shelfId}:${slug}`;

/** Puts a book on a shelf (adding it to the library too), or takes it off. */
export async function setOnShelf(shelfId: string, work: WorkSnapshot, on: boolean) {
  const db = localDB();
  const id = shelfItemId(shelfId, work.slug);
  if (!on) return void (await db.shelfItems.delete(id));
  await addToLibrary(work);
  const now = Date.now();
  await db.shelfItems.put({ id, shelfId, workSlug: work.slug, addedAt: now, updatedAt: now, work: snapshotOf(work) });
}
