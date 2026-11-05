import type {
  Annotation,
  Bookmark,
  LibraryEntry,
  PersonalBook,
  ReadingDay,
  ReadingPosition,
  RemoteDay,
  RemotePosition,
  Setting,
  Shelf,
  ShelfItem,
  WorkSnapshot,
} from "@/lib/local/db";
import type { OutboxEntry, SyncedTable } from "@/lib/local/outbox";

/**
 * How local rows (IndexedDB, camelCase) map to server rows (Postgres,
 * snake_case) and back. Pure functions: no I/O, unit tested.
 */

/** Settings that follow the reader across devices. Everything else stays on the device. */
export const SYNCED_SETTINGS = new Set(["obb:reader-settings", "goal-minutes", "reading-speed"]);

export type ServerTable =
  | "user_books"
  | "user_shelves"
  | "shelf_items"
  | "reading_positions"
  | "bookmarks"
  | "annotations"
  | "reader_settings"
  | "reading_days"
  | "personal_books";

export const SERVER_TABLE: Record<SyncedTable, ServerTable> = {
  library: "user_books",
  shelves: "user_shelves",
  shelfItems: "shelf_items",
  positions: "reading_positions",
  bookmarks: "bookmarks",
  annotations: "annotations",
  settings: "reader_settings",
  days: "reading_days",
  personalBooks: "personal_books",
};

const PERSONAL = "mine-";
/**
 * The book a local row belongs to, if the row is about one book. Rows of a
 * reader's own book that is kept on this device only never leave it.
 */
export function bookOf(t: SyncedTable, pk: string, row: Record<string, unknown> | null | undefined): string | null {
  switch (t) {
    case "library":
    case "positions":
    case "personalBooks":
      return pk;
    case "bookmarks":
    case "annotations":
    case "shelfItems":
      return typeof row?.workSlug === "string" ? row.workSlug : null;
    default:
      return null;
  }
}

/** True for a change that must stay on this device: it belongs to one of the reader's own books not kept in the account. */
export function staysOnDevice(t: SyncedTable, pk: string, row: Record<string, unknown> | null | undefined, deviceOnly: ReadonlySet<string>): boolean {
  const book = bookOf(t, pk, row);
  return book !== null && book.startsWith(PERSONAL) && deviceOnly.has(book);
}

/** A change for sync_push. */
export type Change = { t: ServerTable; id: string; u: number; d?: true; b?: number; r?: Record<string, unknown> };
/** A row from sync_pull. */
export type ServerRow = { id: string; updated_at: number; deleted: boolean; version: number } & Record<string, unknown>;

export type Device = { id: string; label: string };

// keep within the database's limits, so one oversized row can never block a push
const cut = (s: string | null | undefined, n: number) => (s == null ? null : s.slice(0, n));
const unit = (f: number) => Math.min(1, Math.max(0, Number.isFinite(f) ? f : 0));

/** The server id of a local row (positions and reading time are per device). */
export function serverId(t: SyncedTable, pk: string, device: Device): string | null {
  if (t === "positions" || t === "days") return `${device.id}:${pk}`;
  if (t === "settings" && !SYNCED_SETTINGS.has(pk)) return null;
  return pk;
}

/** A local row as a push change; null for rows that never leave the device. */
export function toChange(t: SyncedTable, row: Record<string, unknown>, pk: string, device: Device): Change | null {
  const id = serverId(t, pk, device);
  if (!id) return null;
  const u = Number(row.updatedAt ?? 0) || 1;
  const base = typeof row.serverUpdatedAt === "number" ? { b: row.serverUpdatedAt } : {};
  const r = toServerRow(t, row, device);
  return r ? { t: SERVER_TABLE[t], id, u, ...base, r } : null;
}

/** A deletion as a push change. */
export function toDeletion(entry: OutboxEntry, device: Device): Change | null {
  const id = serverId(entry.t, entry.pk, device);
  if (!id) return null;
  return { t: SERVER_TABLE[entry.t], id, u: entry.changedAt, d: true, ...(entry.base != null ? { b: entry.base } : {}) };
}

