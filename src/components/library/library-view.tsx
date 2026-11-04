"use client";

import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Bookmark as BookmarkIcon, Trash2 } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { localDB, type LibraryEntry, type ReadingPosition } from "@/lib/local/db";
import { formatPercent } from "@/lib/i18n/format";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

type Labels = Dictionary["library"] & { want: string; remove: string; continueReading: string };

export function LibraryView({ locale, labels }: { locale: Locale; labels: Labels }) {
  const data = useLiveQuery(async () => {
    const db = localDB();
    const [positions, library, bookmarks] = await Promise.all([
      db.positions.orderBy("openedAt").reverse().toArray(),
      db.library.orderBy("updatedAt").reverse().toArray(),
      db.bookmarks.orderBy("createdAt").reverse().toArray(),
    ]);
    return { positions, library, bookmarks };
  }, []);

  if (!data) return <div className="min-h-64" aria-busy />;
  const reading = data.positions.filter((p) => !p.finished);
  const finished = data.positions.filter((p) => p.finished);
  const positionSlugs = new Set(data.positions.map((p) => p.workSlug));
  const saved = data.library.filter((e) => !positionSlugs.has(e.workSlug));
  const empty = !data.positions.length && !data.library.length && !data.bookmarks.length;

  if (empty) {
    return (
      <div className="rounded-[14px] border border-dashed border-line-strong px-6 py-14 text-center">
        <p className="mx-auto max-w-md text-fg-muted">{labels.empty}</p>
        <Link href={localizedPath(locale, "/")} className="mt-6 inline-flex h-11 items-center rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
          {labels.title === "আমার বই" ? "বই খুঁজুন" : "Find a book"}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-14">
      {reading.length ? (
        <Section title={labels.current}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {reading.map((p) => (
              <PositionRow key={p.workSlug} p={p} locale={locale} labels={labels} />
            ))}
          </ul>
        </Section>
      ) : null}

      {saved.length ? (
        <Section title={labels.want}>
          <ShelfGrid entries={saved} locale={locale} labels={labels} />
        </Section>
      ) : null}

      {finished.length ? (
        <Section title={labels.finished}>
          <ul className="grid grid-cols-3 gap-5 sm:grid-cols-5 lg:grid-cols-7">
            {finished.map((p) => (
              <li key={p.workSlug}>
                <Link href={localizedPath(locale, `/books/${p.workSlug}`)} className="group block">
                  <BookCover work={p.work} interactive />
                  <span className="mt-2 block truncate font-display">{p.work.title_bn}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title={labels.bookmarks}>
        {data.bookmarks.length ? (
          <ul className="divide-y divide-line border-y border-line">
            {data.bookmarks.map((b) => (
              <li key={b.id} className="flex items-start gap-4 py-4">
                <BookmarkIcon aria-hidden className="mt-1 size-5 shrink-0 text-accent" />
                <a
                  href={`${localizedPath(locale, `/read/${b.workSlug}`)}?cfi=${encodeURIComponent(b.cfi)}`}
                  className="min-w-0 flex-1 hover:text-link"
                >
                  <span className="block font-display text-lg">
                    {b.work.title_bn}
                    {b.chapter ? <span className="text-fg-muted">, {b.chapter}</span> : null}
                  </span>
                  <span className="mt-1 line-clamp-2 block font-read text-sm text-fg-muted">{b.excerpt}</span>
                </a>
                <button
                  type="button"
                  onClick={() => localDB().bookmarks.delete(b.id)}
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-control text-fg-subtle hover:bg-sunken hover:text-fg"
                  aria-label={`${labels.remove}: ${b.work.title_bn}`}
                >
                  <Trash2 aria-hidden className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-muted">{labels.emptyBookmarks}</p>
        )}
      </Section>

      <p className="text-sm text-fg-subtle">{labels.localNote}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-5 text-2xl sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function PositionRow({ p, locale, labels }: { p: ReadingPosition; locale: Locale; labels: Labels }) {
  return (
    <li>
      <a
        href={localizedPath(locale, `/read/${p.workSlug}`)}
        className="flex items-center gap-4 rounded-[14px] border border-line bg-surface p-3 pr-5 transition-colors hover:border-line-strong"
      >
        <div className="w-14 shrink-0">
          <BookCover work={p.work} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-lg">{p.work.title_bn}</p>
          <p className="truncate text-sm text-fg-muted">{p.chapter ?? p.work.authors[0]?.name_bn}</p>
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, p.fraction * 100)}%` }} />
            </div>
            <span className="text-xs text-fg-subtle">{t(labels.progress, { percent: formatPercent(p.fraction, locale) })}</span>
          </div>
        </div>
        <span className="sr-only">{labels.continueReading}</span>
      </a>
    </li>
  );
}

function ShelfGrid({ entries, locale, labels }: { entries: LibraryEntry[]; locale: Locale; labels: Labels }) {
  return (
    <ul className="grid grid-cols-3 gap-5 sm:grid-cols-5 lg:grid-cols-7">
      {entries.map((e) => (
        <li key={e.workSlug} className="group relative">
          <Link href={localizedPath(locale, `/books/${e.workSlug}`)} className="block">
            <BookCover work={e.work} interactive />
            <span className="mt-2 block truncate font-display">{e.work.title_bn}</span>
          </Link>
          <button
            type="button"
            onClick={() => localDB().library.delete(e.workSlug)}
            className="absolute top-1 right-1 inline-flex size-8 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={`${labels.remove}: ${e.work.title_bn}`}
          >
            <Trash2 aria-hidden className="size-4" />
          </button>
        </li>
      ))}
    </ul>
  );
}
