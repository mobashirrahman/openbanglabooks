"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Lock, Star } from "lucide-react";
import { localDB, type LibraryEntry, type WorkSnapshot } from "@/lib/local/db";
import { setRating, setReflection } from "@/lib/library/store";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { cn } from "@/lib/utils";

type Labels = Pick<
  Dictionary["library"],
  "yourPage" | "myRating" | "stars" | "clearRating" | "reflection" | "reflectionHint" | "reflectionPlaceholder" | "saved"
>;

/**
 * The reader's own page for a book in their library: a rating and a private
 * reflection. Shown only once the book is in the library; never public.
 */
export function MyBookPage({ work, locale, labels }: { work: WorkSnapshot; locale: Locale; labels: Labels }) {
  const entry = useLiveQuery(() => localDB().library.get(work.slug), [work.slug]);
  if (!entry) return null;
  return (
    <section aria-labelledby="your-page-heading" className="rounded-[16px] border border-line bg-surface p-5 sm:p-6">
      <h2 id="your-page-heading" className="flex items-center gap-2 text-2xl">
        {labels.yourPage}
        <Lock aria-hidden className="size-4 text-fg-subtle" />
      </h2>
      <p className="mt-1 text-sm text-fg-subtle">{labels.reflectionHint}</p>
      <Rating entry={entry} work={work} locale={locale} labels={labels} />
      <Reflection key={entry.workSlug} entry={entry} work={work} labels={labels} />
    </section>
  );
}

function Rating({ entry, work, locale, labels }: { entry: LibraryEntry; work: WorkSnapshot; locale: Locale; labels: Labels }) {
  const value = entry.rating ?? 0;
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="mt-5">
      <p id="rating-label" className="mb-2 text-sm text-fg-muted">
        {labels.myRating}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-labelledby="rating-label" className="flex" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={t(labels.stars, { count: formatNumber(n, locale) })}
              onMouseEnter={() => setHover(n)}
              onClick={() => void setRating(work, n)}
              onKeyDown={(e) => {
                if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                  e.preventDefault();
                  void setRating(work, Math.min(5, value + 1));
                } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                  e.preventDefault();
                  void setRating(work, Math.max(1, value - 1));
                }
              }}
              tabIndex={value ? (value === n ? 0 : -1) : n === 1 ? 0 : -1}
              className="inline-flex size-11 items-center justify-center rounded-control hover:bg-sunken"
            >
              <Star
                aria-hidden
                className={cn("size-6 transition-colors duration-150", n <= shown ? "fill-foil text-foil-text" : "text-line-strong")}
              />
            </button>
          ))}
        </div>
        {value ? (
          <button type="button" onClick={() => void setRating(work, null)} className="text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline">
            {labels.clearRating}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Reflection({ entry, work, labels }: { entry: LibraryEntry; work: WorkSnapshot; labels: Labels }) {
  const [text, setText] = useState(entry.reflection ?? "");
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);
  const stored = entry.reflection ?? "";

  // saved as the reader types (after a pause) and when leaving the field
  const save = async (value: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (value.trim() === stored.trim()) return;
    await setReflection(work, value);
    setSaved(true);
  };
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        void setReflection(work, latest.current);
      }
    },
    [work],
  );

  return (
    <div className="mt-6">
      <label htmlFor="reflection" className="mb-2 flex items-center justify-between text-sm text-fg-muted">
        <span>{labels.reflection}</span>
        <span role="status" className="text-xs text-fg-subtle">
          {saved ? labels.saved : ""}
        </span>
      </label>
      <textarea
        id="reflection"
        value={text}
        maxLength={20000}
        rows={4}
        placeholder={labels.reflectionPlaceholder}
        onChange={(e) => {
          const v = e.target.value;
          setText(v);
          latest.current = v;
          setSaved(false);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => void save(v), 800);
        }}
        onBlur={() => void save(text)}
        className="w-full resize-y rounded-[12px] border border-line-strong bg-bg px-4 py-3 font-read text-[1.05rem] leading-relaxed outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
      />
    </div>
  );
}
