import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { connection } from "next/server";
import { Reader } from "@/components/reader/reader";
import { earlyBookScript } from "@/lib/reader/early-book";
import { getWork, listWorks } from "@/lib/catalog/queries";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";
import { absoluteUrl } from "@/lib/seo/site";
import { isPersonal, PERSONAL_ID } from "@/lib/personal/ids";
import { PersonalReader } from "@/components/personal/personal-reader";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import type { Locale } from "@/lib/i18n/config";

export async function generateMetadata({ params }: PageProps<"/[lang]/read/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const locale = await getLocale();
  if (isPersonal(slug)) return { title: `${(await getDictionary(locale)).personal.metaTitle} | OpenBanglaBooks`, robots: { index: false, follow: false } };
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
  if (isPersonal(slug)) {
    if (!PERSONAL_ID.test(slug)) notFound();
    return <OwnBook id={slug} locale={locale} dict={await getDictionary(locale)} />;
  }
  const [dict, work, all] = await Promise.all([getDictionary(locale), getWork(slug), listWorks()]);
  if (!work || !work.file) notFound();

  const at = typeof sp.at === "string" && /^[\w./#-]{1,200}$/.test(sp.at) ? sp.at : null;
  const cfi = typeof sp.cfi === "string" && sp.cfi.startsWith("epubcfi(") && sp.cfi.length < 500 ? sp.cfi : null;
  const author = work.authors[0]?.slug;
  const fileUrl = `/api/books/${work.file.sha256}`;
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const next = all
    .filter((w) => w.slug !== slug && w.authors.some((a) => a.slug === author))
    .slice(0, 3)
    .map((w) => ({ slug: w.slug, title_bn: w.title_bn, href: localizedPath(locale, `/books/${w.slug}`) }));

  return (
    <>
      {/* the book starts downloading as the page arrives, not once the reader's code has
          run (early-book.ts). A preload would do the same in Chromium; WebKit fetches twice */}
      <script nonce={nonce} dangerouslySetInnerHTML={{ __html: earlyBookScript(fileUrl, work.file.sha256) }} />
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
        fileUrl={fileUrl}
        bookHref={localizedPath(locale, `/books/${slug}`)}
        locale={locale}
        labels={readerLabels(dict, locale)}
        initial={{ href: at, cfi }}
        next={next}
      />
    </>
  );
}

function readerLabels(dict: Dictionary, locale: Locale) {
  return {
    ...dict.reader,
    back: dict.actions.back,
    retry: dict.actions.retry,
    undo: dict.notes.undo,
    deleted: dict.notes.deleted,
    allNotes: dict.notes.title,
    notesHref: localizedPath(locale, "/notes"),
  };
}

/** A reader's own book: everything about it is on the device, so the page only sets the stage. */
function OwnBook({ id, locale, dict }: { id: string; locale: Locale; dict: Dictionary }) {
  const library = localizedPath(locale, "/library");
  return (
    <PersonalReader
      id={id}
      locale={locale}
      bookHref={library}
      libraryHref={library}
      signInHref={`${localizedPath(locale, "/signin")}?next=${encodeURIComponent(localizedPath(locale, `/read/${id}`))}`}
      personal={dict.personal}
      labels={{ ...readerLabels(dict, locale), exit: dict.personal.backToLibrary }}
      initial={{}}
    />
  );
}
