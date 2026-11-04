"use client";

import Dexie, { type EntityTable } from "dexie";

/**
 * Local-first reader state in IndexedDB. Everything is written here first,
 * immediately; Phase 2 adds background sync to the account on top of these
 * same tables (every row carries updatedAt for last-writer-wins merging).
 */

/** Enough of a work to render it in the library without the network. */
export type WorkSnapshot = {
  slug: string;
  title_bn: string;
  subtitle_bn: string | null;
  cover_variant: number;
  authors: { name_bn: string }[];
};

export type ReadingPosition = {
  workSlug: string;
  fileSha: string;
  cfi: string;
  /** 0–1 through the whole book */
  fraction: number;
  chapter: string | null;
  finished: boolean;
  updatedAt: number;
  openedAt: number;
  work: WorkSnapshot;
};

export type LibraryStatus = "want" | "reading" | "finished";
export type LibraryEntry = {
  workSlug: string;
  status: LibraryStatus;
  addedAt: number;
  updatedAt: number;
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
  work: WorkSnapshot;
};

/**
 * A downloaded EPUB, kept for offline reading. Stored as an ArrayBuffer: WebKit
 * cannot store Blobs in IndexedDB in ephemeral sessions (Safari Private
 * Browsing). `blob` is the older format, still read.
 */
export type CachedFile = { sha256: string; data?: ArrayBuffer; blob?: Blob; bytes: number; cachedAt: number };
export type Setting = { key: string; value: unknown; updatedAt: number };

export class LocalDB extends Dexie {
  positions!: EntityTable<ReadingPosition, "workSlug">;
  library!: EntityTable<LibraryEntry, "workSlug">;
  bookmarks!: EntityTable<Bookmark, "id">;
  files!: EntityTable<CachedFile, "sha256">;
  settings!: EntityTable<Setting, "key">;

  constructor() {
    super("openbanglabooks");
    this.version(1).stores({
      positions: "workSlug, updatedAt, openedAt",
      library: "workSlug, status, updatedAt",
      bookmarks: "id, workSlug, createdAt, [workSlug+cfi]",
      files: "sha256, cachedAt",
      settings: "key",
    });
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
