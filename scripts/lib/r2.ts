import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Uploads public catalog blobs to R2 from Node scripts.
 *
 * The Worker uploads through its R2 binding; scripts cannot, so they use the
 * authenticated `cf` CLI that ships with the project (`cf r2 objects put`).
 * Set R2_BUCKET to override the bucket name.
 */
const root = resolve(import.meta.dirname, "../..");
const CF = join(root, "node_modules", ".bin", "cf");
const BUCKET = process.env.R2_BUCKET ?? "openbanglabooks-files";

const CONTENT_TYPES: Record<string, string> = {
  ".epub": "application/epub+zip",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/** Keep the account on the R2 free tier (10 GB-month). */
export const R2_STORAGE_LIMIT_BYTES = 9 * 1024 ** 3;

/** Lists one page of objects. cf writes its pagination header to stderr, so
 * stdout is just the JSON array; we page by key to avoid parsing that header. */
function listPage(startAfter?: string): { key: string; size: number }[] {
  const args = ["r2", "objects", "list", "--bucket-name", BUCKET, "--per-page", "1000"];
  if (startAfter) args.push("--start-after", startAfter);
  const out = execFileSync(CF, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out) as { key: string; size: number }[];
}

/** Total bytes currently stored in the bucket (books + covers + anything else). */
export function bucketUsage(): number {
  let total = 0;
  let startAfter: string | undefined;
  for (;;) {
    const page = listPage(startAfter);
    for (const object of page) total += object.size;
    if (page.length < 1000) return total;
    startAfter = page[page.length - 1].key;
  }
}

export function assertStorageRoom(usedBytes: number, incomingBytes: number): void {
  if (usedBytes + incomingBytes > R2_STORAGE_LIMIT_BYTES) {
    throw new Error(
      `R2 free-tier guard: ${(usedBytes / 1024 ** 3).toFixed(2)} GiB used + ` +
        `${(incomingBytes / 1024 ** 3).toFixed(2)} GiB new > ` +
        `${(R2_STORAGE_LIMIT_BYTES / 1024 ** 3)} GiB limit; refusing upload`,
    );
  }
}

export function uploadObject(key: string, bytes: Uint8Array, contentType: string): void {
  const dir = mkdtempSync(join(tmpdir(), "r2-upload-"));
  const file = join(dir, "body");
  try {
    writeFileSync(file, bytes);
    execFileSync(
      CF,
      ["r2", "objects", "put", key, "--bucket-name", BUCKET, "--file", file, "--content-type", contentType],
      { cwd: root, stdio: "inherit" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function uploadBook(path: string, bytes: Uint8Array): void {
  uploadObject(`books/${path.replace(/^\/+/, "")}`, bytes, "application/epub+zip");
}

export function uploadCover(path: string, bytes: Uint8Array): void {
  const clean = path.replace(/^\/+/, "");
  const ext = clean.slice(clean.lastIndexOf(".")).toLowerCase();
  uploadObject(`covers/${clean}`, bytes, CONTENT_TYPES[ext] ?? "application/octet-stream");
}
