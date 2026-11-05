"use client";

import { unzipSync } from "fflate";
import { localDB, type PersonalBook, type WorkSnapshot } from "@/lib/local/db";
import { outboxKey } from "@/lib/local/outbox";
import { accountState, getSupabase } from "@/lib/account/session";
import { requestSyncNow } from "@/lib/sync/status";
import { coverVariantFor } from "./ids";
import { readMetadata, type PreparedBook } from "./import";
import { forgetPersonalFiles, requeueBook } from "./queue";

/**
 * The reader's own books on this device, and moving them into (and out of)
 * the account. Device-only is the default: the file, its title and every
 * highlight in it stay here. "Keep in my account" uploads the file to the
 * reader's private folder and lets the book sync like any other.
 */

const BUCKET = "personal-books";

export type PersonalErrorCode = "signIn" | "offline" | "full" | "tooBig" | "missing" | "checksum" | "failed";
export class PersonalError extends Error {
  constructor(
    readonly code: PersonalErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

/** How a personal book appears in lists, covers and the reader. */
export function personalSnapshot(b: Pick<PersonalBook, "id" | "title" | "author">): WorkSnapshot {
  return {
    slug: b.id,
    title_bn: b.title,
    subtitle_bn: null,
    cover_variant: coverVariantFor(b.id),
    authors: b.author ? [{ name_bn: b.author }] : [],
  };
}

/** Saves an imported book on this device and puts it in the library. Returns false if it was already here. */
export async function savePersonalBook(p: PreparedBook): Promise<boolean> {
  const db = localDB();
  const now = Date.now();
  let added = false;
  await db.transaction("rw", [db.personalBooks, db.personalCovers, db.files, db.library], async () => {
    if (await db.personalBooks.get(p.id)) return;
    added = true;
    const data = p.data.buffer.slice(p.data.byteOffset, p.data.byteOffset + p.data.byteLength) as ArrayBuffer;
    await db.files.put({ sha256: p.sha256, data, bytes: p.data.byteLength, cachedAt: now });
    if (p.cover) await db.personalCovers.put({ id: p.id, data: p.cover.data, type: p.cover.type });
    const book: PersonalBook = {
      id: p.id,
      fileSha: p.sha256,
      title: p.title,
      author: p.author,
      language: p.language,
      bytes: p.data.byteLength,
      addedAt: now,
      cloud: false,
      uploadedAt: null,
      updatedAt: now,
    };
    await db.personalBooks.put(book);
    if (!(await db.library.get(p.id)))
      await db.library.put({ workSlug: p.id, status: "want", favourite: false, rating: null, reflection: null, addedAt: now, startedAt: null, finishedAt: null, updatedAt: now, work: personalSnapshot(book) });
  });
  return added;
}

/** Renames a book (its title and author as the reader wants them shown). */
export async function renamePersonalBook(id: string, title: string, author: string | null) {
  const db = localDB();
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 500);
  if (!clean) return;
  const who = author?.replace(/\s+/g, " ").trim().slice(0, 500) || null;
  await db.transaction("rw", [db.personalBooks, db.library, db.positions, db.bookmarks, db.annotations, db.shelfItems], async () => {
    const book = await db.personalBooks.get(id);
    if (!book) return;
    const next = { ...book, title: clean, author: who };
    await db.personalBooks.put(next);
    const work = personalSnapshot(next);
    // the snapshot is copied into every row about the book
    await db.library.where("workSlug").equals(id).modify({ work });
    await db.positions.where("workSlug").equals(id).modify({ work });
    await db.bookmarks.where("workSlug").equals(id).modify({ work });
    await db.annotations.where("workSlug").equals(id).modify({ work });
    await db.shelfItems.where("workSlug").equals(id).modify({ work });
  });
}

async function signedIn() {
  const s = accountState();
  if (s.status !== "signed-in") throw new PersonalError("signIn");
  if (!navigator.onLine) throw new PersonalError("offline");
  return { sb: await getSupabase(), uid: s.user.id };
}

const pathOf = (uid: string, sha: string) => `${uid}/${sha}.epub`;

function storageError(e: { message?: string; statusCode?: string | number } | null): PersonalError {
  const m = (e?.message ?? "").toLowerCase();
  const code = String(e?.statusCode ?? "");
  if (code === "413" || m.includes("size")) return new PersonalError("tooBig", m);
  if (m.includes("row-level security") || code === "403") return new PersonalError("full", m);
  if (m.includes("fetch") || m.includes("network")) return new PersonalError("offline", m);
  return new PersonalError("failed", m);
}

/** Uploads the file to the reader's private folder; from now on the book syncs. */
export async function keepInAccount(id: string) {
  const db = localDB();
  const book = await db.personalBooks.get(id);
  if (!book) throw new PersonalError("missing");
  const file = await db.files.get(book.fileSha);
  const data = file?.data ?? (file?.blob ? await file.blob.arrayBuffer() : null);
  if (!data) throw new PersonalError("missing");
  const { sb, uid } = await signedIn();
  const { error } = await sb.storage
    .from(BUCKET)
    .upload(pathOf(uid, book.fileSha), new Blob([data], { type: "application/epub+zip" }), { contentType: "application/epub+zip", upsert: false, cacheControl: "31536000" });
  // already there (the same file, kept from another device): nothing to send
  if (error && !/exists|duplicate/i.test(error.message) && String((error as { statusCode?: string }).statusCode) !== "409") throw storageError(error);
  await db.personalBooks.update(id, { cloud: true, uploadedAt: Date.now() });
  await requeueBook(id);
  requestSyncNow();
}

/** Brings a book kept in the account onto this device (its file and cover). */
export async function downloadPersonalBook(id: string): Promise<void> {
  const db = localDB();
  const book = await db.personalBooks.get(id);
  if (!book) throw new PersonalError("missing");
  if (await db.files.get(book.fileSha)) return;
  const { sb, uid } = await signedIn();
  const { data, error } = await sb.storage.from(BUCKET).download(pathOf(uid, book.fileSha));
  if (error || !data) throw error ? storageError(error as { message?: string }) : new PersonalError("missing");
  const bytes = new Uint8Array(await data.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  if ([...digest].map((b) => b.toString(16).padStart(2, "0")).join("") !== book.fileSha) throw new PersonalError("checksum");
  await db.files.put({ sha256: book.fileSha, data: bytes.slice().buffer as ArrayBuffer, bytes: bytes.byteLength, cachedAt: Date.now() });
  try {
    const meta = await readMetadata(unzipSync(bytes));
    if (meta.cover) await db.personalCovers.put({ id, ...meta.cover });
  } catch {
    /* the generated cover will do */
  }
}

/**
 * Deletes a book everywhere: here, from the account and from the reader's
 * other devices, with its highlights, notes, bookmarks and place.
 */
export async function deletePersonalBook(id: string) {
  const db = localDB();
  const book = await db.personalBooks.get(id);
  if (!book) return;
  if (book.cloud) {
    const { sb, uid } = await signedIn();
    const { error } = await sb.storage.from(BUCKET).remove([pathOf(uid, book.fileSha)]);
    if (error) throw storageError(error);
  }
  const tables = [db.personalBooks, db.library, db.positions, db.remotePositions, db.bookmarks, db.annotations, db.shelfItems];
  await db.transaction("rw", [...tables, db.outbox], async () => {
    const keys = [
      outboxKey("personalBooks", id),
      outboxKey("library", id),
      outboxKey("positions", id),
      ...(await db.bookmarks.where("workSlug").equals(id).primaryKeys()).map((k) => outboxKey("bookmarks", k)),
      ...(await db.annotations.where("workSlug").equals(id).primaryKeys()).map((k) => outboxKey("annotations", k)),
      ...(await db.shelfItems.where("workSlug").equals(id).primaryKeys()).map((k) => outboxKey("shelfItems", k)),
    ];
    await db.personalBooks.delete(id);
    await db.library.delete(id);
    await db.positions.delete(id);
    await db.remotePositions.where("workSlug").equals(id).delete();
    await db.bookmarks.where("workSlug").equals(id).delete();
    await db.annotations.where("workSlug").equals(id).delete();
    await db.shelfItems.where("workSlug").equals(id).delete();
    // a book that never left this device leaves no trace in the account either
    if (!book.cloud) await db.outbox.bulkDelete(keys);
  });
  await forgetPersonalFiles([book]);
  if (book.cloud) requestSyncNow();
}

/** Removes every file in the reader's private folder (before the account is deleted). */
export async function removeAllAccountFiles() {
  const { sb, uid } = await signedIn();
  for (let round = 0; round < 20; round++) {
    const { data, error } = await sb.storage.from(BUCKET).list(uid, { limit: 100 });
    if (error) throw storageError(error);
    if (!data?.length) return;
    const { error: removeError } = await sb.storage.from(BUCKET).remove(data.map((f) => `${uid}/${f.name}`));
    if (removeError) throw storageError(removeError);
  }
}
