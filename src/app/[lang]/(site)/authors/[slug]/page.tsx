import type { Metadata } from "next";
import { notFoundMetadata } from "@/lib/seo/not-found";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BookCard } from "@/components/catalog/book-card";
import { ListSkeleton } from "@/components/catalog/skeletons";
import { JsonLd } from "@/components/seo/json-ld";
import { getAuthor, getAuthors } from "@/lib/catalog/queries";
import { getDictionary, getLocale } from "@/lib/i18n";
import { formatNumber, formatYearRange } from "@/lib/i18n/format";
import { localizedPath } from "@/lib/i18n/config";
import { absoluteUrl, alternates } from "@/lib/seo/site";
import { breadcrumbJsonLd, personJsonLd } from "@/lib/seo/json-ld";

// Unknown slugs wait for the complete render instead of streaming a fallback shell,
// so notFound() runs before any bytes are sent and the response is a real 404.
export const ensureStatic = "navigation";

export async function generateStaticParams() {
  return (await getAuthors()).map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/authors/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const author = await getAuthor(slug);
  if (!author) return notFoundMetadata(locale);
  const name = locale === "bn" ? author.name_bn : author.name_en;
  const title = locale === "bn" ? `${author.name_bn}-এর বই — জীবনী ও রচনাবলি` : `${author.name_en} — books and biography`;
  const bio = (locale === "bn" ? author.bio_bn : author.bio_en) ?? "";
  return {
    title,
    description: bio.length > 158 ? bio.slice(0, bio.lastIndexOf(" ", 157)) + "…" : bio,
    alternates: alternates(locale, `/authors/${slug}`, Boolean(author.bio_en)),
    openGraph: { type: "profile", title, url: localizedPath(locale, `/authors/${slug}`), images: [{ url: "/og/home.png", alt: name }] },
  };
}

export default function AuthorPage({ params }: PageProps<"/[lang]/authors/[slug]">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <AuthorContent params={params} />
    </Suspense>
  );
}

async function AuthorContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const [dict, author] = await Promise.all([getDictionary(locale), getAuthor(slug)]);
  if (!author) notFound();
  const name = locale === "bn" ? author.name_bn : author.name_en;
  const other = locale === "bn" ? author.name_en : author.name_bn;
  const bio = locale === "bn" ? author.bio_bn : author.bio_en ?? author.bio_bn;

  return (
    <article>
      <JsonLd
        data={[
          personJsonLd(author, locale),
          breadcrumbJsonLd([
            { name: dict.nav.authors, url: absoluteUrl(locale, "/authors") },
            { name, url: absoluteUrl(locale, `/authors/${slug}`) },
          ]),
        ]}
      />
      <header className="bg-cloth text-on-cloth">
        <div className="mx-auto max-w-6xl px-4 pt-8 pb-12 sm:px-6 sm:pt-12 sm:pb-16 lg:px-8">
          <nav aria-label="breadcrumb" className="text-sm text-on-cloth-muted">
            <Link href={localizedPath(locale, "/authors")} className="hover:text-on-cloth hover:underline">
              {dict.nav.authors}
            </Link>
          </nav>
          <h1 className="mt-4 text-[2.6rem] leading-[1.2] sm:text-6xl">{name}</h1>
          <p className="mt-3 text-lg text-on-cloth-muted">
            <span lang={locale === "bn" ? "en" : "bn"}>{other}</span>
            {author.born_year || author.died_year ? (
              <span className="text-foil-text">, {formatYearRange(author.born_year, author.died_year, locale)}</span>
            ) : null}
          </p>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-12 sm:px-6 lg:grid-cols-[1fr_1.5fr] lg:gap-16 lg:px-8 lg:py-16">
        {bio ? (
          <section aria-labelledby="bio-heading">
            <h2 id="bio-heading" className="text-2xl">
              {dict.author.biography}
            </h2>
            <p className="mt-3 text-lg leading-relaxed">{bio}</p>
            {author.wikisource_url ? (
              <p className="mt-5 text-sm">
                <a href={author.wikisource_url} className="text-link underline underline-offset-4" target="_blank" rel="noopener">
                  {locale === "bn" ? "উইকিসংকলনে সব রচনা" : "All works on Wikisource"}
                </a>
              </p>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="works-heading">
          <h2 id="works-heading" className="text-2xl">
            {dict.author.worksAvailable}
            <span className="ml-3 font-sans text-sm text-fg-subtle">{formatNumber(author.works.length, locale)}</span>
          </h2>
          <ul className="mt-5 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3">
            {author.works.map((w) => (
              <li key={w.slug}>
                <BookCard work={w} locale={locale} showAuthor={false} />
                {w.original_pub_year ? (
                  <p className="mt-0.5 text-sm text-fg-subtle tabular-nums">{formatNumber(w.original_pub_year, locale)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </article>
  );
}
