"use client";

import { useState } from "react";
import { ArrowLeft, Bookmark, BookmarkCheck, List, Maximize, Minimize, Minus, Plus, Search, Type } from "lucide-react";
import { chapterLabel, type Relocation, type SearchEvent, type TocItem } from "@/lib/reader/engine";
import type { Annotation, Bookmark as BookmarkRow, WorkSnapshot } from "@/lib/local/db";
import { SWATCH } from "@/lib/reader/annotations";
import { FONTS, THEMES, type ReaderSettings, LINE_HEIGHTS, stepFontSize } from "@/lib/reader/settings";
import { formatDuration, formatNumber, formatPercent } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import { Sheet } from "./sheet";
import { SearchSheet } from "./search-sheet";

type Labels = Dictionary["reader"] & { back: string; allNotes: string; notesHref: string };
export type ReaderSheet = null | "toc" | "settings" | "search";

export function ReaderChrome(props: {
  visible: boolean;
  locale: Locale;
  work: WorkSnapshot;
  bookHref: string;
  labels: Labels;
  location: Relocation | null;
  toc: TocItem[];
  sectionFractions: number[];
  bookmarks: BookmarkRow[];
  annotations: Annotation[];
  /** estimated seconds left, from the reader's own speed */
  timeLeft: { chapter: number; book: number } | null;
  bookmarked: boolean;
  onToggleBookmark: () => void;
  sheet: ReaderSheet;
  onSheet: (s: ReaderSheet) => void;
  /** a search started from a selection (a new `n` starts it afresh) */
  searchSeed: { q: string; n: number };
  onSearch: (q: string) => AsyncGenerator<SearchEvent>;
  onClearSearch: () => void;
  settings: ReaderSettings;
  onSettings: (p: Partial<ReaderSettings>) => void;
  /** full screen, where the browser offers it */
  fullscreen: { supported: boolean; active: boolean; toggle: () => void };
  columnsAvailable: boolean;
  onGoTo: (target: string) => void;
  onGoToFraction: (f: number) => void;
  onPointerActivity: (e: React.PointerEvent) => void;
}) {
  const { visible, labels, location, locale, work } = props;
  const fraction = location?.fraction ?? 0;
  const left = location ? location.pages - location.page : 0;

  const bar =
    "pointer-events-auto transition-[opacity,transform] duration-300 ease-paper motion-reduce:transition-none";
  const iconBtn =
    "inline-flex size-11 items-center justify-center rounded-full text-[var(--ink)] transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--ink)_8%,transparent)]";

  return (
    <>
      {/* top bar */}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-20 pt-safe",
          bar,
          visible ? "translate-y-0 opacity-100" : "-translate-y-3 opacity-0",
        )}
        aria-hidden={!visible}
        inert={!visible}
        data-reader-chrome
        onPointerMove={props.onPointerActivity}
      >
        <div className="pointer-events-auto flex h-14 items-center gap-1 border-b border-[color-mix(in_oklab,var(--ink)_10%,transparent)] bg-[var(--paper)] px-2 sm:px-4">
          <a href={props.bookHref} className={iconBtn} aria-label={labels.exit}>
            <ArrowLeft aria-hidden className="size-5" />
          </a>
          <div className="min-w-0 flex-1 px-1 text-center">
            <p className="truncate font-display text-[1.05rem] leading-tight">{work.title_bn}</p>
            {location?.tocLabel ? (
              <p className="truncate text-xs text-[var(--ink-muted)]">{chapterLabel(location.tocLabel, labels.chapterOf)}</p>
            ) : null}
          </div>
          <button type="button" className={iconBtn} aria-label={labels.search} onClick={() => props.onSheet("search")}>
            <Search aria-hidden className="size-5" />
          </button>
          <button type="button" className={iconBtn} aria-label={labels.contents} onClick={() => props.onSheet("toc")}>
            <List aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            className={cn(iconBtn, props.bookmarked && "text-accent")}
            aria-label={props.bookmarked ? labels.removeBookmark : labels.bookmark}
            aria-pressed={props.bookmarked}
            onClick={props.onToggleBookmark}
          >
            {props.bookmarked ? (
              <BookmarkCheck aria-hidden className="size-5 animate-in zoom-in-75 fill-current duration-300" />
            ) : (
              <Bookmark aria-hidden className="size-5" />
            )}
          </button>
          <button type="button" className={iconBtn} aria-label={labels.settings} onClick={() => props.onSheet("settings")}>
            <Type aria-hidden className="size-5" />
          </button>
          {props.fullscreen.supported ? (
            <button
              type="button"
              className={cn(iconBtn, "hidden sm:inline-flex")}
              aria-label={props.fullscreen.active ? labels.exitFullscreen : labels.fullscreen}
              aria-pressed={props.fullscreen.active}
              onClick={props.fullscreen.toggle}
            >
              {props.fullscreen.active ? <Minimize aria-hidden className="size-5" /> : <Maximize aria-hidden className="size-5" />}
            </button>
          ) : null}
        </div>
      </div>

      {/* bookmark ribbon on the page itself */}
      {props.bookmarked ? (
        <div
          aria-hidden
          className="pointer-events-none fixed top-0 right-[12%] z-10 h-12 w-5 animate-in slide-in-from-top-4 duration-300 sm:right-[18%]"
          style={{ background: "var(--color-accent)", clipPath: "polygon(0 0,100% 0,100% 100%,50% 78%,0 100%)" }}
        />
      ) : null}

      {/* bottom bar */}
      <div
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-20 pb-safe",
          bar,
          visible ? "translate-y-0 opacity-100" : "translate-y-3 opacity-0",
        )}
        aria-hidden={!visible}
        inert={!visible}
        data-reader-chrome
        onPointerMove={props.onPointerActivity}
      >
        <div className="pointer-events-auto border-t border-[color-mix(in_oklab,var(--ink)_10%,transparent)] bg-[var(--paper)] px-4 pt-3 pb-4 sm:px-6">
          <ProgressSlider
            fraction={fraction}
            ticks={props.sectionFractions}
            label={labels.progress}
            onCommit={props.onGoToFraction}
            valueText={formatPercent(fraction, locale)}
          />
          <div className="mt-1 flex items-center justify-between gap-4 text-xs text-[var(--ink-muted)]">
            <span className="flex gap-3">
              <span>{formatPercent(fraction, locale)}</span>
              {props.timeLeft && props.timeLeft.book >= 60 ? (
                <span className="hidden sm:inline">{t(labels.timeLeftBook, { time: formatDuration(props.timeLeft.book, locale) })}</span>
              ) : null}
            </span>
            <span className="text-right">
              {!location
                ? null
                : left <= 0
                  ? labels.lastPageOfChapter
                  : props.timeLeft
                    ? props.timeLeft.chapter < 60
                      ? labels.chapterAlmostDone
                      : t(labels.timeLeftChapter, { time: formatDuration(props.timeLeft.chapter, locale) })
                    : t(labels.pagesLeftInChapter, { count: formatNumber(left, locale) })}
            </span>
          </div>
        </div>
      </div>

      {/* always-present hairline progress when the chrome is hidden */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed inset-x-0 bottom-0 z-10 h-[2px] transition-opacity duration-300",
          visible ? "opacity-0" : "opacity-100",
        )}
      >
        <div className="h-full bg-accent/70" style={{ width: `${fraction * 100}%` }} />
      </div>

      <TocSheet {...props} />
      <SearchSheet
        key={props.searchSeed.n}
        open={props.sheet === "search"}
        onOpenChange={(o) => props.onSheet(o ? "search" : null)}
        initialQuery={props.searchSeed.q}
        search={props.onSearch}
        clear={props.onClearSearch}
        onGoTo={props.onGoTo}
        labels={labels}
        locale={locale}
      />
      <SettingsSheet {...props} />
    </>
  );
}

