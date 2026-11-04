import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BookGrid, ListingHeader } from "@/components/catalog/book-grid";
import { ListSkeleton } from "@/components/catalog/skeletons";
import { JsonLd } from "@/components/seo/json-ld";
import { getGenre, getGenres } from "@/lib/catalog/queries";
import { getDictionary, getLocale } from "@/lib/i18n";
import { absoluteUrl, alternates } from "@/lib/seo/site";
import { breadcrumbJsonLd } from "@/lib/seo/json-ld";

export async function generateStaticParams() {
  return (await getGenres()).map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/genres/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const genre = await getGenre(slug);
  if (!genre) return {};
  const name = locale === "bn" ? genre.name_bn : genre.name_en;
  return {
    title: locale === "bn" ? `বাংলা ${name} — অনলাইনে পড়ুন` : `Bengali ${name.toLowerCase()} — read online`,
    description: (locale === "bn" ? genre.description_bn : genre.description_en) ?? undefined,
    alternates: alternates(locale, `/genres/${slug}`, true),
  };
}

export default function GenrePage({ params }: PageProps<"/[lang]/genres/[slug]">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <GenreContent params={params} />
    </Suspense>
  );
}

async function GenreContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const [dict, genre] = await Promise.all([getDictionary(locale), getGenre(slug)]);
  if (!genre) notFound();
  const name = locale === "bn" ? genre.name_bn : genre.name_en;
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: dict.nav.discover, url: absoluteUrl(locale, "/") },
          { name, url: absoluteUrl(locale, `/genres/${slug}`) },
        ])}
      />
      <ListingHeader title={name} description={locale === "bn" ? genre.description_bn : genre.description_en} />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <BookGrid works={genre.works} locale={locale} />
      </div>
    </>
  );
}
