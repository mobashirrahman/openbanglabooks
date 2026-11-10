/**
 * Publish a built EPUB to the local catalog.
 *
 * This is the missing bridge for PDF-sourced books: the PDF pipeline writes an
 * EPUB and a bundle, and this script uploads the file and creates/updates the
 * author, work, edition and book_files rows so the site can serve it.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import { uploadBook } from "../lib/r2.ts";

const root = resolve(import.meta.dirname, "../..");

function loadEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [".env.local", ".env"]) {
    const path = resolve(root, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[match[1]] ??= value;
    }
  }
  return env;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in .env.local");
  process.exit(2);
}

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((value) => value !== "--"),
  options: {
    epub: { type: "string" },
    bundle: { type: "string" },
    slug: { type: "string" },
    "title-bn": { type: "string" },
    "title-en": { type: "string" },
    "title-latn": { type: "string" },
    "author-bn": { type: "string" },
    "author-en": { type: "string" },
    "author-slug": { type: "string" },
    form: { type: "string", default: "essays" },
    genre: { type: "string", default: "probondho" },
    collection: { type: "string" },
    "source-name": { type: "string" },
    "source-url": { type: "string" },
    rights: { type: "string" },
    description: { type: "string" },
    "featured-rank": { type: "string" },
    json: { type: "boolean", default: false },
  },
});

if (!args.epub) {
  console.error("usage: pnpm pdf:publish -- --epub dist/book.epub --slug my-book --title-bn … --author-bn …");
  process.exit(2);
}
const epubPath = resolve(args.epub);
if (!existsSync(epubPath)) {
  console.error(`error: no such EPUB: ${epubPath}`);
  process.exit(2);
}
const bundle = args.bundle ? JSON.parse(readFileSync(resolve(args.bundle, "book.json"), "utf8")) : null;
const meta = bundle?.meta ?? {};

const titleBn = args["title-bn"] ?? meta.title;
const authorBn = args["author-bn"] ?? meta.author;
const slug = args.slug ?? meta.slug;
if (!titleBn || !authorBn || !slug) {
  console.error("error: --slug, --title-bn and --author-bn are required when the bundle has no metadata");
  process.exit(2);
}
const titleEn = args["title-en"] ?? meta.titleEn ?? titleBn;
const titleLatn = args["title-latn"] ?? meta.titleLatn ?? slug.replace(/-/g, " ");
const authorEn = args["author-en"] ?? meta.authorEn ?? authorBn;
const authorSlug = args["author-slug"] ?? slugify(authorEn);
const form = args.form!;
if (!["novel", "short-stories", "poetry", "essays", "drama"].includes(form)) {
  console.error(`error: --form must be novel, short-stories, poetry, essays or drama (got ${form})`);
  process.exit(2);
}

const bytes = new Uint8Array(readFileSync(epubPath));
const sha256 = createHash("sha256").update(bytes).digest("hex");
const storagePath = `${sha256}.epub`;
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

uploadBook(storagePath, bytes);

const author = await one(
  "author",
  supabase
    .from("authors")
    .upsert(
      {
        slug: authorSlug,
        name_bn: authorBn,
        name_en: authorEn,
        status: "published",
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single(),
);

const work = await one(
  "work",
  supabase
    .from("works")
    .upsert(
      {
        slug,
        title_bn: titleBn,
        title_en: titleEn,
        title_latn: titleLatn,
        form,
        description_bn: args.description ?? null,
        description_en: null,
        status: "published",
        rights_basis: args.rights ?? "Local test import",
        rights_verified_by: "local test",
        rights_verified_at: new Date().toISOString(),
        featured_rank: args["featured-rank"] ? Number(args["featured-rank"]) : 0,
      },
      { onConflict: "slug" },
    )
    .select("id")
    .single(),
);

await supabase.from("work_authors").delete().eq("work_id", work.id);
const { error: linkError } = await supabase
  .from("work_authors")
  .insert({ work_id: work.id, author_id: author.id, role: "author", position: 0 });
if (linkError) fail(`work_authors: ${linkError.message}`);

if (args.genre) {
  const { data: genre } = await supabase.from("genres").select("id").eq("slug", args.genre).maybeSingle();
  if (genre) {
    await supabase.from("work_genres").delete().eq("work_id", work.id);
    await supabase.from("work_genres").insert({ work_id: work.id, genre_id: genre.id });
  }
}
if (args.collection) {
  const { data: collection } = await supabase.from("collections").select("id").eq("slug", args.collection).maybeSingle();
  if (collection) {
    await supabase.from("collection_items").delete().eq("work_id", work.id);
    await supabase.from("collection_items").insert({ collection_id: collection.id, work_id: work.id, position: 0 });
  }
}

const toc = Array.isArray(bundle?.toc) ? bundle.toc : [];
const chapterCount = Array.isArray(bundle?.sections)
  ? bundle.sections.filter((s: { epubType?: string }) => s.epubType === "chapter").length
  : null;
const excerpt = bundle?.sections?.find((s: { epubType?: string }) => s.epubType === "chapter")?.id
  ? firstParagraph(resolve(args.bundle!, "chapters", `${bundle.sections.find((s: { epubType?: string }) => s.epubType === "chapter").id}.xhtml`))
  : null;

const editionRow = {
  work_id: work.id,
  label_bn: "লোকাল স্ক্যান",
  label_en: "Local scan",
  publisher: meta.publisher ?? null,
  pub_year: meta.firstPublished ?? null,
  source_name: args["source-name"] ?? meta.sourceName ?? basename(epubPath),
  source_url: args["source-url"] ?? meta.sourceUrl ?? "",
  source_revisions: {},
  license: "Local test import",
  license_url: null,
  attribution: "Local OCR test import; not for redistribution.",
  toc,
  excerpt_bn: excerpt,
  chapter_count: chapterCount,
  is_primary: true,
  status: "published" as const,
};
const { data: existingEdition } = await supabase
  .from("editions")
  .select("id")
  .eq("work_id", work.id)
  .eq("is_primary", true)
  .maybeSingle();
const edition = await one(
  "edition",
  existingEdition
    ? supabase.from("editions").update(editionRow).eq("id", existingEdition.id).select("id").single()
    : supabase.from("editions").insert(editionRow).select("id").single(),
);

await supabase.from("book_files").update({ is_current: false }).eq("edition_id", edition.id).neq("sha256", sha256);
const { error: fileError } = await supabase.from("book_files").upsert(
  {
    edition_id: edition.id,
    format: "epub",
    storage_path: storagePath,
    sha256,
    bytes: bytes.byteLength,
    epub_version: "3.0",
    validation_report: {},
    is_current: true,
  },
  { onConflict: "sha256" },
);
if (fileError) fail(`book_files: ${fileError.message}`);

const configuredSite = process.env.REVALIDATE_URL ?? env.REVALIDATE_URL ?? env.NEXT_PUBLIC_SITE_URL;
const site = configuredSite && !configuredSite.includes(":3000") ? configuredSite : "http://localhost:3100";
if (env.REVALIDATE_SECRET) {
  try {
    const res = await fetch(`${site}/api/revalidate`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.REVALIDATE_SECRET}` },
    });
    if (!args.json) console.log(`revalidate ${site}: ${res.status}`);
  } catch {
    if (!args.json) console.log(`revalidate ${site}: site not reachable`);
  }
}

const result = { slug, title: titleBn, author: authorBn, sha256, bytes: bytes.byteLength, storagePath };
if (args.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`published ${titleBn} (${slug})`);
  console.log(`  author: ${authorBn} (${authorSlug})`);
  console.log(`  epub:   ${storagePath} (${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB)`);
  console.log(`  page:   ${site}/books/${slug}`);
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function firstParagraph(path: string): string | null {
  try {
    const xhtml = readFileSync(path, "utf8");
    const match = xhtml.match(/<p>([\s\S]*?)<\/p>/);
    if (!match) return null;
    return match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
  } catch {
    return null;
  }
}

async function one(what: string, query: PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>) {
  const { data, error } = await query;
  if (error || !data) fail(`${what}: ${error?.message ?? "no row returned"}`);
  return data!;
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}
