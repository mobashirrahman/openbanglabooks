/**
 * pnpm ingest [--only slug,slug] [--dry]
 *
 * Builds verified Bengali EPUBs from Wikisource and publishes them to the
 * catalog. See content/catalog.yaml for the inclusion rules.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import YAML from "yaml";
import { createClient } from "@supabase/supabase-js";
import { validateEpub } from "../../src/lib/epub/validate.ts";
import { assertStorageRoom, bucketUsage, uploadBook } from "../lib/r2.ts";
import { toAsciiDigits } from "../../src/lib/i18n/format.ts";
import { resolveSource, qualitySummary, type SourceSpec } from "./sources.ts";
import { cleanChapter } from "./clean.ts";
import { buildEpub, type EpubChapter } from "./epub.ts";
import { titleUrl } from "./wikisource.ts";

const root = resolve(import.meta.dirname, "../..");
process.loadEnvFile(join(root, ".env.local"));

type ManifestAuthor = {
  slug: string;
  name_bn: string;
  name_en: string;
  born: number;
  died: number;
  wikidata?: string;
  wikisource?: string;
  bio_bn: string;
  bio_en: string;
};
type ManifestWork = {
  slug: string;
  title_bn: string;
  subtitle_bn?: string;
  title_en: string;
  title_latn: string;
  author: string;
  form: string;
  genres: string[];
  collections: string[];
  first_published: number;
  featured_rank?: number;
  poem_labels?: boolean;
  source: SourceSpec;
  description_bn: string;
  description_en: string;
};
type Manifest = {
  reviewed: { by: string; on: string };
  authors: ManifestAuthor[];
  works: ManifestWork[];
};

const { values: args } = parseArgs({
  options: { only: { type: "string" }, dry: { type: "boolean", default: false } },
});
const only = args.only ? new Set(args.only.split(",")) : null;

const manifest = YAML.parse(readFileSync(join(root, "content/catalog.yaml"), "utf8")) as Manifest;
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const COVER_VARIANTS = 6;
const LICENSE = "CC BY-SA 4.0";
const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

const uuidFrom = (s: string) => {
  const h = createHash("sha1").update(`openbanglabooks:${s}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
/** Covers vary by catalog order (cloth = v % 6, motif shifts every 6), so new works continue the sequence. */
const variantFor = (index: number) => index % (COVER_VARIANTS * COVER_VARIANTS);
const periodFor = (year: number) => (year < 1901 ? "19th-century" : "early-20th-century");

function stripTags(s: string) {
  return s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}

function firstLine(xhtml: string): string | null {
  const body = xhtml.replace(/^[\s\S]*?<\/h2>/, "");
  const p = body.match(/<(p|div)[^>]*>([\s\S]*?)<\/\1>/)?.[2];
  if (!p) return null;
  const line = stripTags(p.split(/<br\/>/)[0]).replace(/\s+/g, " ");
  return line ? (line.length > 48 ? line.slice(0, 46).trimEnd() + "…" : line) : null;
}

/** Opening lines: the first real paragraphs, skipping section numerals and headings. */
function excerptOf(xhtml: string, max = 340): string {
  const paragraphs = [...xhtml.replace(/^[\s\S]*?<\/h2>/, "").matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => stripTags(m[1].replace(/<br\/>/g, " ")).replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 25);
  const t = paragraphs.join(" ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const end = Math.max(cut.lastIndexOf("।"), cut.lastIndexOf("?"), cut.lastIndexOf("!"));
  return end > 120 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" ")) + "…";
}

function editionFrom(index: Record<string, string> | undefined) {
  const yearText = index?.["প্রকাশসাল"];
  const year = yearText ? Number(toAsciiDigits(yearText).match(/\d{4}/)?.[0]) || null : null;
  const publisher = index?.["প্রকাশক"]?.replace(/\s+,/g, ",") ?? null;
  const place = index?.["প্রকাশস্থান"]?.replace(/\s+,/g, ",") ?? null;
  return { year, publisher, place };
}

async function upsert<T extends Record<string, unknown>>(table: string, row: T, onConflict: string) {
  const { data, error } = await supabase.from(table).upsert(row, { onConflict }).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data as { id: string };
}

