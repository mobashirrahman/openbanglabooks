import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { BookGrid, ListingHeader } from "@/components/catalog/book-grid";
import { ListSkeleton } from "@/components/catalog/skeletons";
import { getAuthors, getGenres, listWorks } from "@/lib/catalog/queries";
import { getDictionary, getLocale, t } from "@/lib/i18n";
import { formatNumber } from "@/lib/i18n/format";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { alternates } from "@/lib/seo/site";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return {
    title: locale === "bn" ? "সব বাংলা বই — উপন্যাস, ছোটগল্প, কবিতা ও প্রবন্ধ" : "All Bengali books — novels, stories, poetry and essays",
    description: dict.browse.description,
    // filtered views canonicalise to the unfiltered list
    alternates: alternates(locale, "/books", true),
  };
}

const PERIODS = [
  { slug: "19th-century", bn: "উনিশ শতক", en: "19th century" },
  { slug: "early-20th-century", bn: "বিশ শতকের প্রথম ভাগ", en: "Early 20th century" },
];

export default async function BrowsePage({ searchParams }: PageProps<"/[lang]/books">) {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    <>
      <ListingHeader title={dict.browse.title} description={dict.browse.description} />
      <Suspense fallback={<ListSkeleton />}>
        <Results searchParams={searchParams} locale={locale} dict={dict} />
      </Suspense>
    </>
  );
}

type Params = { genre?: string; author?: string; period?: string; sort?: string };

async function Results({
  searchParams,
  locale,
  dict,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  locale: Locale;
  dict: Dictionary;
}) {
  const raw = await searchParams;
  const p: Params = Object.fromEntries(
    Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]),
  ) as Params;
  const [works, genres, authors] = await Promise.all([listWorks(), getGenres(), getAuthors()]);

  let list = works.filter(
    (w) =>
      (!p.genre || w.genres.some((g) => g.slug === p.genre)) &&
      (!p.author || w.authors.some((a) => a.slug === p.author)) &&
      (!p.period || w.literary_period === p.period),
  );
  if (p.sort === "title") list = list.toSorted((a, b) => a.title_bn.localeCompare(b.title_bn, "bn"));
  else if (p.sort === "year") list = list.toSorted((a, b) => (a.original_pub_year ?? 0) - (b.original_pub_year ?? 0));

  const link = (patch: Partial<Params>) => {
    const next = { ...p, ...patch };
    const qs = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]).toString();
    return localizedPath(locale, `/books${qs ? `?${qs}` : ""}`);
  };
  const filtered = Boolean(p.genre || p.author || p.period);

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="space-y-4 border-y border-line py-5">
        <FilterRow
          label={dict.book.genre}
          all={dict.browse.allGenres}
          current={p.genre}
          allHref={link({ genre: undefined })}
          options={genres.filter((g) => g.count > 0).map((g) => ({ slug: g.slug, label: locale === "bn" ? g.name_bn : g.name_en, href: link({ genre: g.slug }) }))}
        />
        <FilterRow
          label={dict.book.by}
          all={dict.browse.allAuthors}
          current={p.author}
          allHref={link({ author: undefined })}
          options={authors.map((a) => ({ slug: a.slug, label: locale === "bn" ? a.name_bn : a.name_en, href: link({ author: a.slug }) }))}
        />
        <FilterRow
          label={dict.book.period}
          all={dict.browse.allPeriods}
          current={p.period}
          allHref={link({ period: undefined })}
          options={PERIODS.map((x) => ({ slug: x.slug, label: x[locale], href: link({ period: x.slug }) }))}
        />
      </div>

      <div className="mt-6 mb-8 flex flex-wrap items-center justify-between gap-4">
        <p className="text-fg-muted" aria-live="polite">
          {t(dict.browse.results, { count: formatNumber(list.length, locale) })}
          {filtered ? (
            <>
              {" "}
              <Link href={link({ genre: undefined, author: undefined, period: undefined })} className="ml-2 text-sm text-link underline underline-offset-4">
                {dict.actions.clearFilters}
              </Link>
            </>
          ) : null}
        </p>
        <nav aria-label={dict.browse.sort} className="flex items-center gap-1 text-sm">
          <span className="mr-2 text-fg-subtle">{dict.browse.sort}</span>
          {[
            { key: undefined, label: dict.browse.sortRecent },
            { key: "title", label: dict.browse.sortTitle },
            { key: "year", label: dict.browse.sortYear },
          ].map((s) => (
            <Link
              key={s.label}
              href={link({ sort: s.key })}
              aria-current={(p.sort ?? undefined) === s.key ? "true" : undefined}
              className={cn(
                "rounded-control px-3 py-1.5 transition-colors",
                (p.sort ?? undefined) === s.key ? "bg-cloth text-on-cloth" : "text-fg-muted hover:bg-sunken hover:text-fg",
              )}
            >
              {s.label}
            </Link>
          ))}
        </nav>
      </div>

      {list.length ? <BookGrid works={list} locale={locale} /> : <p className="py-16 text-center text-fg-muted">{dict.browse.empty}</p>}
    </div>
  );
}

function FilterRow({
  label,
  all,
  current,
  allHref,
  options,
}: {
  label: string;
  all: string;
  current?: string;
  allHref: string;
  options: { slug: string; label: string; href: string }[];
}) {
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-9 items-center rounded-full border px-3.5 text-sm transition-colors duration-200",
      active ? "border-cloth bg-cloth text-on-cloth" : "border-line-strong text-fg-muted hover:border-fg-subtle hover:text-fg",
    );
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
      <span className="w-28 shrink-0 text-sm text-fg-subtle">{label}</span>
      <ul className="shelf-scroll -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
        <li className="shrink-0">
          <Link href={allHref} className={chip(!current)} aria-current={!current ? "true" : undefined}>
            {all}
          </Link>
        </li>
        {options.map((o) => (
          <li key={o.slug} className="shrink-0">
            <Link href={o.href} className={chip(current === o.slug)} aria-current={current === o.slug ? "true" : undefined}>
              {o.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
