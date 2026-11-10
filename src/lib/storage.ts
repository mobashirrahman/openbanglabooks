import { env } from "cloudflare:workers";

/**
 * Public book blobs live in R2; Postgres keeps the catalog and Supabase keeps
 * auth plus private personal uploads. Object keys mirror the old bucket paths,
 * so `book_files.storage_path` did not have to change.
 *
 * Only import this module from server code: `cloudflare:workers` is not
 * available in the browser.
 */

type BookBucket = {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string; cacheControl?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpEtag?: string } | null>;
  delete(key: string): Promise<void>;
};

export const BOOKS_PREFIX = "books";
export const COVERS_PREFIX = "covers";

function bucket(): BookBucket | undefined {
  return (env as unknown as { BOOK_FILES?: BookBucket }).BOOK_FILES;
}

export function bookKey(path: string): string {
  return `${BOOKS_PREFIX}/${path.replace(/^\/+/, "")}`;
}

export function coverKey(path: string): string {
  return `${COVERS_PREFIX}/${path.replace(/^\/+/, "")}`;
}

export async function putBookFile(path: string, bytes: Uint8Array, contentType = "application/epub+zip"): Promise<void> {
  const files = bucket();
  if (!files) throw new Error("BOOK_FILES R2 binding is not configured");
  await files.put(bookKey(path), bytes, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
  });
}

export async function getBookFile(path: string): Promise<{ body: ReadableStream; httpEtag?: string } | null> {
  return (await bucket()?.get(bookKey(path))) ?? null;
}
