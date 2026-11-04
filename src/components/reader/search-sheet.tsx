"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { SearchEvent, SearchHit } from "@/lib/reader/engine";
import { chapterLabel } from "@/lib/reader/engine";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { t } from "@/lib/i18n/t";
import { Sheet } from "./sheet";

const MAX_RESULTS = 300;
const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("bn", { granularity: "grapheme" }) : null;
const letterCount = (s: string) => (graphemes ? [...graphemes.segment(s)].length : s.length);

type Found = { query: string; groups: { label: string; hits: SearchHit[] }[]; count: number; progress: number; done: boolean };

/**
 * Search inside the open book. Results arrive chapter by chapter (with
 * progress), each with the words around the match; choosing one jumps
 * there, and the matches stay outlined on the page until the search changes.
 * Stays mounted while closed, so reopening shows the last search.
 */
export function SearchSheet({
  open,
  onOpenChange,
  initialQuery = "",
  search,
  clear,
  onGoTo,
  labels,
  locale,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialQuery?: string;
  search: (q: string) => AsyncGenerator<SearchEvent>;
  clear: () => void;
  onGoTo: (cfi: string) => void;
  labels: Dictionary["reader"];
  locale: Locale;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [found, setFound] = useState<Found | null>(null);
  const q = query.trim();
  const tooShort = letterCount(q) < 2;

  useEffect(() => {
    if (tooShort) {
      clear();
      return;
    }
    let cancelled = false;
    let iter: AsyncGenerator<SearchEvent> | null = null;
    const timer = setTimeout(async () => {
      iter = search(q);
      setFound({ query: q, groups: [], count: 0, progress: 0, done: false });
      try {
        for await (const ev of iter) {
          if (cancelled) break;
          if (ev.kind === "progress") setFound((f) => f && { ...f, progress: ev.progress });
          else if (ev.kind === "results")
            setFound((f) => {
              if (!f || f.count >= MAX_RESULTS) return f && { ...f, count: f.count + ev.hits.length };
              const room = MAX_RESULTS - f.count;
              return { ...f, groups: [...f.groups, { label: ev.label, hits: ev.hits.slice(0, room) }], count: f.count + ev.hits.length };
            });
          else setFound((f) => f && { ...f, progress: 1, done: true });
        }
      } catch {
        /* a section failed to parse: keep what was found */
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      void iter?.return(undefined);
    };
  }, [q, tooShort, search, clear]);

  const current = found && found.query === q ? found : null;
  const shown = current ? current.groups.reduce((n, g) => n + g.hits.length, 0) : 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={labels.search} side="right" closeLabel={labels.closeMenu}>
      <div className="px-4 pt-4 pb-2">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 opacity-60" />
          <label htmlFor="book-search" className="sr-only">
            {labels.search}
          </label>
          <input
            id="book-search"
            type="search"
            autoFocus
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.searchPlaceholder}
            className="h-11 w-full rounded-[12px] border border-[color-mix(in_oklab,var(--ink)_18%,transparent)] bg-transparent pr-3 pl-10 text-base outline-none placeholder:text-[var(--ink-muted)] focus:border-[color-mix(in_oklab,var(--ink)_45%,transparent)]"
          />
        </div>
        <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-[var(--ink-muted)]">
          {!q
            ? ""
            : tooShort
              ? labels.searchMinChars
              : !current
                ? t(labels.searching, { percent: formatPercent(0, locale) })
                : !current.done
                  ? t(labels.searching, { percent: formatPercent(current.progress, locale) })
                  : current.count
                    ? t(labels.searchResults, { count: formatNumber(current.count, locale) })
                    : t(labels.noSearchResults, { query: q })}
        </p>
      </div>
      {current?.groups.length ? (
        <div className="pb-4">
          {current.groups.map((g, gi) => (
            <section key={`${gi}-${g.label}`} aria-label={chapterLabel(g.label, labels.chapterOf) ?? undefined}>
              <h3 className="sticky top-0 bg-[var(--paper)] px-5 pt-3 pb-1 text-xs font-medium text-[var(--ink-muted)]">
                {chapterLabel(g.label, labels.chapterOf)}
              </h3>
              <ul>
                {g.hits.map((h) => (
                  <li key={h.cfi}>
                    <button
                      type="button"
                      onClick={() => onGoTo(h.cfi)}
                      className="w-full px-5 py-2.5 text-left font-read text-[0.95rem] leading-relaxed hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]"
                    >
                      {h.excerpt.pre}
                      <mark className="rounded-[3px] bg-[color-mix(in_oklab,var(--color-accent)_24%,transparent)] px-0.5 text-[var(--ink)]">
                        {h.excerpt.match}
                      </mark>
                      {h.excerpt.post}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {current.count > shown ? (
            <p className="px-5 pt-3 text-sm text-[var(--ink-muted)]">{t(labels.searchMore, { count: formatNumber(shown, locale) })}</p>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