async function main() {
  const authorsBySlug = new Map(manifest.authors.map((a) => [a.slug, a]));
  const authorIds = new Map<string, string>();
  const reviewedAt = new Date(manifest.reviewed.on + "T00:00:00Z").toISOString();
  const outDir = join(root, ".cache/books");
  mkdirSync(outDir, { recursive: true });
  let storedBytes = args.dry ? 0 : bucketUsage();

  if (!args.dry) {
    for (const a of manifest.authors) {
      const { id } = await upsert(
        "authors",
        {
          slug: a.slug,
          name_bn: a.name_bn,
          name_en: a.name_en,
          born_year: a.born,
          died_year: a.died,
          bio_bn: a.bio_bn,
          bio_en: a.bio_en,
          wikidata_id: a.wikidata ?? null,
          wikisource_url: a.wikisource ? titleUrl(a.wikisource) : null,
        },
        "slug",
      );
      authorIds.set(a.slug, id);
    }
  }
  const { data: genres } = await supabase.from("genres").select("id, slug");
  const { data: collections } = await supabase.from("collections").select("id, slug");
  const genreId = new Map((genres ?? []).map((g) => [g.slug, g.id]));
  const collectionId = new Map((collections ?? []).map((c) => [c.slug, c.id]));

  const summary: string[] = [];
  for (const w of manifest.works) {
    if (only && !only.has(w.slug)) continue;
    const author = authorsBySlug.get(w.author);
    if (!author) throw new Error(`${w.slug}: unknown author ${w.author}`);
    process.stdout.write(`\n${w.slug}: resolving… `);

    // 1. completeness
    const src = await resolveSource(w.source);
    const q = qualitySummary(src.chapters);
    const progress = src.index?.["প্রগতি"] ?? "";
    const complete = src.chapters.length > 0 && q.proofreadShare === 1 && !/সংশোধন করা হয়নি/.test(progress);
    if (!complete) {
      summary.push(`✗ ${w.slug}: incomplete (${src.chapters.length} chapters, ${(q.proofreadShare * 100).toFixed(0)}% proofread, "${progress}")`);
      continue;
    }

    // 2. clean + build
    const chapters: EpubChapter[] = src.chapters.map((c, i) => {
      const { xhtml } = cleanChapter(c.page.html, c.label, { part: c.part });
      const label = w.poem_labels ? `${c.label}. ${firstLine(xhtml) ?? ""}`.trim() : c.label;
      return { id: `c${String(i + 1).padStart(3, "0")}`, label, part: c.part, xhtml };
    });
    const firstXhtml = cleanChapter(src.chapters[0].page.html, src.chapters[0].label).xhtml;
    const edition = editionFrom(src.index);
    const sourceUrl = titleUrl(src.rootTitle);
    const { bytes, sha256, toc } = buildEpub(
      {
        identifier: `urn:uuid:${uuidFrom(w.slug)}`,
        title: w.subtitle_bn ? `${w.title_bn} (${w.subtitle_bn})` : w.title_bn,
        author: author.name_bn,
        language: "bn",
        firstPublished: w.first_published,
        publisher: edition.publisher ?? undefined,
        editionYear: edition.year ?? undefined,
        sourceUrl,
        sourceName: "বাংলা উইকিসংকলন",
        license: LICENSE,
        licenseUrl: LICENSE_URL,
        revisions: src.chapters.map((c) => ({
          title: c.label,
          url: `https://bn.wikisource.org/w/index.php?oldid=${c.page.revid}`,
        })),
        modified: reviewedAt.replace(/\.\d{3}Z$/, "Z"),
      },
      chapters,
    );

    // 3. validate
    const report = validateEpub(bytes);
    if (!report.ok) {
      summary.push(`✗ ${w.slug}: invalid EPUB – ${report.errors.join("; ")}`);
      continue;
    }
    writeFileSync(join(outDir, `${sha256}.epub`), bytes);
    process.stdout.write(`${chapters.length} chapters, ${(bytes.byteLength / 1024).toFixed(0)} KB, sha ${sha256.slice(0, 10)}`);
    if (args.dry) {
      summary.push(`✓ ${w.slug} (dry run)`);
      continue;
    }

    // 4. upload (content-addressed, so re-uploads are idempotent)
    const path = `${sha256}.epub`;
    assertStorageRoom(storedBytes, bytes.byteLength);
    uploadBook(path, bytes);
    storedBytes += bytes.byteLength;

    // 5. catalog rows
    const work = await upsert(
      "works",
      {
        slug: w.slug,
        title_bn: w.title_bn,
        subtitle_bn: w.subtitle_bn ?? null,
        title_en: w.title_en,
        title_latn: w.title_latn,
        original_pub_year: w.first_published,
        form: w.form,
        literary_period: periodFor(w.first_published),
        description_bn: w.description_bn,
        description_en: w.description_en,
        status: "published",
        featured_rank: w.featured_rank ?? null,
        cover_variant: variantFor(manifest.works.indexOf(w)),
      },
      "slug",
    );
    await supabase.from("work_authors").delete().eq("work_id", work.id);
    await supabase.from("work_authors").insert({ work_id: work.id, author_id: authorIds.get(w.author)!, role: "author" });
    await supabase.from("work_genres").delete().eq("work_id", work.id);
    if (w.genres.length)
      await supabase.from("work_genres").insert(w.genres.map((g) => ({ work_id: work.id, genre_id: genreId.get(g)! })));
    await supabase.from("collection_items").delete().eq("work_id", work.id);
    if (w.collections.length)
      await supabase
        .from("collection_items")
        .insert(w.collections.map((c, i) => ({ collection_id: collectionId.get(c)!, work_id: work.id, position: (w.featured_rank ?? 50) * 10 + i })));

    const { data: existing } = await supabase.from("editions").select("id").eq("work_id", work.id).eq("is_primary", true).maybeSingle();
    const editionRow = {
      work_id: work.id,
      label_bn: [edition.publisher ?? edition.place, edition.year ? `${edition.year.toLocaleString("bn-BD", { useGrouping: false })} মুদ্রণ` : null]
        .filter(Boolean)
        .join(", ") || null,
      label_en: [edition.year ? `${edition.year} printing` : null].filter(Boolean).join(", ") || null,
      publisher: edition.publisher,
      pub_year: edition.year,
      source_name: "বাংলা উইকিসংকলন (Bengali Wikisource)",
      source_url: sourceUrl,
      source_revisions: Object.fromEntries(src.chapters.map((c) => [c.title, c.page.revid])),
      license: LICENSE,
      license_url: LICENSE_URL,
      attribution: `Text transcribed and proofread by Wikisource contributors (${sourceUrl}).`,
      toc,
      excerpt_bn: excerptOf(firstXhtml),
      chapter_count: chapters.length,
      is_primary: true,
      status: "published",
    };
    const editionId = existing
      ? (await supabase.from("editions").update(editionRow).eq("id", existing.id).select("id").single()).data!.id
      : (await supabase.from("editions").insert(editionRow).select("id").single()).data!.id;

    await supabase.from("book_files").update({ is_current: false }).eq("edition_id", editionId).neq("sha256", sha256);
    const { error: fileErr } = await supabase.from("book_files").upsert(
      {
        edition_id: editionId,
        storage_path: path,
        sha256,
        bytes: bytes.byteLength,
        epub_version: report.version ?? "3.0",
        validation_report: { errors: report.errors, warnings: report.warnings, entries: report.entries },
        is_current: true,
      },
      { onConflict: "sha256" },
    );
    if (fileErr) throw new Error(`book_files ${w.slug}: ${fileErr.message}`);
    summary.push(`✓ ${w.slug}: ${chapters.length} chapters, ${(bytes.byteLength / 1024).toFixed(0)} KB`);
  }

  if (!args.dry) {
    // an author is public once at least one of their works is published
    const { data: published } = await supabase.from("work_authors").select("author_id, works!inner(status)").eq("works.status", "published");
    const ids = [...new Set((published ?? []).map((r) => r.author_id))];
    if (ids.length) await supabase.from("authors").update({ status: "published" }).in("id", ids);
  }
  console.log("\n\n" + summary.join("\n"));

  // tell a running site to refresh its cached catalog (no-op if none is running)
  if (!args.dry && process.env.REVALIDATE_SECRET) {
    const site = process.env.REVALIDATE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    try {
      const res = await fetch(`${site}/api/revalidate`, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.REVALIDATE_SECRET}` },
      });
      console.log(`revalidate ${site}: ${res.status}`);
    } catch {
      console.log(`revalidate ${site}: site not reachable (pages refresh on next build)`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
