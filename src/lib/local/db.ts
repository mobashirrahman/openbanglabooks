"use client";

import Dexie, { type EntityTable } from "dexie";
import { outboxMiddleware, type OutboxEntry } from "./outbox";

/**
 * Local-first reader state in IndexedDB. Everything is written here first,
 * immediately; when the reader is signed in, the sync engine
 * (src/lib/sync) sends changes to the account and brings in changes from
 * other devices. Every synced row carries `updatedAt` (last writer wins) and,
 * once synced, `serverUpdatedAt`: the server version this device last saw.
 */

/** Fields every synced row may carry. */
export type Synced = { updatedAt: number; serverUpdatedAt?: number };

/** Enough of a work to render it in the library without the network. */
export type WorkSnapshot = {
  slug: string;
  title_bn: string;
  subtitle_bn: string | null;
  cover_variant: number;
  authors: { name_bn: string }[];
};

/** Where this device is in a book. Other devices' places are in `remotePositions`. */
export type ReadingPosition = {
  workSlug: string;
  fileSha: string;
  cfi: string;
  /** 0–1 through the whole book */
  fraction: number;
  chapter: string | null;
  finished: boolean;
  updatedAt: number;
  serverUpdatedAt?: number;
  openedAt: number;
  work: WorkSnapshot;
  /** created from another device's position and not read here since */
  fromRemote?: boolean;
};

/** Another device's place in a book (read-only here). */
export type RemotePosition = {
  id: string;
  deviceId: string;
  deviceLabel: string | null;
  workSlug: string;
  fileSha: string;
  cfi: string;
  fraction: number;
  chapter: string | null;
  finished: boolean;
  openedAt: number;
  updatedAt: number;
  work: WorkSnapshot | null;
};

export type LibraryStatus = "want" | "reading" | "finished" | "dnf";
export type LibraryEntry = {
  workSlug: string;
  status: LibraryStatus;
  favourite?: boolean;
  /** 1–5 */
  rating?: number | null;
  /** a private reflection on the book */
  reflection?: string | null;
  addedAt: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  updatedAt: number;
  serverUpdatedAt?: number;
  work: WorkSnapshot;
};

export type Shelf = { id: string; name: string; position: number; createdAt: number; updatedAt: number; serverUpdatedAt?: number };
export type ShelfItem = {
  /** `${shelfId}:${workSlug}` */
  id: string;
  shelfId: string;
  workSlug: string;
  addedAt: number;
  updatedAt: number;
  serverUpdatedAt?: number;
  work: WorkSnapshot;
};

export type Bookmark = {
  id: string;
  workSlug: string;
  fileSha: string;
  cfi: string;
  fraction: number;
  chapter: string | null;
  excerpt: string;
  createdAt: number;
  updatedAt?: number;
  serverUpdatedAt?: number;
  work: WorkSnapshot;
};

/**
 * A downloaded EPUB, kept for offline reading. Stored as an ArrayBuffer: WebKit
 * cannot store Blobs in IndexedDB in ephemeral sessions (Safari Private
 * Browsing). `blob` is the older format, still read.
 */
export type CachedFile = { sha256: string; data?: ArrayBuffer; blob?: Blob; bytes: number; cachedAt: number };
export type Setting = { key: string; value: unknown; updatedAt: number; serverUpdatedAt?: number };

/** This device's reading time per local calendar day ("2026-11-04"), for goals and streaks. */
export type ReadingDay = { day: string; seconds: number; updatedAt: number; serverUpdatedAt?: number };
/** Another device's reading time on a day; a day's total is the sum over devices. */
export type RemoteDay = { id: string; deviceId: string; day: string; seconds: number };

/** Device-local bookkeeping (sync cursor, owner, device id). Never synced. */
export type Meta = { key: string; value: unknown };

export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";
export type HighlightStyle = "highlight" | "underline";

/**
 * A highlight (optionally with a note). Anchored three ways so it can survive
 * a changed book file: the range CFI (exact, for this file), the quoted text
 * with some context before and after (for re-anchoring by search), and the
 * file hash the CFI belongs to.
 */
export type Annotation = {
  id: string;
  workSlug: string;
  fileSha: string;
  cfi: string;
  quote: string;
  prefix: string;
  suffix: string;
  color: HighlightColor;
  style: HighlightStyle;
  note: string | null;
  chapter: string | null;
  /** 0–1 through the book, for display and rough ordering */
  fraction: number;
  createdAt: number;
  updatedAt: number;
  serverUpdatedAt?: number;
  /** the passage could not be found in a newer file of the book */
  orphaned?: boolean;
  /** a copy kept when two devices changed this highlight's note at once */
  conflictOf?: string | null;
  work: WorkSnapshot;
};

export class LocalDB extends Dexie {
  positions!: EntityTable<ReadingPosition, "workSlug">;
  library!: EntityTable<LibraryEntry, "workSlug">;
  bookmarks!: EntityTable<Bookmark, "id">;
  files!: EntityTable<CachedFile, "sha256">;
  settings!: EntityTable<Setting, "key">;
  annotations!: EntityTable<Annotation, "id">;
  days!: EntityTable<ReadingDay, "day">;
  outbox!: EntityTable<OutboxEntry, "key">;
  meta!: EntityTable<Meta, "key">;
  remotePositions!: EntityTable<RemotePosition, "id">;
  remoteDays!: EntityTable<RemoteDay, "id">;
  shelves!: EntityTable<Shelf, "id">;
  shelfItems!: EntityTable<ShelfItem, "id">;

  constructor() {
    super("openbanglabooks");
    this.version(1).stores({
      positions: "workSlug, updatedAt, openedAt",
      library: "workSlug, status, updatedAt",
      bookmarks: "id, workSlug, createdAt, [workSlug+cfi]",
      files: "sha256, cachedAt",
      settings: "key",
    });
    this.version(2).stores({
      annotations: "id, workSlug, updatedAt, createdAt",
    });
    this.version(3).stores({
      days: "day",
    });
    this.version(4)
      .stores({
        outbox: "key, changedAt",
        meta: "key",
        remotePositions: "id, workSlug",
        remoteDays: "id, day",
        shelves: "id, position",
        shelfItems: "id, shelfId, workSlug",
        bookmarks: "id, workSlug, createdAt, [workSlug+cfi], updatedAt",
      })
      .upgrade((tx) =>
        tx
          .table("bookmarks")
          .toCollection()
          .modify((b: Bookmark) => {
            b.updatedAt ??= b.createdAt;
          }),
      );
    this.use(outboxMiddleware);
  }
}

let instance: LocalDB | null = null;
/** Lazily opened so server rendering never touches IndexedDB. */
export function localDB(): LocalDB {
  instance ??= new LocalDB();
  return instance;
}

/** Hint for the pre-paint script, so Continue Reading reserves space without layout shift. */
export const HAS_PROGRESS_KEY = "obb:has-progress";
export function markHasProgress(has: boolean) {
  try {
    if (has) localStorage.setItem(HAS_PROGRESS_KEY, "1");
    else localStorage.removeItem(HAS_PROGRESS_KEY);
    document.documentElement.toggleAttribute("data-reading", has);
  } catch {
    /* storage unavailable (private mode) – the section simply appears after load */
  }
}

export function snapshotOf(w: WorkSnapshot): WorkSnapshot {
  return {
    slug: w.slug,
    title_bn: w.title_bn,
    subtitle_bn: w.subtitle_bn ?? null,
    cover_variant: w.cover_variant,
    authors: w.authors.map((a) => ({ name_bn: a.name_bn })),
  };
}
