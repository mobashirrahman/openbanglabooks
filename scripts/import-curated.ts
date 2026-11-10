/**
 * Import curated EPUBs (from `book-curate`) into the catalog.
 *
 *   pnpm exec tsx scripts/import-curated.ts --dir ../book-scrapper/data/telegram/bongboi/curated --dry
 *   pnpm exec tsx scripts/import-curated.ts --dir ... --limit 20
 *
 * Each `<sha256>.epub` needs its `<sha256>.json` sidecar from the curator.
 * Books are published, deduped by content hash, and uploaded to R2 under the
 * usual `books/<sha>.epub` key. Classification is intentionally conservative:
 * works import as `novel` until an editor reclassifies them.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { validateEpub } from "../src/lib/epub/validate.ts";
import { assertStorageRoom, bucketUsage, uploadBook } from "./lib/r2.ts";

const root = resolve(import.meta.dirname, "..");

// Explicit args first: --local writes to the local stack, the default is production.
const preArgs = process.argv.slice(2);
const useLocal = preArgs.includes("--local");
const envFile = useLocal
  ? ".env.local"
  : existsSync(join(root, ".env.production.local"))
    ? ".env.production.local"
    : ".env.local";
process.loadEnvFile(join(root, envFile));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (.env.local / .env.production.local)");
  process.exit(2);
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

type Sidecar = {
  source: string;
  source_sha256: string;
  output_sha256: string;
  title: string | null;
  author: string | null;
};

const { values: args } = parseArgs({
  options: {
    dir: { type: "string" },
    limit: { type: "string" },
    only: { type: "string" },
    dry: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    local: { type: "boolean", default: false },
  },
});
if (!args.dir) {
  console.error("error: --dir <curated directory> is required");
  process.exit(2);
}

console.log(`target: ${process.env.NEXT_PUBLIC_SUPABASE_URL} (${envFile})`);
const dir = resolve(args.dir);
const limit = args.limit ? Number(args.limit) : undefined;
const sidecars = readdirSync(dir)
  .filter((name) => name.endsWith(".json"))
  .sort()
  .slice(0, limit ?? undefined)
  .filter((name) => !args.only || name.includes(args.only));

function slugFor(prefix: string, value: string): string {
  const ascii = value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  if (ascii) return `${prefix}-${ascii}`;
  return `${prefix}-${createHash("sha1").update(value).digest("hex").slice(0, 10)}`;
}

const usedAtStart = args.dry ? 0 : bucketUsage();
let storedBytes = usedAtStart;
let imported = 0;
let skipped = 0;
let failed = 0;

for (const name of sidecars) {
  const sidecarPath = join(dir, name);
  let sidecar: Sidecar;
  try {
    sidecar = JSON.parse(readFileSync(sidecarPath, "utf8")) as Sidecar;
  } catch (error) {
    console.error(`✗ ${name}: bad sidecar: ${String(error)}`);
    failed += 1;
    continue;
  }
  const title = sidecar.title?.trim();
  const author = sidecar.author?.trim();
  if (!title || !author) {
    console.error(`✗ ${sidecar.source}: missing title/author in sidecar`);
    failed += 1;
    continue;
  }

  const epubPath = join(dir, `${sidecar.output_sha256}.epub`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(epubPath));
  } catch {
    console.error(`✗ ${sidecar.source}: missing ${sidecar.output_sha256}.epub`);
    failed += 1;
    continue;
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== sidecar.output_sha256) {
    console.error(`✗ ${sidecar.source}: hash mismatch (${sha256.slice(0, 10)} != ${sidecar.output_sha256.slice(0, 10)})`);
    failed += 1;
    continue;
  }
  const report = validateEpub(bytes);
  if (!report.ok) {
    console.error(`✗ ${sidecar.source}: invalid EPUB – ${report.errors.join("; ")}`);
    failed += 1;
    continue;
  }

  if (!args.dry) {
    const { data: existing } = await supabase.from("book_files").select("id").eq("sha256", sha256).maybeSingle();
    if (existing && !args.force) {
      skipped += 1;
      continue;
    }
  }

  const message = /^(\d+)_/.exec(sidecar.source)?.[1];
  const workSlug = message ? `tg-${message}` : slugFor("tg", sidecar.source_sha256);
  const authorSlug = slugFor("author", author);

  if (args.dry) {
    console.log(`would import ${workSlug}: ${title} — ${author} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
    imported += 1;
    continue;
  }

  try {
    const { data: authorRow, error: authorError } = await supabase
      .from("authors")
      .upsert({ slug: authorSlug, name_bn: author, name_en: author, status: "published" }, { onConflict: "slug" })
      .select("id")
      .single();
    if (authorError) throw new Error(`author: ${authorError.message}`);

    const workRow = {
      slug: workSlug,
      title_bn: title,
      title_en: title,
      title_latn: title,
      form: "novel" as const,
      status: "published" as const,
      description_bn: null,
      description_en: null,
    };
    const { data: work, error: workError } = await supabase
      .from("works")
      .upsert(workRow, { onConflict: "slug" })
      .select("id")
      .single();
    if (workError) throw new Error(`work: ${workError.message}`);

    await supabase.from("work_authors").delete().eq("work_id", work.id);
    const { error: creditError } = await supabase
      .from("work_authors")
      .insert({ work_id: work.id, author_id: authorRow.id, role: "author", position: 0 });
    if (creditError) throw new Error(`work_authors: ${creditError.message}`);

    const editionRow = {
      work_id: work.id,
      label_bn: "টেলিগ্রাম সংস্করণ",
      label_en: "Telegram edition",
      publisher: null,
      pub_year: null,
      source_name: "Telegram archive",
      source_url: "https://openbanglabooks.com",
      source_revisions: {},
      license: "Unknown",
      license_url: null,
      attribution: "Curated from a Telegram archive by OpenBanglaBooks.",
      toc: [],
      chapter_count: null,
      is_primary: true,
      status: "published" as const,
    };
    const { data: existingEdition } = await supabase
      .from("editions")
      .select("id")
      .eq("work_id", work.id)
      .eq("is_primary", true)
      .maybeSingle();
    const { data: edition, error: editionError } = existingEdition
      ? await supabase.from("editions").update(editionRow).eq("id", existingEdition.id).select("id").single()
      : await supabase.from("editions").insert(editionRow).select("id").single();
    if (editionError || !edition) throw new Error(`edition: ${editionError?.message ?? "no row"}`);

    assertStorageRoom(storedBytes, bytes.byteLength);
    uploadBook(`${sha256}.epub`, bytes);
    storedBytes += bytes.byteLength;

    await supabase.from("book_files").update({ is_current: false }).eq("edition_id", edition.id).neq("sha256", sha256);
    const { error: fileError } = await supabase.from("book_files").upsert(
      {
        edition_id: edition.id,
        format: "epub",
        storage_path: `${sha256}.epub`,
        sha256,
        bytes: bytes.byteLength,
        epub_version: report.version ?? "3.0",
        validation_report: { errors: report.errors, warnings: report.warnings, entries: report.entries },
        is_current: true,
      },
      { onConflict: "sha256" },
    );
    if (fileError) throw new Error(`book_files: ${fileError.message}`);

    imported += 1;
    console.log(`✓ ${workSlug}: ${title} — ${author} (${(bytes.byteLength / 1024).toFixed(0)} KB)`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${sidecar.source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (!args.dry && imported > 0) {
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (site && secret) {
    try {
      const res = await fetch(`${site}/api/revalidate`, { method: "POST", headers: { Authorization: `Bearer ${secret}` } });
      console.log(`revalidate: ${res.status}`);
    } catch (error) {
      console.error(`revalidate failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log(
  `\nimported ${imported}, skipped ${skipped}, failed ${failed}` +
    (args.dry ? " (dry run)" : `; R2 ${((storedBytes - usedAtStart) / 1024 / 1024).toFixed(1)} MiB added`),
);
