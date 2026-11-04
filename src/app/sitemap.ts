import type { MetadataRoute } from "next";
import { getAuthors, getCollections, getGenres, listWorks } from "@/lib/catalog/queries";
import { absoluteUrl } from "@/lib/seo/site";

/**
 * Public, indexable pages only: catalog, book, author, genre and collection
 * pages in Bengali with their English alternates. Reader, search and personal
 * pages are excluded (and carry noindex).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [works, authors, genres, collections] = await Promise.all([listWorks(), getAuthors(), getGenres(), getCollections()]);
  const entry = (path: string, priority: number, lastModified?: string): MetadataRoute.Sitemap[number] => ({
    url: absoluteUrl("bn", path),
    lastModified,
    changeFrequency: "weekly",
    priority,
    alternates: { languages: { bn: absoluteUrl("bn", path), en: absoluteUrl("en", path) } },
  });
  return [
    entry("/", 1),
    entry("/books", 0.8),
    entry("/authors", 0.6),
    entry("/about/sources", 0.3),
    ...works.map((w) => entry(`/books/${w.slug}`, 0.9, w.created_at)),
    ...authors.map((a) => entry(`/authors/${a.slug}`, 0.7)),
    ...genres.filter((g) => g.count > 0).map((g) => entry(`/genres/${g.slug}`, 0.6)),
    ...collections.map((c) => entry(`/collections/${c.slug}`, 0.6)),
  ];
}
