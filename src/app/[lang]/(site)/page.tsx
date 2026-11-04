import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { Shelf, SectionHeading } from "@/components/catalog/shelf";
import { ContinueReading } from "@/components/library/continue-reading";
import { LibraryButton } from "@/components/library/library-button";
import { JsonLd } from "@/components/seo/json-ld";
import { getAuthors, getCollections, getGenres, getWork, listWorks } from "@/lib/catalog/queries";
import { getDictionary, getLocale } from "@/lib/i18n";
import { formatNumber, formatYearRange } from "@/lib/i18n/format";
import { localizedPath } from "@/lib/i18n/config";
import { alternates } from "@/lib/seo/site";
import { organizationJsonLd, websiteJsonLd } from "@/lib/seo/json-ld";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return {
    title: { absolute: dict.meta.homeTitle },
    description: dict.meta.homeDescription,
    alternates: alternates(locale, "/", true),
    openGraph: {
      type: "website",
      siteName: dict.meta.siteName,
      title: dict.meta.homeTitle,
      description: dict.meta.homeDescription,
      url: localizedPath(locale, "/"),
      locale: locale === "bn" ? "bn_BD" : "en_US",
      images: [{ url: "/og/home.png", width: 1200, height: 630, alt: dict.meta.siteName }],
    },
  };
}