function ProgressSlider({
  fraction,
  ticks,
  label,
  valueText,
  onCommit,
}: {
  fraction: number;
  ticks: number[];
  label: string;
  valueText: string;
  onCommit: (f: number) => void;
}) {
  // a value being dragged; dropped as soon as the reader arrives somewhere new
  const [value, setValue] = useState<number | null>(null);
  const [seen, setSeen] = useState(fraction);
  if (seen !== fraction) {
    setSeen(fraction);
    setValue(null);
  }
  const shown = value ?? fraction;
  const commit = () => {
    if (value != null) onCommit(value);
  };
  return (
    <div className="relative h-8">
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[color-mix(in_oklab,var(--ink)_14%,transparent)]">
        <div className="h-full rounded-full bg-accent" style={{ width: `${shown * 100}%` }} />
        {ticks.slice(1, -1).map((tk, i) =>
          ticks.length <= 40 ? (
            <span
              key={i}
              className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-[color-mix(in_oklab,var(--ink)_28%,transparent)]"
              style={{ left: `${tk * 100}%` }}
            />
          ) : null,
        )}
      </div>
      <input
        type="range"
        min={0}
        max={1000}
        step={1}
        value={Math.round(shown * 1000)}
        aria-label={label}
        aria-valuetext={valueText}
        onChange={(e) => setValue(Number(e.target.value) / 1000)}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
        className="reader-range absolute inset-0 w-full cursor-pointer appearance-none bg-transparent"
      />
    </div>
  );
}

