"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Check, Download, FileUp, LoaderCircle, TriangleAlert } from "lucide-react";
import { localDB, type LibraryStatus, type WorkSnapshot } from "@/lib/local/db";
import type { WorkNames } from "@/lib/catalog/queries";
import { formatNumber } from "@/lib/i18n/format";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { personalSnapshot } from "@/lib/personal/store";
import type { GoodreadsBook } from "@/lib/transfer/goodreads";
import type { Match, MatchWork } from "@/lib/transfer/match";
import { cn } from "@/lib/utils";

type Labels = Dictionary["transfer"] & Record<"statusWant" | "statusReading" | "statusFinished" | "statusDnf", string>;
type Row = { book: GoodreadsBook; match: Match; choice: string };
type State =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "matching"; done: number; total: number }
  | { kind: "review"; rows: Row[] }
  | { kind: "applying"; rows: Row[] }
  | { kind: "done"; text: string }
  | { kind: "error"; message: string };

const MAX_BYTES = 10 * 1024 * 1024;

/** A catalogue work, or one of the reader's own books, as the matcher, the picker and the library see it. */
type Known = { slug: string; label: string; snapshot: WorkSnapshot; match: MatchWork; title_en: string | null; author_en: string | null; year: number | null };

function catalogueBook(w: WorkNames, locale: Locale): Known {
  const authorBn = w.authors.map((a) => a.name_bn).join(", ");
  const authorEn = w.authors.map((a) => a.name_en).join(", ");
  return {
    slug: w.slug,
    label: locale === "bn" ? `${w.title_bn}${authorBn ? ` — ${authorBn}` : ""}` : `${w.title_en} (${w.title_bn})${authorEn ? ` — ${authorEn}` : ""}`,
    snapshot: { slug: w.slug, title_bn: w.title_bn, subtitle_bn: w.subtitle_bn, cover_variant: w.cover_variant, authors: w.authors.map((a) => ({ name_bn: a.name_bn })) },
    match: { slug: w.slug, title_bn: w.title_bn, title_en: w.title_en, title_latn: w.title_latn, authors: w.authors },
    title_en: w.title_en,
    author_en: authorEn || null,
    year: w.original_pub_year,
  };
}

async function knownBooks(works: WorkNames[], locale: Locale): Promise<Map<string, Known>> {
  const map = new Map(works.map((w) => [w.slug, catalogueBook(w, locale)]));
  // the reader's own books can be on Goodreads too
  for (const p of await localDB().personalBooks.toArray())
    map.set(p.id, {
      slug: p.id,
      label: p.author ? `${p.title} — ${p.author}` : p.title,
      snapshot: personalSnapshot(p),
      match: { slug: p.id, title_bn: p.title, title_en: p.title, title_latn: null, authors: p.author ? [{ name_bn: p.author, name_en: p.author }] : [] },
      title_en: p.title,
      author_en: p.author,
      year: null,
    });
  return map;
}

export function GoodreadsTransfer({ locale, labels, works }: { locale: Locale; labels: Labels; works: WorkNames[] }) {
  return (
    <div className="space-y-14">
      <ImportSection locale={locale} labels={labels} works={works} />
      <ExportSection locale={locale} labels={labels} works={works} />
    </div>
  );
}

