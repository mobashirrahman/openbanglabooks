"use client";

import { localDB, snapshotOf, type LibraryEntry, type LibraryStatus, type WorkSnapshot } from "@/lib/local/db";
import { SHELF_NAME_MAX } from "@/lib/library/store";
import { isPersonal } from "@/lib/personal/ids";
import type { ExportBook, GoodreadsBook } from "./goodreads";

/**
 * Bringing a Goodreads library in, and ours out, on this device. Plain
 * local writes, like every other library change: the outbox syncs them
 * when the reader is signed in.
 */

export type ApplyOptions = {
  /** recreate the reader's Goodreads shelves here */
  shelves: boolean;
  /** bring reviews in as private reflections */
  reviews: boolean;
  /** for books already in the library: take Goodreads' status, dates and rating */
  replace: boolean;
};
export type ApplyResult = { added: number; updated: number; unchanged: number; shelves: number };

const RANK: Record<LibraryStatus, number> = { want: 0, dnf: 1, reading: 2, finished: 3 };

/** Two Goodreads rows for one of our books (two editions read): the furthest status, the best of each field. */
function merge(a: GoodreadsBook, b: GoodreadsBook): GoodreadsBook {
  const first = RANK[b.status] > RANK[a.status] ? b : a;
  return {
    ...first,
    rating: a.rating ?? b.rating,
    favourite: a.favourite || b.favourite,
    shelves: [...new Set([...a.shelves, ...b.shelves])],
    dateRead: Math.max(a.dateRead ?? 0, b.dateRead ?? 0) || null,
    dateAdded: Math.min(a.dateAdded ?? Infinity, b.dateAdded ?? Infinity) === Infinity ? null : Math.min(a.dateAdded ?? Infinity, b.dateAdded ?? Infinity),
    review: a.review ?? b.review,
    privateNotes: a.privateNotes ?? b.privateNotes,
  };
}

function reflectionOf(b: GoodreadsBook): string | null {
  const text = [b.review, b.privateNotes].filter(Boolean).join("\n\n").trim();
  return text ? text.slice(0, 20000) : null;
}

export async function applyGoodreads(
  choices: { book: GoodreadsBook; slug: string }[],
  works: Map<string, WorkSnapshot>,
  opts: ApplyOptions,
): Promise<ApplyResult> {
  const bySlug = new Map<string, GoodreadsBook>();
  for (const { book, slug } of choices) {
    if (!works.has(slug)) continue;
    const prev = bySlug.get(slug);
    bySlug.set(slug, prev ? merge(prev, book) : book);
  }
  const result: ApplyResult = { added: 0, updated: 0, unchanged: 0, shelves: 0 };
  if (!bySlug.size) return result;

  const db = localDB();
  await db.transaction("rw", [db.library, db.positions, db.shelves, db.shelfItems], async () => {
    const now = Date.now();
    const slugs = [...bySlug.keys()];
    const existing = new Map((await db.library.bulkGet(slugs)).filter((e): e is LibraryEntry => !!e).map((e) => [e.workSlug, e]));
    const positions = new Map((await db.positions.bulkGet(slugs)).filter((p) => !!p).map((p) => [p!.workSlug, p!]));
    const entries: LibraryEntry[] = [];

    for (const [slug, b] of bySlug) {
      const work = snapshotOf(works.get(slug)!);
      const prev = existing.get(slug);
      const reflection = opts.reviews ? reflectionOf(b) : null;
      if (!prev) {
        const position = positions.get(slug);
        // this device has read further than Goodreads knows
        const status = position?.finished && b.status !== "finished" ? "finished" : b.status;
        entries.push({
          workSlug: slug,
          status,
          favourite: b.favourite,
          rating: b.rating,
          reflection,
          addedAt: b.dateAdded ?? now,
          startedAt: status === "want" ? null : (position?.openedAt ?? null),
          finishedAt: status === "finished" ? (b.dateRead ?? null) : null,
          updatedAt: now,
          work,
        });
        result.added++;
        continue;
      }
      const next: LibraryEntry = { ...prev };
      if (opts.replace) {
        next.status = b.status;
        if (b.status === "finished") next.finishedAt = b.dateRead ?? prev.finishedAt ?? null;
        if (b.dateAdded && b.dateAdded < prev.addedAt) next.addedAt = b.dateAdded;
        if (b.rating) next.rating = b.rating;
      } else if (!prev.rating && b.rating) next.rating = b.rating;
      if (b.favourite) next.favourite = true;
      // the reader's own words here are never replaced
      if (reflection && !prev.reflection) next.reflection = reflection;
      const changed = (["status", "finishedAt", "addedAt", "rating", "favourite", "reflection"] as const).some((k) => (next[k] ?? null) !== (prev[k] ?? null));
      if (changed) {
        entries.push({ ...next, updatedAt: now });
        result.updated++;
      } else result.unchanged++;
    }
    if (entries.length) await db.library.bulkPut(entries);

    if (opts.shelves) {
      const shelves = await db.shelves.orderBy("position").toArray();
      const byName = new Map(shelves.map((s) => [s.name.toLocaleLowerCase(), s.id]));
      let position = shelves.at(-1)?.position ?? 0;
      const items = [];
      for (const [slug, b] of bySlug)
        for (const raw of b.shelves) {
          const name = raw.trim().slice(0, SHELF_NAME_MAX);
          if (!name) continue;
          let id = byName.get(name.toLocaleLowerCase());
          if (!id) {
            id = crypto.randomUUID();
            byName.set(name.toLocaleLowerCase(), id);
            await db.shelves.put({ id, name, position: ++position, createdAt: now, updatedAt: now });
            result.shelves++;
          }
          items.push({ id: `${id}:${slug}`, shelfId: id, workSlug: slug, addedAt: now, updatedAt: now, work: snapshotOf(works.get(slug)!) });
        }
      const have = new Set((await db.shelfItems.bulkGet(items.map((i) => i.id))).filter(Boolean).map((i) => i!.id));
      const fresh = items.filter((i) => !have.has(i.id));
      if (fresh.length) await db.shelfItems.bulkPut(fresh);
    }
  });
  return result;
}