export default async function HomePage() {
  const locale = await getLocale();
  const [dict, works, collections, genres, authors] = await Promise.all([
    getDictionary(locale),
    listWorks(),
    getCollections(),
    getGenres(),
    getAuthors(),
  ]);
  const featured = works.filter((w) => w.featured_rank != null).sort((a, b) => a.featured_rank! - b.featured_rank!)[0] ?? works[0];
  const featuredWork = await getWork(featured.slug);
  const featuredDescription =
    (locale === "bn" ? featuredWork?.description_bn : featuredWork?.description_en ?? featuredWork?.description_bn) ?? null;
  const recent = works.slice(0, 10);
  const href = (p: string) => localizedPath(locale, p);

  return (
    <>
      <JsonLd data={[websiteJsonLd(locale, dict), organizationJsonLd(dict)]} />

      {/* The cloth band continues from the header into the featured volume */}
      <section aria-labelledby="featured-title" className="bg-cloth text-on-cloth">
        <div className="mx-auto grid max-w-7xl grid-cols-[minmax(0,7.5rem)_1fr] items-end gap-5 px-4 pt-6 pb-10 sm:grid-cols-[minmax(0,13rem)_1fr] sm:gap-10 sm:px-6 sm:pt-10 sm:pb-14 lg:grid-cols-[17rem_1fr] lg:gap-14 lg:px-8 lg:pt-14 lg:pb-20 xl:grid-cols-[17rem_1fr_21rem]">
          <Link href={href(`/books/${featured.slug}`)} className="group block" tabIndex={-1} aria-hidden>
            <BookCover work={featured} interactive className="shadow-[0_30px_60px_-30px_rgb(0_0_0/0.65),0_10px_20px_-10px_rgb(0_0_0/0.4)]" />
          </Link>
          <div className="min-w-0 pb-1">
            <p className="text-sm text-foil-text">{dict.home.featured}</p>
            <h1 id="featured-title" className="mt-2 text-[2.1rem] leading-[1.25] sm:text-5xl lg:text-[4.4rem]">
              <Link href={href(`/books/${featured.slug}`)} className="hover:underline decoration-1 underline-offset-8">
                {featured.title_bn}
              </Link>
            </h1>
            <p className="mt-2 text-on-cloth-muted sm:text-lg">
              {featured.authors.map((a) => (
                <Link key={a.slug} href={href(`/authors/${a.slug}`)} className="hover:text-on-cloth hover:underline">
                  {a.name_bn}
                </Link>
              ))}
              {featured.original_pub_year ? <span>, {formatNumber(featured.original_pub_year, locale)}</span> : null}
            </p>
            {featuredDescription ? (
              <p className="mt-5 hidden max-w-[38rem] text-[1.05rem] leading-relaxed text-on-cloth-muted sm:block">
                {featuredDescription}
              </p>
            ) : null}
            <div className="mt-7 hidden flex-wrap gap-3 sm:flex">
              <a
                href={href(`/read/${featured.slug}`)}
                className="inline-flex h-12 items-center gap-2 rounded-control bg-on-cloth px-6 text-base text-cloth transition-colors duration-200 hover:bg-[#fbf8f2]"
              >
                <BookOpen aria-hidden className="size-5" />
                {dict.actions.startReading}
              </a>
              <LibraryButton
                tone="cloth"
                work={featured}
                labels={{ add: dict.actions.addToLibrary, added: dict.actions.inLibrary }}
              />
            </div>
          </div>
          {featuredWork?.edition?.excerpt_bn ? (
            <figure className="relative hidden self-stretch xl:block" aria-labelledby="featured-excerpt-caption">
              <div className="relative h-full max-h-[22rem] overflow-hidden rounded-[2px] bg-[#f6f0e3] px-8 pt-9 pb-6 text-[#2b2820] shadow-[0_24px_50px_-28px_rgb(0_0_0/0.7)]">
                <div aria-hidden className="absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-black/10 to-transparent" />
                <figcaption id="featured-excerpt-caption" className="text-center font-sans text-xs text-[#6b665a]">
                  {dict.book.excerpt}
                </figcaption>
                <blockquote className="mt-4 font-read text-[1.02rem] leading-[1.95] [text-indent:1.5em]">
                  {featuredWork.edition.excerpt_bn}
                </blockquote>
                <div aria-hidden className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#f6f0e3] to-transparent" />
              </div>
            </figure>
          ) : null}
          <div className="col-span-2 flex gap-3 sm:hidden">
            <a
              href={href(`/read/${featured.slug}`)}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-control bg-on-cloth px-5 text-cloth"
            >
              <BookOpen aria-hidden className="size-5" />
              {dict.actions.startReading}
            </a>
            <LibraryButton tone="cloth" work={featured} labels={{ add: dict.actions.addToLibrary, added: dict.actions.inLibrary }} />
          </div>
        </div>
      </section>

      <div className="space-y-16 pt-10 sm:space-y-20 sm:pt-14">
        <ContinueReading
          locale={locale}
          labels={{
            title: dict.home.continueReading,
            progress: dict.library.progress,
            continueReading: dict.actions.continueReading,
          }}
        />

        {collections.map((c) => (
          <Shelf
            key={c.slug}
            id={`collection-${c.slug}`}
            title={locale === "bn" ? c.name_bn : c.name_en}
            description={locale === "bn" ? c.description_bn : c.description_en}
            href={href(`/collections/${c.slug}`)}
            hrefLabel={dict.actions.seeAll}
            works={c.works}
            locale={locale}
          />
        ))}

        <section aria-labelledby="genres-heading" className="mx-auto max-w-7xl">
          <SectionHeading id="genres-heading" title={dict.home.genres} />
          <ul className="flex flex-wrap gap-x-10 gap-y-4 px-4 sm:px-6 lg:px-8">
            {genres
              .filter((g) => g.count > 0)
              .map((g) => (
                <li key={g.slug}>
                  <Link
                    href={href(`/genres/${g.slug}`)}
                    className="group inline-flex items-baseline gap-2 font-display text-3xl leading-tight text-fg sm:text-[2.75rem]"
                  >
                    <span className="underline decoration-foil decoration-1 underline-offset-[0.28em] transition-colors group-hover:text-link group-hover:decoration-current">
                      {locale === "bn" ? g.name_bn : g.name_en}
                    </span>
                    <span className="font-sans text-base text-fg-subtle tabular-nums sm:text-lg">{formatNumber(g.count, locale)}</span>
                  </Link>
                </li>
              ))}
          </ul>
        </section>

        <Shelf
          id="recent"
          title={dict.home.recentlyAdded}
          href={href("/books")}
          hrefLabel={dict.nav.allBooks}
          works={recent}
          locale={locale}
        />

        <section aria-labelledby="authors-heading" className="mx-auto max-w-7xl">
          <SectionHeading id="authors-heading" title={dict.home.authors} href={href("/authors")} hrefLabel={dict.actions.seeAll} />
          <ul className="grid gap-x-10 px-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
            {authors.map((a) => (
              <li key={a.slug} className="border-t border-line">
                <Link href={href(`/authors/${a.slug}`)} className="group block py-4">
                  <span className="block font-display text-xl leading-snug group-hover:text-link">
                    {locale === "bn" ? a.name_bn : a.name_en}
                  </span>
                  <span className="mt-0.5 block text-sm text-fg-muted tabular-nums">
                    {formatYearRange(a.born_year, a.died_year, locale)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="intro-heading" className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl border-l-2 border-foil pl-6">
            <h2 id="intro-heading" className="text-2xl">
              {dict.home.introTitle}
            </h2>
            <p className="mt-3 text-fg-muted">{dict.home.intro}</p>
          </div>
        </section>
      </div>
    </>
  );
}