function toServerRow(t: SyncedTable, row: Record<string, unknown>, device: Device): Record<string, unknown> | null {
  switch (t) {
    case "library": {
      const e = row as LibraryEntry;
      return {
        work_slug: e.workSlug,
        status: e.status,
        favourite: e.favourite ?? false,
        rating: e.rating ?? null,
        reflection: cut(e.reflection, 20000),
        added_at: e.addedAt ?? null,
        started_at: e.startedAt ?? null,
        finished_at: e.finishedAt ?? null,
        work: e.work ?? null,
      };
    }
    case "shelves": {
      const s = row as Shelf;
      return { name: (s.name ?? "").trim().slice(0, 80) || "—", position: s.position ?? 0, created_at: s.createdAt ?? null };
    }
    case "shelfItems": {
      const i = row as ShelfItem;
      return { shelf_id: i.shelfId, work_slug: i.workSlug, added_at: i.addedAt ?? null, work: i.work ?? null };
    }
    case "positions": {
      const p = row as ReadingPosition;
      if (p.fromRemote) return null; // a copy of another device's place, not read here
      return {
        device_id: device.id,
        device_label: device.label.slice(0, 100),
        work_slug: p.workSlug,
        file_sha: p.fileSha,
        cfi: cut(p.cfi, 2000),
        fraction: unit(p.fraction),
        chapter: cut(p.chapter, 500),
        finished: Boolean(p.finished),
        opened_at: p.openedAt ?? null,
        work: p.work ?? null,
      };
    }
    case "bookmarks": {
      const b = row as Bookmark;
      return {
        work_slug: b.workSlug,
        file_sha: b.fileSha,
        cfi: cut(b.cfi, 2000),
        fraction: unit(b.fraction),
        chapter: cut(b.chapter, 500),
        excerpt: cut(b.excerpt, 1000),
        created_at: b.createdAt ?? null,
        work: b.work ?? null,
      };
    }
    case "annotations": {
      const a = row as Annotation;
      return {
        work_slug: a.workSlug,
        file_sha: a.fileSha,
        cfi: cut(a.cfi, 2000),
        quote: cut(a.quote, 5000),
        prefix: cut(a.prefix, 200),
        suffix: cut(a.suffix, 200),
        color: a.color,
        style: a.style,
        note: cut(a.note, 10000),
        chapter: cut(a.chapter, 500),
        fraction: unit(a.fraction),
        created_at: a.createdAt ?? null,
        orphaned: a.orphaned ?? false,
        conflict_of: a.conflictOf ?? null,
        work: a.work ?? null,
      };
    }
    case "settings":
      return { value: (row as Setting).value ?? null };
    case "days": {
      const d = row as ReadingDay;
      return { device_id: device.id, day: d.day, seconds: Math.max(0, Math.min(86400, Math.round(d.seconds))) };
    }
    case "personalBooks": {
      const b = row as PersonalBook;
      if (!b.cloud) return null; // kept on this device only
      return {
        file_sha: b.fileSha,
        title: cut(b.title, 500),
        author: cut(b.author, 500),
        language: cut(b.language, 35),
        bytes: b.bytes,
        added_at: b.addedAt ?? null,
        uploaded_at: b.uploadedAt ?? null,
      };
    }
  }
}

/** Where a pulled row lands locally. `row` is null for a deletion. */
export type LocalTarget =
  | { table: SyncedTable; pk: string; row: Record<string, unknown> | null }
  | { table: "remotePositions" | "remoteDays"; pk: string; row: Record<string, unknown> | null };

const snapshot = (w: unknown): WorkSnapshot | null => (w && typeof w === "object" ? (w as WorkSnapshot) : null);

