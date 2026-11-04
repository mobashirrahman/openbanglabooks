"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { BookCover } from "@/components/cover/book-cover";
import { localDB, markHasProgress } from "@/lib/local/db";
import { formatPercent } from "@/lib/i18n/format";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import { useEffect } from "react";

type Labels = { title: string; progress: string; continueReading: string };

/**
 * The books the reader has open on this device, most recent first. The slot
 * is reserved before hydration (html[data-reading]) so nothing shifts.
 */
export function ContinueReading({ locale, labels }: { locale: Locale; labels: Labels }) {
  const positions = useLiveQuery(
    () => localDB().positions.orderBy("openedAt").reverse().filter((p) => !p.finished).limit(4).toArray(),
    [],
  );

  useEffect(() => {
    if (positions) markHasProgress(positions.length > 0);
  }, [positions]);

  if (!positions?.length) {
    return <div className="continue-slot hidden" aria-hidden />;
  }
  const [first, ...rest] = positions;
  return (
    <section aria-labelledby="continue-heading" className="continue-slot mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <h2 id="continue-heading" className="mb-4 text-2xl leading-snug sm:text-[2.2rem]">
        {labels.title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[first, ...rest].slice(0, 3).map((p) => (
          <a
            key={p.workSlug}
            href={localizedPath(locale, `/read/${p.workSlug}`)}
            className="group flex items-center gap-4 rounded-[14px] border border-line bg-surface p-3 pr-5 transition-colors duration-200 hover:border-line-strong"
          >
            <div className="w-14 shrink-0">
              <BookCover work={p.work} interactive />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-lg leading-snug">{p.work.title_bn}</p>
              <p className="truncate text-sm text-fg-muted">{p.chapter ?? p.work.authors[0]?.name_bn}</p>
              <div className="mt-2 flex items-center gap-3">
                <div
                  className="h-1 flex-1 overflow-hidden rounded-full bg-sunken"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(p.fraction * 100)}
                  aria-label={t(labels.progress, { percent: formatPercent(p.fraction, locale) })}
                >
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, p.fraction * 100)}%` }} />
                </div>
                <span className="text-xs text-fg-subtle tabular-nums">{formatPercent(p.fraction, locale)}</span>
              </div>
            </div>
            <span className="sr-only">{labels.continueReading}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
