import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Reader } from "@/components/reader/reader";
import { getWork, listWorks } from "@/lib/catalog/queries";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";
import { absoluteUrl } from "@/lib/seo/site";

export async function generateMetadata({ params }: PageProps<"/[lang]/read/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  const work = await getWork(slug);
  if (!work) return {};
  return {
    title: `${work.title_bn} | OpenBanglaBooks`,
    // the book page is the canonical, indexable description of this book
    alternates: { canonical: absoluteUrl(locale, `/books/${slug}`) },
    robots: { index: false, follow: true },
  };
}

// per-request by design (CSP nonce); not part of the instant-navigation shell
export const instant = false;

/** The immersive reader. Rendered per request (CSP nonce); book data itself is cached. */
export default async function ReadPage({ params, searchParams }: PageProps<"/[lang]/read/[slug]">) {
  await connection();
  const [{ slug }, sp, locale] = await Promise.all([params, searchParams, getLocale()]);
  const [dict, work, all] = await Promise.all([getDictionary(locale), getWork(slug), listWorks()]);
  if (!work || !work.file) notFound();

  const at = typeof sp.at === "string" && /^[\w./#-]{1,200}$/.test(sp.at) ? sp.at : null;
  const cfi = typeof sp.cfi === "string" && sp.cfi.startsWith("epubcfi(") && sp.cfi.length < 500 ? sp.cfi : null;
  const author = work.authors[0]?.slug;
  const next = all
    .filter((w) => w.slug !== slug && w.authors.some((a) => a.slug === author))
    .slice(0, 3)
    .map((w) => ({ slug: w.slug, title_bn: w.title_bn, href: localizedPath(locale, `/books/${w.slug}`) }));

  return (
    <Reader
      work={{
        slug: work.slug,
        title_bn: work.title_bn,
        subtitle_bn: work.subtitle_bn,
        title_en: work.title_en,
        cover_variant: work.cover_variant,
        authors: work.authors.map((a) => ({ name_bn: a.name_bn })),
      }}
      fileSha={work.file.sha256}
      fileUrl={`/api/books/${work.file.sha256}`}
      bookHref={localizedPath(locale, `/books/${slug}`)}
      locale={locale}
      labels={{
        ...dict.reader,
        back: dict.actions.back,
        retry: dict.actions.retry,
        undo: dict.notes.undo,
        deleted: dict.notes.deleted,
        allNotes: dict.notes.title,
        notesHref: localizedPath(locale, "/notes"),
      }}
      initial={{ href: at, cfi }}
      next={next}
    />
  );
}