function TocSheet(props: Parameters<typeof ReaderChrome>[0]) {
  const { labels, location, locale } = props;
  const [tab, setTab] = useState<"toc" | "bookmarks" | "highlights">("toc");
  const current = location?.tocHref;
  const item = (it: TocItem, depth: number): React.ReactNode => (
    <li key={it.href + it.label}>
      <button
        type="button"
        onClick={() => props.onGoTo(it.href)}
        aria-current={current === it.href ? "true" : undefined}
        className={cn(
          "flex w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]",
          depth > 0 && "pl-9",
          current === it.href && "bg-[color-mix(in_oklab,var(--color-accent)_14%,transparent)]",
        )}
      >
        <span className={cn("min-w-0 flex-1", depth === 0 && it.subitems?.length ? "font-display text-lg" : "")}>
          {chapterLabel(it.label, labels.chapterOf)}
        </span>
        {current === it.href ? <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent" /> : null}
      </button>
      {it.subitems?.length ? <ul>{it.subitems.map((s) => item(s, depth + 1))}</ul> : null}
    </li>
  );
  return (
    <Sheet open={props.sheet === "toc"} onOpenChange={(o) => props.onSheet(o ? "toc" : null)} title={labels.contents} side="left" closeLabel={labels.closeMenu}>
      <div role="tablist" className="flex gap-1 px-4 pt-3">
        {(["toc", "highlights", "bookmarks"] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              "h-9 rounded-full px-4 text-sm transition-colors",
              tab === k ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink-muted)] hover:text-[var(--ink)]",
            )}
          >
            {k === "toc"
              ? labels.contents
              : k === "highlights"
                ? `${labels.highlights} (${formatNumber(props.annotations.length, locale)})`
                : `${labels.bookmarks} (${formatNumber(props.bookmarks.length, locale)})`}
          </button>
        ))}
      </div>
      {tab === "toc" ? (
        <nav aria-label={labels.contents} className="py-2">
          <ul>{props.toc.map((it) => item(it, 0))}</ul>
        </nav>
      ) : tab === "highlights" ? (
        <HighlightList {...props} />
      ) : props.bookmarks.length ? (
        <ul className="py-2">
          {props.bookmarks.map((b) => (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => props.onGoTo(b.cfi)}
                className="w-full px-5 py-3 text-left hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]"
              >
                <span className="block text-sm text-[var(--ink-muted)]">
                  {chapterLabel(b.chapter, labels.chapterOf) ?? ""} {formatPercent(b.fraction, locale)}
                </span>
                <span className="mt-0.5 line-clamp-2 block font-read text-[0.95rem]">{b.excerpt}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-[var(--ink-muted)]">{labels.noBookmarks}</p>
      )}
    </Sheet>
  );
}