function ImportSection({ locale, labels, works }: { locale: Locale; labels: Labels; works: WorkNames[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [known, setKnown] = useState<Map<string, Known> | null>(null);
  const [opts, setOpts] = useState({ shelves: true, reviews: true, replace: false });
  const n = (x: number) => formatNumber(x, locale);

  const read = async (file: File) => {
    if (file.size > MAX_BYTES) return setState({ kind: "error", message: labels.tooBig });
    setState({ kind: "reading" });
    try {
      const [{ parseGoodreads, GoodreadsError, MAX_ROWS }, { MatchIndex, matchAll }] = await Promise.all([import("@/lib/transfer/goodreads"), import("@/lib/transfer/match")]);
      let books: GoodreadsBook[];
      try {
        books = parseGoodreads(await file.text());
      } catch (e) {
        const code = e instanceof GoodreadsError ? e.code : "failed";
        return setState({ kind: "error", message: t(labels[code], { max: n(MAX_ROWS) }) });
      }
      const all = await knownBooks(works, locale);
      setKnown(all);
      setState({ kind: "matching", done: 0, total: books.length });
      const index = new MatchIndex([...all.values()].map((k) => k.match));
      const matches = await matchAll(index, books, (done) => setState({ kind: "matching", done, total: books.length }));
      setState({ kind: "review", rows: books.map((book, i) => ({ book, match: matches[i], choice: matches[i].slug ?? "" })) });
    } catch (e) {
      console.warn("[goodreads]", e);
      setState({ kind: "error", message: labels.failed });
    }
  };

  const apply = async (rows: Row[]) => {
    if (!known) return;
    setState({ kind: "applying", rows });
    try {
      const { applyGoodreads } = await import("@/lib/transfer/library");
      const chosen = rows.filter((r) => r.choice && known.has(r.choice)).map((r) => ({ book: r.book, slug: r.choice }));
      const res = await applyGoodreads(chosen, new Map([...known].map(([slug, k]) => [slug, k.snapshot])), opts);
      const text = [t(labels.done, { added: n(res.added), updated: n(res.updated), unchanged: n(res.unchanged) }), res.shelves ? t(labels.doneShelves, { count: n(res.shelves) }) : ""]
        .filter(Boolean)
        .join(" ");
      setState({ kind: "done", text });
    } catch (e) {
      console.warn("[goodreads]", e);
      setState({ kind: "error", message: labels.failed });
    }
  };

  const busy = state.kind === "reading" || state.kind === "matching" || state.kind === "applying";

  return (
    <section aria-labelledby="gr-import" className="space-y-5">
      <h2 id="gr-import" className="text-2xl sm:text-3xl">
        {labels.importTitle}
      </h2>
      <p className="max-w-2xl text-fg-muted">{labels.importSteps}</p>

      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        className="sr-only"
        tabIndex={-1}
        aria-label={labels.chooseFile}
        data-testid="goodreads-file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void read(file);
        }}
      />
      {state.kind === "idle" || state.kind === "error" ? (
        <button type="button" onClick={() => input.current?.click()} className="inline-flex h-11 items-center gap-2 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
          <FileUp aria-hidden className="size-4" />
          {labels.chooseFile}
        </button>
      ) : null}

      {state.kind === "error" ? (
        <p role="alert" className="flex items-start gap-2 text-destructive">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      ) : null}

      {state.kind === "reading" || state.kind === "matching" ? (
        <p role="status" className="flex items-center gap-2 text-fg-muted">
          <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {state.kind === "reading" ? labels.reading : t(labels.matching, { done: n(state.done), total: n(state.total) })}
        </p>
      ) : null}

      {(state.kind === "review" || state.kind === "applying") && known ? (
        <Review
          locale={locale}
          labels={labels}
          rows={state.rows}
          known={known}
          opts={opts}
          busy={busy}
          onOpts={setOpts}
          onChoose={(i, slug) => setState((s) => (s.kind === "review" ? { ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, choice: slug } : r)) } : s))}
          onApply={() => state.kind === "review" && void apply(state.rows)}
          onStartOver={() => input.current?.click()}
        />
      ) : null}

      {state.kind === "done" ? (
        <div className="space-y-4 rounded-[14px] border border-line p-5">
          <p role="status" className="flex items-start gap-2">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-cloth" />
            {state.text}
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href={localizedPath(locale, "/library")} className="inline-flex h-11 items-center rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
              {labels.openLibrary}
            </Link>
            <button type="button" onClick={() => input.current?.click()} className="h-11 rounded-control border border-line-strong px-4 hover:bg-sunken">
              {labels.startOver}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Review({
  locale,
  labels,
  rows,
  known,
  opts,
  busy,
  onOpts,
  onChoose,
  onApply,
  onStartOver,
}: {
  locale: Locale;
  labels: Labels;
  rows: Row[];
  known: Map<string, Known>;
  opts: { shelves: boolean; reviews: boolean; replace: boolean };
  busy: boolean;
  onOpts: (o: { shelves: boolean; reviews: boolean; replace: boolean }) => void;
  onChoose: (i: number, slug: string) => void;
  onApply: () => void;
  onStartOver: () => void;
}) {
  const n = (x: number) => formatNumber(x, locale);
  const groups = useMemo(() => {
    const g: Record<Match["verdict"], number[]> = { match: [], maybe: [], none: [] };
    rows.forEach((r, i) => g[r.match.verdict].push(i));
    return g;
  }, [rows]);
  const chosen = rows.filter((r) => r.choice).length;
  const found = groups.match.length + groups.maybe.length;
  const everything = useMemo(() => [...known.values()].sort((a, b) => a.label.localeCompare(b.label, locale === "bn" ? "bn" : "en")), [known, locale]);
  const anyShelves = rows.some((r) => r.choice && r.book.shelves.length);
  const anyReviews = rows.some((r) => r.choice && (r.book.review || r.book.privateNotes));

  const list = (ids: number[]) => (
    <ul className="divide-y divide-line border-y border-line">
      {ids.map((i) => (
        <RowItem key={rows[i].book.row} row={rows[i]} labels={labels} locale={locale} known={known} everything={everything} disabled={busy} onChoose={(slug) => onChoose(i, slug)} />
      ))}
    </ul>
  );

  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <p>{t(labels.summary, { total: n(rows.length), found: n(found) })}</p>
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-fg-muted">
          {(
            [
              ["match", labels.countMatch],
              ["maybe", labels.countMaybe],
              ["none", labels.countNone],
            ] as const
          ).map(([k, label]) => (
            <div key={k} className="flex gap-1.5">
              <dt>{label}</dt>
              <dd className="text-fg" data-testid={`gr-count-${k}`}>
                {n(groups[k].length)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {groups.maybe.length ? (
        <section aria-labelledby="gr-maybe" className="space-y-3">
          <h3 id="gr-maybe" className="text-xl">
            {labels.maybeTitle}
          </h3>
          <p className="text-sm text-fg-muted">{labels.maybeHint}</p>
          {list(groups.maybe)}
        </section>
      ) : null}

      {groups.match.length ? (
        <details open={groups.match.length <= 12} className="group space-y-3">
          <summary className="cursor-pointer text-xl marker:text-fg-subtle">
            {labels.matchTitle} <span className="text-base text-fg-muted">({n(groups.match.length)})</span>
          </summary>
          <p className="mt-3 text-sm text-fg-muted">{labels.matchHint}</p>
          <div className="mt-3">{list(groups.match)}</div>
        </details>
      ) : null}

      {groups.none.length ? (
        <details className="space-y-3">
          <summary className="cursor-pointer text-xl marker:text-fg-subtle">
            {labels.noneTitle} <span className="text-base text-fg-muted">({n(groups.none.length)})</span>
          </summary>
          <p className="mt-3 text-sm text-fg-muted">{labels.noneHint}</p>
          <div className="mt-3">{list(groups.none)}</div>
        </details>
      ) : null}

      <fieldset className="space-y-3 rounded-[14px] border border-line p-5">
        <legend className="px-1 text-lg">{labels.optionsTitle}</legend>
        <Check3 checked={opts.shelves} disabled={busy || !anyShelves} onChange={(v) => onOpts({ ...opts, shelves: v })} label={labels.optShelves} />
        <Check3 checked={opts.reviews} disabled={busy || !anyReviews} onChange={(v) => onOpts({ ...opts, reviews: v })} label={labels.optReviews} hint={labels.optReviewsHint} />
        <Check3 checked={opts.replace} disabled={busy} onChange={(v) => onOpts({ ...opts, replace: v })} label={labels.optReplace} />
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !chosen}
          onClick={onApply}
          className="inline-flex h-11 items-center gap-2 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised disabled:opacity-50"
        >
          {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          {busy ? labels.applying : t(labels.apply, { count: n(chosen) })}
        </button>
        <button type="button" disabled={busy} onClick={onStartOver} className="h-11 rounded-control px-4 text-fg-muted hover:bg-sunken hover:text-fg disabled:opacity-50">
          {labels.startOver}
        </button>
        {!chosen ? <p className="text-sm text-fg-muted">{labels.nothingChosen}</p> : null}
      </div>
    </div>
  );
}

function Check3({ checked, disabled, onChange, label, hint }: { checked: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className={cn("flex items-start gap-3", disabled && "opacity-60")}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-1 size-4 shrink-0 accent-[var(--color-cloth)]" />
      <span>
        <span className="block">{label}</span>
        {hint ? <span className="block text-sm text-fg-muted">{hint}</span> : null}
      </span>
    </label>
  );
}

const STATUS_KEY: Record<LibraryStatus, keyof Labels> = { want: "statusWant", reading: "statusReading", finished: "statusFinished", dnf: "statusDnf" };

function RowItem({
  row,
  labels,
  locale,
  known,
  everything,
  disabled,
  onChoose,
}: {
  row: Row;
  labels: Labels;
  locale: Locale;
  known: Map<string, Known>;
  everything: Known[];
  disabled: boolean;
  onChoose: (slug: string) => void;
}) {
  const [all, setAll] = useState(false);
  const { book, match } = row;
  const likely = match.candidates.map((c) => known.get(c.slug)).filter((k): k is Known => !!k);
  // a choice made from "all books" stays listed when the list closes
  const chosen = row.choice && !likely.some((k) => k.slug === row.choice) ? known.get(row.choice) : undefined;
  const id = `gr-row-${book.row}`;
  const showPicker = likely.length || all || chosen;

  return (
    <li className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] sm:items-center sm:gap-6" data-gr-row={book.row}>
      <div className="min-w-0">
        <p className="truncate font-display" id={`${id}-title`}>
          {book.title}
        </p>
        <p className="truncate text-sm text-fg-muted">
          {[book.author, labels[STATUS_KEY[book.status]], book.rating ? t(labels.rated, { count: formatNumber(book.rating, locale) }) : ""].filter(Boolean).join(" · ")}
        </p>
      </div>
      {showPicker ? (
        <select
          aria-label={t(labels.chooseBook, { title: book.title })}
          value={row.choice}
          disabled={disabled}
          onChange={(e) => (e.target.value === "*" ? setAll(true) : onChoose(e.target.value))}
          className={cn(
            "h-11 w-full min-w-0 rounded-control border bg-bg px-3 text-sm outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30",
            row.choice ? "border-line-strong" : "border-line text-fg-muted",
          )}
        >
          <option value="">{labels.leaveOut}</option>
          {likely.length ? (
            <optgroup label={labels.likely}>
              {likely.map((k) => (
                <option key={k.slug} value={k.slug}>
                  {k.label}
                </option>
              ))}
            </optgroup>
          ) : null}
          {chosen && !all ? <option value={chosen.slug}>{chosen.label}</option> : null}
          {all ? (
            <optgroup label={labels.allBooks}>
              {everything.map((k) => (
                <option key={k.slug} value={k.slug}>
                  {k.label}
                </option>
              ))}
            </optgroup>
          ) : (
            <option value="*">{labels.otherBook}</option>
          )}
        </select>
      ) : (
        <button type="button" disabled={disabled} onClick={() => setAll(true)} aria-describedby={`${id}-title`} className="h-11 justify-self-start rounded-control px-3 text-sm text-link hover:bg-sunken">
          {labels.pick}
        </button>
      )}
    </li>
  );
}

function ExportSection({ locale, labels, works }: { locale: Locale; labels: Labels; works: WorkNames[] }) {
  const [notes, setNotes] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const [{ exportBooks }, { goodreadsCsv }] = await Promise.all([import("@/lib/transfer/library"), import("@/lib/transfer/goodreads")]);
      const names = new Map(works.map((w) => [w.slug, { title_en: w.title_en, author_en: w.authors.map((a) => a.name_en).join(", ") || null, year: w.original_pub_year }]));
      const books = await exportBooks(names, notes);
      if (!books.length) return setMessage(labels.exportEmpty);
      // a byte-order mark, so spreadsheets read the Bengali as UTF-8
      const blob = new Blob(["﻿", goodreadsCsv(books)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `openbanglabooks-goodreads-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage(t(labels.exported, { count: formatNumber(books.length, locale) }));
    } catch (e) {
      console.warn("[goodreads]", e);
      setMessage(labels.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="gr-export" className="space-y-5">
      <h2 id="gr-export" className="text-2xl sm:text-3xl">
        {labels.exportTitle}
      </h2>
      <p className="max-w-2xl text-fg-muted">{labels.exportHint}</p>
      <Check3 checked={notes} onChange={setNotes} label={labels.exportNotes} hint={labels.exportNotesHint} />
      <button
        type="button"
        disabled={busy}
        onClick={() => void download()}
        className="inline-flex h-11 items-center gap-2 rounded-control border border-line-strong px-5 hover:bg-sunken disabled:opacity-50"
      >
        <Download aria-hidden className="size-4" />
        {labels.export}
      </button>
      <p role="status" className="min-h-6 text-sm text-fg-muted">
        {message}
      </p>
    </section>
  );
}
