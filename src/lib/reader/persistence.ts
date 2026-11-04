"use client";

import { localDB, markHasProgress, snapshotOf, type WorkSnapshot } from "@/lib/local/db";

export type PositionUpdate = {
  cfi: string;
  fraction: number;
  chapter: string | null;
  finished?: boolean;
};

/**
 * Saves the reading position locally. Positions are stored as EPUB CFIs
 * (stable across fonts, sizes and devices) – never as page numbers.
 */
export async function savePosition(work: WorkSnapshot, fileSha: string, update: PositionUpdate) {
  const db = localDB();
  const now = Date.now();
  const existing = await db.positions.get(work.slug);
  await db.positions.put({
    workSlug: work.slug,
    fileSha,
    cfi: update.cfi,
    fraction: update.fraction,
    chapter: update.chapter,
    finished: update.finished ?? existing?.finished ?? false,
    updatedAt: now,
    openedAt: existing?.openedAt ?? now,
    work: snapshotOf(work),
  });
  // a book being read moves to "reading" in the local library
  const entry = await db.library.get(work.slug);
  if (entry && entry.status === "want") await db.library.update(work.slug, { status: "reading", updatedAt: now });
  if (update.finished && entry) await db.library.update(work.slug, { status: "finished", updatedAt: now });
  markHasProgress(true);
}

export async function touchOpened(slug: string) {
  await localDB()
    .positions.update(slug, { openedAt: Date.now() })
    .catch(() => {});
}

export async function getPosition(slug: string, fileSha: string) {
  const p = await localDB().positions.get(slug).catch(() => undefined);
  // a CFI only applies to the exact file it was taken from
  return p && p.fileSha === fileSha ? p : null;
}

export async function addBookmark(
  work: WorkSnapshot,
  fileSha: string,
  b: { cfi: string; fraction: number; chapter: string | null; excerpt: string },
) {
  await localDB().bookmarks.put({
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    workSlug: work.slug,
    fileSha,
    ...b,
    createdAt: Date.now(),
    work: snapshotOf(work),
  });
}
