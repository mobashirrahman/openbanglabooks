"use client";

import { unzip } from "fflate";
import { localDB } from "@/lib/local/db";
import { markBookHere, takeEarlyBook } from "@/lib/reader/early-book";

export class OfflineError extends Error {}
export class BookFileError extends Error {}

/**
 * Fetches an EPUB by content hash, using the IndexedDB copy when present.
 * Files are immutable (content-addressed), so a cached copy never goes stale
 * and the book reopens offline.
 */
export async function loadEpubBytes(sha256: string, url: string | null): Promise<Uint8Array> {
  const db = localDB();
  const cached = await db.files.get(sha256).catch(() => undefined);
  if (cached?.data || cached?.blob) {
    // keeps the page's hint fresh, and fills it in for books kept before there was one (early-book.ts)
    if (url) markBookHere(sha256);
    return cached.data ? new Uint8Array(cached.data) : new Uint8Array(await cached.blob!.arrayBuffer());
  }
  // a reader's own book lives only in IndexedDB
  if (!url) throw new BookFileError("not on this device");
  let res: Response;
  try {
    // the page may have started this download already; if that failed, try once more
    res = (await takeEarlyBook(url)) ?? (await fetch(url));
  } catch {
    throw new OfflineError("network");
  }
  if (!res.ok) throw new BookFileError(`HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // integrity check (defence in depth). WebCrypto only exists in secure contexts
  // (HTTPS or localhost); over plain HTTP elsewhere the same-origin file is trusted as is.
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
    const hex = [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== sha256) throw new BookFileError("checksum mismatch");
  }
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  db.files
    .put({ sha256, data, bytes: bytes.byteLength, cachedAt: Date.now() })
    .then(() => markBookHere(sha256))
    .catch(() => {
      /* storage full or unavailable: reading still works, just not offline */
    });
  return bytes;
}

const MIME: Record<string, string> = {
  xhtml: "application/xhtml+xml",
  html: "text/html",
  css: "text/css",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  woff2: "font/woff2",
  woff: "font/woff",
  ttf: "font/ttf",
  otf: "font/otf",
};

/** Builds the loader interface foliate's EPUB class expects, from an in-memory archive. */
export async function makeLoader(bytes: Uint8Array) {
  const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(bytes, (err, data) => (err ? reject(new BookFileError(err.message)) : resolve(data))),
  );
  const decoder = new TextDecoder();
  return {
    loadText: (name: string) => (files[name] ? decoder.decode(files[name]) : null),
    loadBlob: (name: string, type?: string) => {
      const data = files[name];
      if (!data) return null;
      const ext = name.split(".").pop()?.toLowerCase() ?? "";
      return new Blob([data as BlobPart], { type: type ?? MIME[ext] ?? "application/octet-stream" });
    },
    getSize: (name: string) => files[name]?.byteLength ?? 0,
  };
}
