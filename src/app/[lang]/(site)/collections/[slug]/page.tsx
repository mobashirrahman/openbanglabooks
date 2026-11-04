import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { BookGrid, ListingHeader } from "@/components/catalog/book-grid";
import { ListSkeleton } from "@/components/catalog/skeletons";
import { getCollection, getCollections } from "@/lib/catalog/queries";
import { getLocale } from "@/lib/i18n";
import { alternates } from "@/lib/seo/site";

export async function generateStaticParams() {
  return (await getCollections()).map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps<"/[lang]/collections/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const c = await getCollection(slug);
  if (!c) return {};
  return {
    title: locale === "bn" ? c.name_bn : c.name_en,
    description: (locale === "bn" ? c.description_bn : c.description_en) ?? undefined,
    alternates: alternates(locale, `/collections/${slug}`, true),
  };
}

export default function CollectionPage({ params }: PageProps<"/[lang]/collections/[slug]">) {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <CollectionContent params={params} />
    </Suspense>
  );
}

async function CollectionContent({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const locale = await getLocale();
  const c = await getCollection(slug);
  if (!c) notFound();
  return (
    <>
      <ListingHeader title={locale === "bn" ? c.name_bn : c.name_en} description={locale === "bn" ? c.description_bn : c.description_en} />
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <BookGrid works={c.works} locale={locale} />
      </div>
    </>
  );
}
