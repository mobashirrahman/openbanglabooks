"use client";

import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudOff, RotateCw } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { formatPercent } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { readableOffline } from "@/lib/offline/books";

export function OfflineView({ locale, labels }: { locale: Locale; labels: Dictionary["offline"] }) {
  const books = useLiveQuery(() => readableOffline(locale), [locale]);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  return (
    <div className="mx-auto max-w-3xl px-4 pt-12 pb-10 sm:px-6 sm:pt-16">
      <CloudOff aria-hidden className="size-10 text-fg-subtle" />
      <h1 className="mt-5 text-4xl leading-snug sm:text-5xl">{labels.title}</h1>
      <p className="mt-3 max-w-xl text-fg-muted">{labels.body}</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => location.reload()}
          className="inline-flex h-11 items-center gap-2 rounded-control bg-cloth px-5 text-on-cloth transition-colors duration-200 hover:bg-cloth-raised"
        >
          <RotateCw aria-hidden className="size-4" />
          {labels.retry}
        </button>
        <a href={localizedPath(locale, "/library")} className="inline-flex h-11 items-center rounded-control border border-line-strong px-4 hover:bg-sunken">
          {labels.library}
        </a>
        <a href={localizedPath(locale, "/notes")} className="inline-flex h-11 items-center rounded-control border border-line-strong px-4 hover:bg-sunken">
          {labels.notes}
        </a>
      </div>
      <p role="status" className="mt-3 min-h-6 text-sm text-fg-muted">
        {online ? labels.backOnline : null}
      </p>

      <section aria-labelledby="offline-books" className="mt-8">
        <h2 id="offline-books" className="text-2xl">
          {labels.booksHere}
        </h2>
        {books === undefined ? (
          <div className="min-h-24" aria-busy />
        ) : books.length ? (
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {books.map((b) => (
              <li key={b.slug}>
                <a
                  href={b.href}
                  className="flex items-center gap-4 rounded-[14px] border border-line bg-surface p-3 pr-5 transition-colors duration-200 hover:border-line-strong"
                >
                  <div className="w-12 shrink-0">
                    <BookCover work={b.work} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg leading-snug">{b.work.title_bn}</p>
                    <p className="truncate text-sm text-fg-muted">{b.work.authors[0]?.name_bn}</p>
                  </div>
                  <span className="text-xs text-fg-subtle tabular-nums">{formatPercent(b.fraction, locale)}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-fg-muted">{labels.noBooks}</p>
        )}
      </section>
    </div>
  );
}