function HighlightList({ annotations, labels, locale, onGoTo }: Parameters<typeof ReaderChrome>[0]) {
  if (!annotations.length) return <p className="px-5 py-6 text-sm text-[var(--ink-muted)]">{labels.noHighlights}</p>;
  return (
    <>
      <ul className="py-2">
        {annotations.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => onGoTo(a.cfi)}
              className="flex w-full gap-3 px-5 py-3 text-left hover:bg-[color-mix(in_oklab,var(--ink)_6%,transparent)]"
            >
              <span
                aria-hidden
                className="mt-1 w-[3px] shrink-0 self-stretch rounded-full"
                style={{ background: a.style === "underline" ? "var(--color-accent)" : SWATCH[a.color] }}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-[var(--ink-muted)]">
                  {chapterLabel(a.chapter, labels.chapterOf) ?? ""} {formatPercent(a.fraction, locale)}
                </span>
                <span className="mt-0.5 line-clamp-3 block font-read text-[0.95rem]">{a.quote}</span>
                {a.note ? (
                  <span className="mt-1.5 line-clamp-3 block border-l border-[color-mix(in_oklab,var(--ink)_25%,transparent)] pl-2 text-sm text-[var(--ink-muted)]">
                    {a.note}
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="px-5 pt-1 pb-5">
        <a href={labels.notesHref} className="text-sm underline decoration-[var(--color-accent)] underline-offset-4">
          {labels.allNotes}
        </a>
      </p>
    </>
  );
}

function Segmented<T extends string | number | boolean>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: React.ReactNode; aria?: string; style?: React.CSSProperties }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="px-5 py-3">
      <legend className="mb-2 text-sm text-[var(--ink-muted)]">{label}</legend>
      <div role="radiogroup" className="flex gap-2">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            aria-label={o.aria}
            onClick={() => onChange(o.value)}
            style={o.style}
            className={cn(
              "min-h-11 flex-1 rounded-[10px] border px-2 py-2 text-sm transition-colors duration-150",
              value === o.value
                ? "border-[var(--ink)] ring-1 ring-[var(--ink)]"
                : "border-[color-mix(in_oklab,var(--ink)_18%,transparent)] hover:border-[color-mix(in_oklab,var(--ink)_40%,transparent)]",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function SettingsSheet(props: Parameters<typeof ReaderChrome>[0]) {
  const { labels, settings: s, onSettings, locale } = props;
  return (
    <Sheet open={props.sheet === "settings"} onOpenChange={(o) => props.onSheet(o ? "settings" : null)} title={labels.settings} closeLabel={labels.closeMenu}>
      <div className="py-2">
        <div className="flex items-center gap-3 px-5 py-3">
          <span className="flex-1 text-sm text-[var(--ink-muted)]">{labels.fontSize}</span>
          <button
            type="button"
            aria-label={labels.smaller}
            onClick={() => onSettings({ fontSize: stepFontSize(s.fontSize, -1) })}
            className="inline-flex size-11 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--ink)_18%,transparent)]"
          >
            <Minus aria-hidden className="size-4" />
          </button>
          <span className="w-14 text-center tabular-nums" aria-live="polite">
            {formatNumber(s.fontSize, locale)}%
          </span>
          <button
            type="button"
            aria-label={labels.larger}
            onClick={() => onSettings({ fontSize: stepFontSize(s.fontSize, 1) })}
            className="inline-flex size-11 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--ink)_18%,transparent)]"
          >
            <Plus aria-hidden className="size-4" />
          </button>
        </div>

        <Segmented
          label={labels.theme}
          value={s.theme}
          onChange={(theme) => onSettings({ theme })}
          options={(["light", "sepia", "dark"] as const).map((k) => ({
            value: k,
            label: { light: labels.themeLight, sepia: labels.themeSepia, dark: labels.themeDark }[k],
            style: { background: THEMES[k].paper, color: THEMES[k].ink },
          }))}
        />

        <Segmented
          label={labels.font}
          value={s.font}
          onChange={(font) => onSettings({ font })}
          options={(Object.keys(FONTS) as (keyof typeof FONTS)[]).map((k) => ({
            value: k,
            label: <span style={{ fontFamily: FONTS[k].family }} className="text-base">অআক</span>,
            aria: FONTS[k].label,
          }))}
        />

        <Segmented
          label={labels.lineSpacing}
          value={s.lineHeight}
          onChange={(lineHeight) => onSettings({ lineHeight })}
          options={LINE_HEIGHTS.map((lh) => ({ value: lh, label: formatNumber(lh, locale, { minimumFractionDigits: 1 }) }))}
        />

        <Segmented
          label={labels.margins}
          value={s.margin}
          onChange={(margin) => onSettings({ margin })}
          options={[
            { value: "narrow" as const, label: labels.narrow },
            { value: "medium" as const, label: labels.medium },
            { value: "wide" as const, label: labels.wide },
          ]}
        />

        {props.columnsAvailable ? (
          <Segmented
            label={labels.layout}
            value={s.layout}
            onChange={(layout) => onSettings({ layout })}
            options={[
              { value: "auto" as const, label: labels.layoutAuto },
              { value: "single" as const, label: labels.layoutSingle },
              { value: "spread" as const, label: labels.layoutSpread },
            ]}
          />
        ) : null}

        <Segmented
          label={labels.flow}
          value={s.flow}
          onChange={(flow) => onSettings({ flow })}
          options={[
            { value: "paginated" as const, label: labels.flowPaginated },
            { value: "scrolled" as const, label: labels.flowScrolled },
          ]}
        />

        {s.flow === "paginated" ? (
          <Segmented
            label={labels.animations}
            value={s.turn}
            onChange={(turn) => onSettings({ turn })}
            options={[
              { value: "curl" as const, label: labels.turnCurl },
              { value: "slide" as const, label: labels.turnSlide },
              { value: "fade" as const, label: labels.turnFade },
              { value: "none" as const, label: labels.turnNone },
            ]}
          />
        ) : null}

        {props.fullscreen.supported ? (
          <div className="space-y-1 px-5 py-3">
            <button
              type="button"
              role="switch"
              aria-checked={props.fullscreen.active}
              onClick={props.fullscreen.toggle}
              className="flex min-h-11 w-full items-center justify-between gap-4 text-left"
            >
              <span className="text-sm">{props.fullscreen.active ? labels.exitFullscreen : labels.fullscreen}</span>
              <span
                aria-hidden
                className={cn(
                  "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200",
                  props.fullscreen.active
                    ? "bg-[var(--color-accent)]"
                    : "bg-[color-mix(in_oklab,var(--ink)_18%,transparent)]",
                )}
              >
                <span
                  className={cn(
                    "absolute top-[3px] size-5 rounded-full bg-[var(--paper)] shadow-sm transition-[left] duration-200",
                    props.fullscreen.active ? "left-[21px]" : "left-[3px]",
                  )}
                />
              </span>
            </button>
          </div>
        ) : null}

        <div className="space-y-1 px-5 py-3">
          <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4">
            <span className="text-sm">{labels.justify}</span>
            <input
              type="checkbox"
              checked={s.justify}
              onChange={(e) => onSettings({ justify: e.target.checked })}
              className="size-5 accent-[var(--color-accent)]"
            />
          </label>
        </div>
      </div>
    </Sheet>
  );
}
