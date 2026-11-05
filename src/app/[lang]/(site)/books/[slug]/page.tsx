import type { Metadata } from "next";
import { notFoundMetadata } from "@/lib/seo/not-found";
import Link from "next/link";
import { Suspense } from "react";
import { BookSkeleton } from "@/components/catalog/skeletons";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { Shelf } from "@/components/catalog/shelf";
import { ReadButton } from "@/components/library/read-button";
import { LibraryControl } from "@/components/library/library-control";
import { MyBookPage } from "@/components/library/my-book-page";
import { JsonLd } from "@/components/seo/json-ld";
import { getWork, listWorks } from "@/lib/catalog/queries";
import type { TocEntry } from "@/lib/catalog/types";
import { getDictionary, getLocale, t } from "@/lib/i18n";
import { formatNumber } from "@/lib/i18n/format";
import { localizedPath } from "@/lib/i18n/config";
import { absoluteUrl, alternates } from "@/lib/seo/site";
import { bookJsonLd, breadcrumbJsonLd } from "@/lib/seo/json-ld";

// Unknown slugs wait for the complete render instead of streaming a fallback shell,
// so notFound() runs before any bytes are sent and the response is a real 404.
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  const works = await listWorks();
  return works.map((w) => ({ slug: w.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/books/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const work = await getWork(slug);
  if (!work) return notFoundMetadata(locale);
  const author = work.authors[0];
  const title =
    locale === "bn"
      ? `${work.title_bn}${work.subtitle_bn ? ` (${work.subtitle_bn})` : ""} — ${author?.name_bn ?? ""} | অনলাইনে পড়ুন`
      : `${work.title_en} by ${author?.name_en ?? ""} | Read online in Bengali`;
  const description = clip((locale === "bn" ? work.description_bn : work.description_en ?? work.description_bn) ?? "", 158);
  return {
    title,
    description,
    alternates: alternates(locale, `/books/${slug}`, Boolean(work.description_en)),
    openGraph: {
      type: "book",
      title,
      description,
      url: localizedPath(locale, `/books/${slug}`),
      images: [{ url: `/og/books/${slug}.png`, width: 1200, height: 630, alt: work.title_bn }],
      authors: work.authors.map((a) => absoluteUrl(locale, `/authors/${a.slug}`)),
      releaseDate: work.original_pub_year ? String(work.original_pub_year) : undefined,
    },
    twitter: { card: "summary_large_image", title, description, images: [`/og/books/${slug}.png`] },
  };
}

function clip(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, s.lastIndexOf(" ", n - 1)) + "…";
}

const PERIODS: Record<string, { bn: string; en: string }> = {
  "19th-century": { bn: "উনিশ শতক", en: "19th century" },
  "early-20th-century": { bn: "বিশ শতকের প্রথম ভাগ", en: "Early 20th century" },
};

export default function BookPage({ params }: PageProps<"/[lang]/books/[slug]">) {
  return (
    <Suspense fallback={<BookSkeleton />}>
      <BookContent params={params} />
    </Suspense>
  );
}

async function BookContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const [dict, work, all] = await Promise.all([getDictionary(locale), getWork(slug), listWorks()]);
  if (!work) notFound();

  const href = (p: string) => localizedPath(locale, p);
  const author = work.authors[0];
  const description = locale === "bn" ? work.description_bn : work.description_en ?? work.description_bn;
  const sameAuthor = all.filter((w) => w.slug !== slug && w.authors.some((a) => a.slug === author?.slug));
  const sameGenre = all.filter(
    (w) =>
      w.slug !== slug &&
      !sameAuthor.includes(w) &&
      w.genres.some((g) => work.genres.some((wg) => wg.slug === g.slug)),
  );
  const flatToc = flattenToc(work.edition?.toc ?? []);
  // what the reader's library keeps about a book (sent to client components, so kept small)
  const snapshot = {
    slug: work.slug,
    title_bn: work.title_bn,
    subtitle_bn: work.subtitle_bn ?? null,
    cover_variant: work.cover_variant,
    authors: work.authors.map((a) => ({ name_bn: a.name_bn })),
  };
  const genre = work.genres[0];
  const period = work.literary_period ? PERIODS[work.literary_period]?.[locale] : null;

  return (
    <>
      <JsonLd
        data={[
          bookJsonLd(work, locale),
          breadcrumbJsonLd([
            { name: dict.nav.discover, url: absoluteUrl(locale, "/") },
            ...(genre
              ? [{ name: locale === "bn" ? genre.name_bn : genre.name_en, url: absoluteUrl(locale, `/genres/${genre.slug}`) }]
              : []),
            { name: work.title_bn, url: absoluteUrl(locale, `/books/${slug}`) },
          ]),
        ]}
      />
      <article>
        <header className="border-b border-line bg-[linear-gradient(to_bottom,var(--sunken),var(--bg))]">
          <div className="mx-auto max-w-6xl px-4 pt-5 pb-10 sm:px-6 sm:pt-8 lg:px-8 lg:pb-14">
            <nav aria-label="breadcrumb" className="text-sm text-fg-muted">
              <ol className="flex flex-wrap items-center gap-1">
                <li>
                  <Link href={href("/")} className="hover:text-fg hover:underline">
                    {dict.nav.discover}
                  </Link>
                </li>
                {genre ? (
                  <li className="flex items-center gap-1">
                    <ChevronRight aria-hidden className="size-3.5 text-fg-subtle" />
                    <Link href={href(`/genres/${genre.slug}`)} className="hover:text-fg hover:underline">
                      {locale === "bn" ? genre.name_bn : genre.name_en}
                    </Link>
                  </li>
                ) : null}
              </ol>
            </nav>

            <div className="mt-6 grid gap-8 sm:grid-cols-[13rem_1fr] sm:gap-10 lg:grid-cols-[16rem_1fr] lg:gap-14">
              <div className="mx-auto w-44 sm:mx-0 sm:w-full">
                <BookCover work={work} className="shadow-book-lift" />
              </div>
              <div className="min-w-0 text-center sm:pt-2 sm:text-left">
                <h1 className="text-[2.5rem] leading-[1.2] sm:text-5xl lg:text-[4rem]">
                  {work.title_bn}
                  {work.subtitle_bn ? (
                    <span className="mt-1 block text-2xl text-fg-muted sm:text-3xl">{work.subtitle_bn}</span>
                  ) : null}
                </h1>
                {locale === "en" ? <p className="mt-1 text-lg text-fg-muted">{work.title_en}</p> : null}
                <p className="mt-3 text-lg text-fg-muted">
                  {work.authors.map((a, i) => (
                    <span key={a.slug}>
                      {i > 0 ? ", " : null}
                      <Link href={href(`/authors/${a.slug}`)} className="text-fg underline decoration-foil underline-offset-4 hover:text-link">
                        {locale === "bn" ? a.name_bn : a.name_en}
                      </Link>
                    </span>
                  ))}
                  {work.original_pub_year ? <span>, {formatNumber(work.original_pub_year, locale)}</span> : null}
                </p>
                <div className="mt-7 flex flex-col items-stretch gap-3 sm:flex-row sm:items-start">
                  <ReadButton
                    slug={work.slug}
                    locale={locale}
                    labels={{ start: dict.actions.startReading, resume: dict.actions.continueReading, resumeAt: dict.reader.resumeAt }}
                  />
                  <LibraryControl
                    work={snapshot}
                    labels={{
                      ...dict.library,
                      add: dict.actions.addToLibrary,
                      remove: dict.actions.removeFromLibrary,
                      cancel: dict.account.cancel,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_20rem] lg:gap-16 lg:px-8 lg:py-16">
          <div className="min-w-0 space-y-12">
            <MyBookPage work={snapshot} locale={locale} labels={dict.library} />
            {description ? (
              <section aria-labelledby="about-heading">
                <h2 id="about-heading" className="text-2xl">
                  {dict.book.about}
                </h2>
                <p className="mt-3 max-w-[42rem] text-lg leading-relaxed">{description}</p>
              </section>
            ) : null}

            {work.edition?.excerpt_bn ? (
              <section aria-labelledby="excerpt-heading">
                <h2 id="excerpt-heading" className="text-2xl">
                  {dict.book.excerpt}
                </h2>
                <div className="relative mt-4 max-w-[42rem] overflow-hidden rounded-[3px] border border-line bg-surface px-6 py-6 sm:px-9 sm:py-8">
                  <p lang="bn" className="font-read text-[1.08rem] leading-[1.95] [text-indent:1.5em]">
                    {work.edition.excerpt_bn}
                  </p>
                </div>
              </section>
            ) : null}

            {flatToc.length ? (
              <section aria-labelledby="toc-heading">
                <h2 id="toc-heading" className="text-2xl">
                  {dict.book.contents}
                  <span className="ml-3 font-sans text-sm text-fg-subtle">
                    {t(dict.book.chapters, { count: formatNumber(flatToc.filter((e) => !e.isPart).length, locale) })}
                  </span>
                </h2>
                <TocList entries={flatToc.slice(0, 12)} slug={slug} href={href} />
                {flatToc.length > 12 ? (
                  <details className="group mt-1">
                    <summary className="cursor-pointer list-none py-2 text-sm text-link underline decoration-line-strong underline-offset-4 hover:decoration-current group-open:hidden">
                      {t(dict.book.moreChapters, { count: formatNumber(flatToc.length - 12, locale) })}
                    </summary>
                    <TocList entries={flatToc.slice(12)} slug={slug} href={href} start={12} />
                  </details>
                ) : null}
              </section>
            ) : null}
          </div>

          <aside aria-labelledby="details-heading" className="lg:pt-1">
            <h2 id="details-heading" className="text-2xl">
              {dict.book.details}
            </h2>
            <dl className="mt-4 divide-y divide-line border-y border-line text-sm">
              {[
                [dict.book.by, work.authors.map((a) => (locale === "bn" ? a.name_bn : a.name_en)).join(", ")],
                [dict.book.firstPublished, work.original_pub_year ? formatNumber(work.original_pub_year, locale) : null],
                [dict.book.genre, work.genres.map((g) => (locale === "bn" ? g.name_bn : g.name_en)).join(", ")],
                [dict.book.period, period],
                [dict.book.edition, locale === "bn" ? work.edition?.label_bn : work.edition?.label_en ?? work.edition?.label_bn],
                [dict.book.license, work.edition?.license],
              ]
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[7.5rem_1fr] gap-3 py-2.5">
                    <dt className="text-fg-muted">{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
            </dl>
            {work.edition ? (
              <div className="mt-5 text-sm text-fg-muted">
                <h3 className="font-sans text-sm text-fg">{dict.book.source}</h3>
                <p className="mt-1.5">{dict.book.sourceNote}</p>
                <p className="mt-2">
                  <a href={work.edition.source_url} className="text-link underline underline-offset-4" rel="noopener" target="_blank">
                    {work.edition.source_name}
                  </a>
                  {work.edition.license_url ? (
                    <>
                      {", "}
                      <a href={work.edition.license_url} className="text-link underline underline-offset-4" rel="license noopener" target="_blank">
                        {work.edition.license}
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
            ) : null}
          </aside>
        </div>

        <div className="space-y-16 pb-4">
          {sameAuthor.length ? (
            <Shelf
              id="same-author"
              title={dict.book.otherWorks}
              href={author ? href(`/authors/${author.slug}`) : undefined}
              hrefLabel={author ? (locale === "bn" ? author.name_bn : author.name_en) : undefined}
              works={sameAuthor}
              locale={locale}
            />
          ) : null}
          {sameGenre.length ? <Shelf id="related" title={dict.book.related} works={sameGenre.slice(0, 10)} locale={locale} /> : null}
        </div>
      </article>
    </>
  );
}

type FlatEntry = { label: string; href: string; isPart: boolean };

function flattenToc(toc: TocEntry[]): FlatEntry[] {
  return toc.flatMap((e) =>
    e.children?.length
      ? [{ label: e.label, href: e.href, isPart: true }, ...e.children.map((c) => ({ label: c.label, href: c.href, isPart: false }))]
      : [{ label: e.label, href: e.href, isPart: false }],
  );
}

function TocList({
  entries,
  slug,
  href,
  start = 0,
}: {
  entries: FlatEntry[];
  slug: string;
  href: (p: string) => string;
  start?: number;
}) {
  return (
    <ol className="mt-4 max-w-[42rem] columns-1 gap-10 sm:columns-2" start={start + 1}>
      {entries.map((e, i) =>
        e.isPart ? (
          <li key={`${e.href}-part-${i}`} className="break-inside-avoid pt-3 pb-1 font-display text-lg text-fg-muted">
            {e.label}
          </li>
        ) : (
          <li key={`${e.href}-${i}`} className="break-inside-avoid border-b border-line">
            <a href={`${href(`/read/${slug}`)}?at=${encodeURIComponent(e.href)}`} className="block py-2 hover:text-link">
              {e.label}
            </a>
          </li>
        ),
      )}
    </ol>
  );
}
