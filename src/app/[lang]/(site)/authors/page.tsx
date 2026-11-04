import type { Metadata } from "next";
import Link from "next/link";
import { getAuthors } from "@/lib/catalog/queries";
import { getDictionary, getLocale } from "@/lib/i18n";
import { formatNumber, formatYearRange } from "@/lib/i18n/format";
import { localizedPath } from "@/lib/i18n/config";
import { alternates } from "@/lib/seo/site";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: locale === "bn" ? "বাংলা সাহিত্যের লেখক" : "Bengali authors",
    description:
      locale === "bn"
        ? "রবীন্দ্রনাথ ঠাকুর, শরৎচন্দ্র চট্টোপাধ্যায়, বঙ্কিমচন্দ্র চট্টোপাধ্যায় সহ বাংলা সাহিত্যের লেখকদের জীবনী ও বই।"
        : "Biographies and books of Bengali authors including Rabindranath Tagore, Sarat Chandra Chattopadhyay and Bankim Chandra Chattopadhyay.",
    alternates: alternates(locale, "/authors", true),
  };
}

export default async function AuthorsPage() {
  const locale = await getLocale();
  const [dict, authors] = await Promise.all([getDictionary(locale), getAuthors()]);
  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <h1 className="text-4xl sm:text-5xl">{dict.nav.authors}</h1>
      <ul className="mt-10 border-t border-line">
        {authors.map((a) => {
          const bio = locale === "bn" ? a.bio_bn : a.bio_en;
          return (
            <li key={a.slug} className="border-b border-line">
              <Link
                href={localizedPath(locale, `/authors/${a.slug}`)}
                className="group grid gap-2 py-7 sm:grid-cols-[1fr_2fr] sm:gap-10"
              >
                <div>
                  <h2 className="text-3xl leading-snug group-hover:text-link">{locale === "bn" ? a.name_bn : a.name_en}</h2>
                  <p className="mt-1 text-sm text-fg-muted tabular-nums">
                    {formatYearRange(a.born_year, a.died_year, locale)}
                    {", "}
                    {locale === "bn" ? `${formatNumber(a.workCount, locale)}টি বই` : `${a.workCount} books`}
                  </p>
                </div>
                {bio ? <p className="line-clamp-3 text-fg-muted">{bio}</p> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
