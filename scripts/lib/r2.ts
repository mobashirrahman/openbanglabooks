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
