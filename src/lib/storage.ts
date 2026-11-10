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
  list(options?: { cursor?: string; limit?: number }): Promise<{
    objects: { key: string; size: number }[];
    truncated: boolean;
    cursor?: string;
  }>;
};

/**
 * Hard ceiling for everything we put in R2. The free plan covers 10 GB-month;
 * this is 9.9 GB (decimal), leaving 100 MB of headroom for rounding and for
 * objects created outside this guard (e.g. a manual dashboard upload).
 */
export const R2_STORAGE_LIMIT_BYTES = 9_900_000_000;

export class StorageQuotaError extends Error {
  constructor(used: number, incoming: number) {
    super(
      `R2 storage quota reached: ${(used / 1000 ** 3).toFixed(2)} GB used, ` +
        `${(incoming / 1000 ** 3).toFixed(2)} GB requested, limit ${(R2_STORAGE_LIMIT_BYTES / 1000 ** 3).toFixed(1)} GB`,
    );
    this.name = "StorageQuotaError";
  }
}

export function assertStorageRoom(usedBytes: number, incomingBytes: number): void {
  if (usedBytes + incomingBytes > R2_STORAGE_LIMIT_BYTES) {
    throw new StorageQuotaError(usedBytes, incomingBytes);
  }
}

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
  assertStorageRoom(await bucketUsage(), bytes.byteLength);
  await files.put(bookKey(path), bytes, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
  });
}

export async function bucketUsage(): Promise<number> {
  const files = bucket();
  if (!files) return 0;
  let total = 0;
  let cursor: string | undefined;
  do {
    const page = await files.list({ cursor, limit: 1000 });
    for (const object of page.objects) total += object.size;
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return total;
}

export async function getBookFile(path: string): Promise<{ body: ReadableStream; httpEtag?: string } | null> {
  return (await bucket()?.get(bookKey(path))) ?? null;
}