export function fromServer(t: ServerTable, r: ServerRow, device: Device): LocalTarget | null {
  const seen = { updatedAt: r.updated_at, serverUpdatedAt: r.updated_at };
  const gone = r.deleted;
  switch (t) {
    case "user_books": {
      const pk = r.id;
      if (gone) return { table: "library", pk, row: null };
      const e: LibraryEntry = {
        workSlug: (r.work_slug as string) ?? pk,
        status: (r.status as LibraryEntry["status"]) ?? "want",
        favourite: Boolean(r.favourite),
        rating: (r.rating as number | null) ?? null,
        reflection: (r.reflection as string | null) ?? null,
        addedAt: (r.added_at as number) ?? r.updated_at,
        startedAt: (r.started_at as number | null) ?? null,
        finishedAt: (r.finished_at as number | null) ?? null,
        work: snapshot(r.work) ?? { slug: pk, title_bn: pk, subtitle_bn: null, cover_variant: 0, authors: [] },
        ...seen,
      };
      return { table: "library", pk, row: e };
    }
    case "user_shelves": {
      if (gone) return { table: "shelves", pk: r.id, row: null };
      const s: Shelf = { id: r.id, name: (r.name as string) ?? "", position: (r.position as number) ?? 0, createdAt: (r.created_at as number) ?? r.updated_at, ...seen };
      return { table: "shelves", pk: r.id, row: s };
    }
    case "shelf_items": {
      if (gone) return { table: "shelfItems", pk: r.id, row: null };
      const i: ShelfItem = {
        id: r.id,
        shelfId: r.shelf_id as string,
        workSlug: r.work_slug as string,
        addedAt: (r.added_at as number) ?? r.updated_at,
        work: snapshot(r.work) ?? { slug: r.work_slug as string, title_bn: r.work_slug as string, subtitle_bn: null, cover_variant: 0, authors: [] },
        ...seen,
      };
      return { table: "shelfItems", pk: r.id, row: i };
    }
    case "reading_positions": {
      const slug = r.work_slug as string;
      const mine = r.device_id === device.id;
      if (mine) {
        if (gone) return { table: "positions", pk: slug, row: null };
        const p: ReadingPosition = {
          workSlug: slug,
          fileSha: r.file_sha as string,
          cfi: r.cfi as string,
          fraction: r.fraction as number,
          chapter: (r.chapter as string | null) ?? null,
          finished: Boolean(r.finished),
          openedAt: (r.opened_at as number) ?? r.updated_at,
          work: snapshot(r.work) ?? { slug, title_bn: slug, subtitle_bn: null, cover_variant: 0, authors: [] },
          ...seen,
        };
        return { table: "positions", pk: slug, row: p };
      }
      if (gone) return { table: "remotePositions", pk: r.id, row: null };
      const rp: RemotePosition = {
        id: r.id,
        deviceId: r.device_id as string,
        deviceLabel: (r.device_label as string | null) ?? null,
        workSlug: slug,
        fileSha: r.file_sha as string,
        cfi: r.cfi as string,
        fraction: r.fraction as number,
        chapter: (r.chapter as string | null) ?? null,
        finished: Boolean(r.finished),
        openedAt: (r.opened_at as number) ?? r.updated_at,
        updatedAt: r.updated_at,
        work: snapshot(r.work),
      };
      return { table: "remotePositions", pk: r.id, row: rp };
    }
    case "bookmarks": {
      if (gone) return { table: "bookmarks", pk: r.id, row: null };
      const b: Bookmark = {
        id: r.id,
        workSlug: r.work_slug as string,
        fileSha: r.file_sha as string,
        cfi: r.cfi as string,
        fraction: (r.fraction as number) ?? 0,
        chapter: (r.chapter as string | null) ?? null,
        excerpt: (r.excerpt as string) ?? "",
        createdAt: (r.created_at as number) ?? r.updated_at,
        work: snapshot(r.work) ?? { slug: r.work_slug as string, title_bn: r.work_slug as string, subtitle_bn: null, cover_variant: 0, authors: [] },
        ...seen,
      };
      return { table: "bookmarks", pk: r.id, row: b };
    }
    case "annotations": {
      if (gone) return { table: "annotations", pk: r.id, row: null };
      const a: Annotation = {
        id: r.id,
        workSlug: r.work_slug as string,
        fileSha: r.file_sha as string,
        cfi: r.cfi as string,
        quote: (r.quote as string) ?? "",
        prefix: (r.prefix as string) ?? "",
        suffix: (r.suffix as string) ?? "",
        color: (r.color as Annotation["color"]) ?? "yellow",
        style: (r.style as Annotation["style"]) ?? "highlight",
        note: (r.note as string | null) ?? null,
        chapter: (r.chapter as string | null) ?? null,
        fraction: (r.fraction as number) ?? 0,
        createdAt: (r.created_at as number) ?? r.updated_at,
        orphaned: Boolean(r.orphaned),
        conflictOf: (r.conflict_of as string | null) ?? null,
        work: snapshot(r.work) ?? { slug: r.work_slug as string, title_bn: r.work_slug as string, subtitle_bn: null, cover_variant: 0, authors: [] },
        ...seen,
      };
      return { table: "annotations", pk: r.id, row: a };
    }
    case "reader_settings": {
      if (!SYNCED_SETTINGS.has(r.id)) return null;
      if (gone) return { table: "settings", pk: r.id, row: null };
      const s: Setting = { key: r.id, value: r.value, ...seen };
      return { table: "settings", pk: r.id, row: s };
    }
    case "reading_days": {
      const day = r.day as string;
      if (r.device_id === device.id) {
        if (gone) return { table: "days", pk: day, row: null };
        const d: ReadingDay = { day, seconds: (r.seconds as number) ?? 0, ...seen };
        return { table: "days", pk: day, row: d };
      }
      if (gone) return { table: "remoteDays", pk: r.id, row: null };
      const rd: RemoteDay = { id: r.id, deviceId: r.device_id as string, day, seconds: (r.seconds as number) ?? 0 };
      return { table: "remoteDays", pk: r.id, row: rd };
    }
    case "personal_books": {
      if (gone) return { table: "personalBooks", pk: r.id, row: null };
      const b: PersonalBook = {
        id: r.id,
        fileSha: r.file_sha as string,
        title: (r.title as string) ?? "",
        author: (r.author as string | null) ?? null,
        language: (r.language as string | null) ?? null,
        bytes: (r.bytes as number) ?? 0,
        addedAt: (r.added_at as number) ?? r.updated_at,
        // everything on the server was kept in the account
        cloud: true,
        uploadedAt: (r.uploaded_at as number | null) ?? null,
        ...seen,
      };
      return { table: "personalBooks", pk: r.id, row: b };
    }
  }
}
