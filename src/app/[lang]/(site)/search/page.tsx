import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookGrid, ListingHeader } from "@/components/catalog/book-grid";
import { ListSkeleton } from "@/components/catalog/skeletons";
import { listWorks, searchCatalog } from "@/lib/catalog/queries";
import { getDictionary, getLocale, t } from "@/lib/i18n";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

/** Internal search results are not indexed. */
export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.search.title, robots: { index: false, follow: true } };
}

export default async function SearchPage({ searchParams }: PageProps<"/[lang]/search">) {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    // at least a screen tall: results shorter than the skeleton would otherwise pull the footer up into view
    <div className="min-h-[100svh]">
      <Suspense fallback={<ListSkeleton />}>
        <SearchResults searchParams={searchParams} locale={locale} dict={dict} />
      </Suspense>
    </div>
  );
}

async function SearchResults({
  searchParams,
  locale,
  dict,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: Locale;
  dict: Dictionary;
}) {
  const q = String((await searchParams).q ?? "").trim().slice(0, 80);
  const [hits, works] = await Promise.all([searchCatalog(q, 40), listWorks()]);
  const bySlug = new Map(works.map((w) => [w.slug, w]));
  const foundWorks = hits.filter((h) => h.kind === "work").map((h) => bySlug.get(h.slug)!).filter(Boolean);
  const foundAuthors = hits.filter((h) => h.kind === "author");

  return (
    <>
      <ListingHeader title={q ? t(dict.search.resultsFor, { query: q }) : dict.search.title} description={q ? null : dict.search.hint}>
        <form action={localizedPath(locale, "/search")} role="search" className="mt-6 flex max-w-xl gap-2">
          <label htmlFor="q" className="sr-only">
            {dict.nav.search}
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={q}
            placeholder={dict.nav.searchPlaceholder}
            className="h-12 flex-1 rounded-control border border-line-strong bg-surface px-4 text-base outline-none focus-visible:border-focus"
          />
          <button type="submit" className="h-12 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
            {dict.nav.search}
          </button>
        </form>
      </ListingHeader>
      <div className="mx-auto max-w-7xl space-y-12 px-4 sm:px-6 lg:px-8">
        {q && !hits.length ? <p className="text-fg-muted">{t(dict.search.noResults, { query: q })}</p> : null}
        {foundAuthors.length ? (
          <section aria-labelledby="author-results">
            <h2 id="author-results" className="text-2xl">
              {dict.search.authors}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-3">
              {foundAuthors.map((a) => (
                <li key={a.slug}>
                  <Link
                    href={localizedPath(locale, `/authors/${a.slug}`)}
                    className="inline-flex h-11 items-center rounded-full border border-line-strong px-4 font-display text-lg hover:border-fg-subtle"
                  >
                    {locale === "bn" ? a.title_bn : a.title_en}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {foundWorks.length ? (
          <section aria-labelledby="book-results">
            <h2 id="book-results" className="mb-5 text-2xl">
              {dict.search.books}
            </h2>
            <BookGrid works={foundWorks} locale={locale} />
          </section>
        ) : null}
      </div>
    </>
  );
}
