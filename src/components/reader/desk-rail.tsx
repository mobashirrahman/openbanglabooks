"use client";

import type { Bookmark as BookmarkRow } from "@/lib/local/db";
import type { TocItem } from "@/lib/reader/engine";
import { cn } from "@/lib/utils";

/**
 * A quiet index in the desk margin of a wide screen: one tick per top-level
 * chapter, the reader's position, and any bookmark dots. It is only drawn when
 * the book leaves enough desk beside it (see Reader); the rail is never laid
 * over the page. Ticks are real buttons, so the same index works by keyboard.
 */
export function DeskRail({
  toc,
  bookmarks,
  fraction,
  currentHref,
  top,
  height,
  right,
  dimmed,
  labels,
  onGoTo,
}: {
  toc: TocItem[];
  bookmarks: BookmarkRow[];
  fraction: number;
  currentHref: string | null;
  top: number;
  height: number;
  right: number;
  dimmed: boolean;
  labels: { contents: string; bookmarks: string; chapterOf: string };
  onGoTo: (target: string) => void;
}) {
  const chapters = toc.filter((it) => typeof it.fraction === "number" && it.fraction >= 0 && it.fraction <= 1);
  if (chapters.length < 2 || height < 160) return null;

  const label = (it: TocItem) => {
    const text = it.label?.trim() ?? "";
    return /^[০-৯0-9]+$/.test(text) ? `${labels.chapterOf} ${text}` : text;
  };

  return (
    <nav
      aria-label={labels.contents}
      className={cn(
        "pointer-events-none absolute z-10 w-10 transition-opacity duration-300",
        dimmed ? "opacity-50" : "opacity-90",
        "hover:opacity-100 focus-within:opacity-100",
      )}
      style={{ top, height, right }}
    >
      {/* the line of the book's length */}
      <div
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-[color-mix(in_oklab,var(--ink)_18%,transparent)]"
      />

      {/* where the reader is */}
      <div
        aria-hidden
        className="absolute left-1/2 h-[3px] w-5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] shadow-sm"
        style={{ top: `${fraction * 100}%` }}
      />

      {chapters.map((it) => {
        const current = Boolean(currentHref && it.href === currentHref);
        return (
          <button
            key={`${it.href}:${it.label}`}
            type="button"
            onClick={() => onGoTo(it.href)}
            aria-current={current ? "true" : undefined}
            aria-label={label(it)}
            title={label(it)}
            className="group pointer-events-auto absolute left-1/2 flex h-4 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ top: `${(it.fraction as number) * 100}%` }}
          >
            <span
              aria-hidden
              className={cn(
                "block h-px rounded-full transition-all duration-150",
                current
                  ? "w-3.5 bg-[var(--color-accent)]"
                  : "w-2 bg-[color-mix(in_oklab,var(--ink)_30%,transparent)] group-hover:w-3.5 group-hover:bg-[var(--ink)] group-focus-visible:w-3.5 group-focus-visible:bg-[var(--ink)]",
              )}
            />
            <span className="pointer-events-none absolute right-full mr-2 hidden max-w-52 truncate rounded-md bg-[var(--ink)] px-2 py-1 text-xs whitespace-nowrap text-[var(--paper)] shadow-md group-hover:block group-focus-visible:block">
              {label(it)}
            </span>
          </button>
        );
      })}

      {/* bookmarks sit just beside the line, like slips of paper in the fore-edge */}
      {bookmarks.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onGoTo(b.cfi)}
          aria-label={`${labels.bookmarks}: ${b.excerpt || b.chapter || ""}`.trim()}
          title={b.excerpt || b.chapter || labels.bookmarks}
          className="pointer-events-auto absolute left-[calc(50%+6px)] size-2 -translate-y-1/2 rounded-full bg-[var(--color-accent)] ring-2 ring-[var(--paper)] transition-transform duration-150 hover:scale-150 focus-visible:scale-150"
          style={{ top: `${b.fraction * 100}%` }}
        />
      ))}
    </nav>
  );
}
