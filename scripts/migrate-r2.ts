/**
 * One-off copy of the existing public buckets (books, covers) from Supabase
 * Storage to R2. Content-addressed keys are unchanged, so no catalog rows
 * need updating; the reader falls back to Supabase until a key exists in R2.
 *
 *   pnpm exec tsx scripts/migrate-r2.ts [--dry]
 *
 * Requires .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 * and an authenticated `cf` CLI. Safe to re-run: R2 overwrites by key.
 */
import { createClient } from "@supabase/supabase-js";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { assertStorageRoom, bucketUsage, uploadObject } from "./lib/r2.ts";

const root = resolve(import.meta.dirname, "..");

function loadEnv(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const name of [".env.local", ".env"]) {
    try {
      process.loadEnvFile(resolve(root, name));
    } catch {
      // optional
    }
  }
  for (const [name, value] of Object.entries(process.env)) if (value) values[name] = value;
  return values;
}

const { values: args } = parseArgs({ options: { dry: { type: "boolean", default: false } } });
const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local");
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const TYPES: Record<string, string> = {
  epub: "application/epub+zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

let copied = 0;
let bytesTotal = 0;
let storedBytes = args.dry ? 0 : bucketUsage();
for (const bucket of ["books", "covers"] as const) {
  const { data: entries, error } = await supabase.storage.from(bucket).list("", { limit: 1000 });
  if (error) {
    console.error(`${bucket}: ${error.message}`);
    process.exit(1);
  }
  for (const entry of entries) {
    if (!entry.id) continue; // folder placeholder
    const { data, error: downloadError } = await supabase.storage.from(bucket).download(entry.name);
    if (downloadError || !data) {
      console.error(`${bucket}/${entry.name}: ${downloadError?.message ?? "empty"}`);
      process.exitCode = 1;
      continue;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    const ext = entry.name.slice(entry.name.lastIndexOf(".") + 1).toLowerCase();
    console.log(`${args.dry ? "would copy" : "copy"} ${bucket}/${entry.name} (${bytes.byteLength} B)`);
    if (!args.dry) {
      assertStorageRoom(storedBytes, bytes.byteLength);
      uploadObject(`${bucket}/${entry.name}`, bytes, TYPES[ext] ?? "application/octet-stream");
      storedBytes += bytes.byteLength;
    }
    copied += 1;
    bytesTotal += bytes.byteLength;
  }
}
console.log(`${args.dry ? "would copy" : "copied"} ${copied} objects, ${(bytesTotal / 1024 / 1024).toFixed(1)} MB`);
