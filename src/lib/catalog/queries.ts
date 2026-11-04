import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import type {
  Author,
  AuthorRef,
  Collection,
  Genre,
  GenreRef,
  WorkDetail,
  WorkSummary,
} from "./types";

/**
 * Public catalog reads. Uses the anon key, so row-level security limits every
 * query to published rows. Results are cached (Cache Components) under the
 * "catalog" tag; ingestion and admin edits revalidate it.
 */
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export const CATALOG_TAG = "catalog";

const WORK_SUMMARY = `
  slug, title_bn, subtitle_bn, title_en, original_pub_year, form, literary_period,
  cover_variant, featured_rank, created_at,
  work_authors ( position, role, authors ( slug, name_bn, name_en ) ),
  work_genres ( genres ( slug, name_bn, name_en ) )
`;

type RawWork = Omit<WorkSummary, "authors" | "genres"> & {
  work_authors: { position: number; role: string; authors: AuthorRef | null }[];
  work_genres: { genres: GenreRef | null }[];
};

function toSummary(w: RawWork): WorkSummary {
  const { work_authors, work_genres, ...rest } = w;
  return {
    ...rest,
    authors: work_authors
      .filter((wa) => wa.role === "author" && wa.authors)
      .sort((a, b) => a.position - b.position)
      .map((wa) => wa.authors!),
    genres: work_genres.map((g) => g.genres!).filter(Boolean),
  };
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Catalog query failed (${what}): ${res.error.message}`);
  return res.data as T;
}

export async function listWorks(): Promise<WorkSummary[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CATALOG_TAG);
  const res = await supabase.from("works").select(WORK_SUMMARY).order("created_at", { ascending: false });
  return must(res, "works").map((w) => toSummary(w as unknown as RawWork));
}

export async function getWork(slug: string): Promise<WorkDetail | null> {
  "use cache";
  cacheLife("days");
  cacheTag(CATALOG_TAG);
  const res = await supabase
    .from("works")
    .select(
      `${WORK_SUMMARY}, description_bn, description_en, rights_basis,
       collection_items ( collections ( slug, name_bn, name_en ) ),
       editions ( id, is_primary, label_bn, label_en, publisher, pub_year, source_name, source_url,
                  license, license_url, attribution, toc, excerpt_bn, chapter_count,
                  book_files ( sha256, bytes, storage_path, is_current ) )`,
    )
    .eq("slug", slug)
    .maybeSingle();
  const raw = must(res, `work ${slug}`) as unknown as
    | (RawWork & {
        description_bn: string | null;
        description_en: string | null;
        rights_basis: string | null;
        collection_items: { collections: WorkDetail["collections"][number] | null }[];
        editions: (NonNullable<WorkDetail["edition"]> & {
          is_primary: boolean;
          book_files: (NonNullable<WorkDetail["file"]> & { is_current: boolean })[];
        })[];
      })
    | null;
  if (!raw) return null;
  const { collection_items, editions, description_bn, description_en, rights_basis, ...work } = raw;
  const primary = editions.find((e) => e.is_primary) ?? editions[0] ?? null;
  const file = primary?.book_files.find((f) => f.is_current) ?? null;
  let edition: WorkDetail["edition"] = null;
  if (primary) {
    const { book_files: _files, is_primary: _primary, ...rest } = primary;
    edition = rest;
  }
  return {
    ...toSummary(work as RawWork),
    description_bn,
    description_en,
    rights_basis,
    collections: collection_items.map((c) => c.collections!).filter(Boolean),
    edition,
    file: file ? { sha256: file.sha256, bytes: file.bytes, storage_path: file.storage_path } : null,
  };
}

export async function getAuthors(): Promise<(Author & { workCount: number })[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CATALOG_TAG);
  const res = await supabase
    .from("authors")
    .select("slug, name_bn, name_en, born_year, died_year, bio_bn, bio_en, wikidata_id, wikisource_url, work_authors(count)")
    .order("born_year");
  return must(res, "authors").map((a) => {
    const { work_authors, ...rest } = a as unknown as Author & { work_authors: { count: number }[] };
    return { ...rest, workCount: work_authors[0]?.count ?? 0 };
  });
}

export async function getAuthor(slug: string): Promise<(Author & { works: WorkSummary[] }) | null> {
  "use cache";
  cacheLife("days");
  cacheTag(CATALOG_TAG);
  const res = await supabase
    .from("authors")
    .select("slug, name_bn, name_en, born_year, died_year, bio_bn, bio_en, wikidata_id, wikisource_url")
    .eq("slug", slug)
    .maybeSingle();
  const author = must(res, `author ${slug}`) as Author | null;
  if (!author) return null;
  const works = (await listWorks()).filter((w) => w.authors.some((a) => a.slug === slug));
  return { ...author, works: works.sort((a, b) => (a.original_pub_year ?? 0) - (b.original_pub_year ?? 0)) };
}

export async function getGenres(): Promise<Genre[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CATALOG_TAG);
  const res = await supabase
    .from("genres")
    .select("slug, name_bn, name_en, description_bn, description_en, position, work_genres(count)")
    .order("position");
  return must(res, "genres").map((g) => {
    const { work_genres, position: _p, ...rest } = g as unknown as Genre & {
      position: number;
      work_genres: { count: number }[];
    };
    return { ...rest, count: work_genres[0]?.count ?? 0 };
  });
}

export async function getCollections(): Promise<Collection[]> {
  "use cache";
  cacheLife("days");
  cacheTag(CATALOG_TAG);
  const [res, works] = await Promise.all([
    supabase
      .from("collections")
      .select("slug, name_bn, name_en, description_bn, description_en, position, collection_items(position, works(slug))")
      .order("position"),
    listWorks(),
  ]);
  const bySlug = new Map(works.map((w) => [w.slug, w]));
  return must(res, "collections")
    .map((c) => {
      const { collection_items, position: _p, ...rest } = c as unknown as Omit<Collection, "works"> & {
        position: number;
        collection_items: { position: number; works: { slug: string } | null }[];
      };
      const items = collection_items
        .filter((i) => i.works)
        .sort((a, b) => a.position - b.position)
        .map((i) => bySlug.get(i.works!.slug))
        .filter((w): w is WorkSummary => Boolean(w));
      return { ...rest, works: items };
    })
    .filter((c) => c.works.length > 0);
}

export async function getCollection(slug: string): Promise<Collection | null> {
  return (await getCollections()).find((c) => c.slug === slug) ?? null;
}

export async function getGenre(slug: string): Promise<(Genre & { works: WorkSummary[] }) | null> {
  const [genres, works] = await Promise.all([getGenres(), listWorks()]);
  const genre = genres.find((g) => g.slug === slug);
  if (!genre) return null;
  return { ...genre, works: works.filter((w) => w.genres.some((g) => g.slug === slug)) };
}

export type SearchHit = {
  kind: "work" | "author";
  slug: string;
  title_bn: string;
  title_en: string;
  subtitle: string | null;
  score: number;
};

/** Not cached with "use cache": queries are unbounded; the route handler sets HTTP caching. */
export async function searchCatalog(q: string, limit = 12): Promise<SearchHit[]> {
  const query = q.trim().slice(0, 80);
  if (!query) return [];
  const res = await supabase.rpc("search_catalog", { q: query, max_results: limit });
  return must(res, "search") as SearchHit[];
}