/** What our catalogue knows about a book for the export: its English title and author. */
export type ExportNames = { title_en: string | null; author_en: string | null; year: number | null };

/** Every book in the library (and every book opened), ready for goodreadsCsv. */
export async function exportBooks(names: Map<string, ExportNames>, withNotes: boolean): Promise<ExportBook[]> {
  const db = localDB();
  const [library, positions, shelves, shelfItems, personal] = await Promise.all([
    db.library.toArray(),
    db.positions.toArray(),
    db.shelves.toArray(),
    db.shelfItems.toArray(),
    db.personalBooks.toArray(),
  ]);
  const shelfName = new Map(shelves.map((s) => [s.id, s.name]));
  const onShelves = new Map<string, string[]>();
  for (const i of shelfItems) {
    const name = shelfName.get(i.shelfId);
    if (name) onShelves.set(i.workSlug, [...(onShelves.get(i.workSlug) ?? []), name]);
  }
  const own = new Map(personal.map((p) => [p.id, p]));

  const books = new Map<string, ExportBook>();
  const add = (slug: string, work: WorkSnapshot, e: Partial<LibraryEntry> & { status: LibraryStatus }) => {
    const n = names.get(slug);
    const p = isPersonal(slug) ? own.get(slug) : undefined;
    const authorBn = work.authors.map((a) => a.name_bn).join(", ");
    books.set(slug, {
      id: slug,
      title: n?.title_en || p?.title || work.title_bn,
      titleBn: work.title_bn,
      author: n?.author_en || p?.author || authorBn,
      authorBn,
      year: n?.year ?? null,
      status: e.status,
      rating: e.rating ?? null,
      favourite: !!e.favourite,
      shelves: onShelves.get(slug) ?? [],
      dateRead: e.status === "finished" ? (e.finishedAt ?? null) : null,
      dateAdded: e.addedAt ?? null,
      notes: withNotes ? (e.reflection ?? null) : null,
    });
  };
  for (const p of positions) add(p.workSlug, p.work, { status: p.finished ? "finished" : "reading", addedAt: p.openedAt });
  for (const e of library) add(e.workSlug, e.work, e);
  return [...books.values()].sort((a, b) => (b.dateAdded ?? 0) - (a.dateAdded ?? 0));
}
