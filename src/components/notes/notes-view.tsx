"use client";

import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Copy, Download, NotebookPen, Search, Trash2, Unlink } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { NoteEditor } from "@/components/reader/note-editor";
import { Toast, toastId, type ToastMessage } from "@/components/ui/toast";
import { localDB, type Annotation, type HighlightColor } from "@/lib/local/db";
import {
  annotationsToJson,
  annotationsToMarkdown,
  byPosition,
  deleteAnnotation,
  downloadText,
  HIGHLIGHT_COLORS,
  SWATCH,
  updateAnnotation,
} from "@/lib/reader/annotations";
import { chapterLabel } from "@/lib/reader/engine";
import { formatNumber, formatPercent } from "@/lib/i18n/format";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { bookHref } from "@/lib/personal/ids";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { WhereDataLives } from "@/components/sync/where-data-lives";
import { cn } from "@/lib/utils";

type Labels = Dictionary["notes"] & {
  signIn: string;
  reader: Pick<
    Dictionary["reader"],
    "colors" | "note" | "notePlaceholder" | "save" | "cancel" | "deleteNote" | "closeMenu" | "addNote" | "editNote" | "deleteHighlight" | "chapterOf"
  >;
  findBook: string;
};

/** Normalised for search: NFC, no zero-width joiners, lower case. */
const norm = (s: string) => s.normalize("NFC").replace(/[‌‍]/g, "").toLocaleLowerCase();

export function NotesView({ locale, labels }: { locale: Locale; labels: Labels }) {
  const rows = useLiveQuery(() => localDB().annotations.orderBy("updatedAt").reverse().toArray(), []);
  const [query, setQuery] = useState("");
  const [book, setBook] = useState("");
  const [color, setColor] = useState<HighlightColor | "">("");
  const [notesOnly, setNotesOnly] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const q = norm(useDeferredValue(query).trim());

  const books = useMemo(() => {
    const m = new Map<string, Annotation["work"]>();
    for (const r of rows ?? []) if (!m.has(r.workSlug)) m.set(r.workSlug, r.work);
    return [...m.values()];
  }, [rows]);

  const filtered = useMemo(
    () =>
      (rows ?? []).filter(
        (a) =>
          (!book || a.workSlug === book) &&
          (!color || (a.style === "highlight" && a.color === color)) &&
          (!notesOnly || a.note) &&
          (!q || norm(`${a.quote} ${a.note ?? ""} ${a.work.title_bn}`).includes(q)),
      ),
    [rows, book, color, notesOnly, q],
  );

  // grouped by book (most recently annotated first), in reading order inside each book
  const groups = useMemo(() => {
    const m = new Map<string, Annotation[]>();
    for (const a of filtered) m.set(a.workSlug, [...(m.get(a.workSlug) ?? []), a]);
    return [...m.values()].map((list) => [...list].sort(byPosition));
  }, [filtered]);

  if (!rows) return <div className="min-h-64" aria-busy />;

  if (!rows.length) {
    return (
      <div className="rounded-[14px] border border-dashed border-line-strong px-6 py-14 text-center">
        <NotebookPen aria-hidden className="mx-auto size-8 text-fg-subtle" />
        <p className="mx-auto mt-4 max-w-md text-fg-muted">{labels.empty}</p>
        <Link
          href={localizedPath(locale, "/books")}
          className="mt-6 inline-flex h-11 items-center rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised"
        >
          {labels.findBook}
        </Link>
      </div>
    );
  }

  const exportAs = (kind: "md" | "json") => {
    const list = filtered.length ? filtered : rows;
    const stamp = new Date().toISOString().slice(0, 10);
    if (kind === "md")
      downloadText(
        annotationsToMarkdown(list, { title: labels.title, exportedOn: labels.exportedOn, note: labels.reader.note, chapterOf: labels.reader.chapterOf }, locale),
        `openbanglabooks-notes-${stamp}.md`,
        "text/markdown;charset=utf-8",
      );
    else downloadText(annotationsToJson(list), `openbanglabooks-notes-${stamp}.json`, "application/json");
  };

  const remove = async (a: Annotation) => {
    await deleteAnnotation(a.id);
    setToast({ id: toastId(), text: labels.deleted, action: { label: labels.undo, onClick: () => void localDB().annotations.put(a) } });
  };

  const editingRow = editing ? (rows.find((r) => r.id === editing) ?? null) : null;
  const chip = (active: boolean) =>
    cn(
      "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-sm transition-colors duration-200",
      active ? "border-cloth bg-cloth text-on-cloth" : "border-line-strong text-fg-muted hover:text-fg",
    );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-fg-muted">{t(labels.count, { count: formatNumber(rows.length, locale) })}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => exportAs("md")} className={chip(false)}>
            <Download aria-hidden className="size-4" />
            {labels.exportMarkdown}
          </button>
          <button type="button" onClick={() => exportAs("json")} className={chip(false)}>
            <Download aria-hidden className="size-4" />
            {labels.exportJson}
          </button>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-fg-subtle" />
          <label htmlFor="notes-search" className="sr-only">
            {labels.search}
          </label>
          <input
            id="notes-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={labels.search}
            className="h-11 w-full rounded-control border border-line-strong bg-surface pr-3 pl-10 outline-none placeholder:text-fg-subtle focus:border-cloth"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="notes-book" className="sr-only">
            {labels.allBooks}
          </label>
          <select
            id="notes-book"
            value={book}
            onChange={(e) => setBook(e.target.value)}
            className="h-9 rounded-full border border-line-strong bg-surface px-3.5 text-sm text-fg"
          >
            <option value="">{labels.allBooks}</option>
            {books.map((w) => (
              <option key={w.slug} value={w.slug}>
                {w.title_bn}
              </option>
            ))}
          </select>
          <button type="button" aria-pressed={!color} onClick={() => setColor("")} className={chip(!color)}>
            {labels.allColors}
          </button>
          {HIGHLIGHT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-pressed={color === c}
              aria-label={labels.reader.colors[c]}
              onClick={() => setColor(color === c ? "" : c)}
              className={cn(chip(color === c), "px-2.5")}
            >
              <span aria-hidden className="size-4 rounded-full" style={{ background: SWATCH[c] }} />
            </button>
          ))}
          <button type="button" aria-pressed={notesOnly} onClick={() => setNotesOnly(!notesOnly)} className={chip(notesOnly)}>
            <NotebookPen aria-hidden className="size-4" />
            {labels.withNotes}
          </button>
        </div>
      </div>

      {groups.length ? (
        <div className="mt-10 space-y-12">
          {groups.map((list) => {
            const w = list[0].work;
            return (
              <section key={w.slug} aria-labelledby={`notes-${w.slug}`}>
                <div className="flex items-center gap-4">
                  <Link href={bookHref(locale, w.slug)} className="w-12 shrink-0" tabIndex={-1} aria-hidden>
                    <BookCover work={w} />
                  </Link>
                  <div className="min-w-0">
                    <h2 id={`notes-${w.slug}`} className="font-display text-2xl leading-snug">
                      <Link href={bookHref(locale, w.slug)} className="hover:underline">
                        {w.title_bn}
                      </Link>
                    </h2>
                    <p className="flex flex-wrap gap-x-3 text-sm text-fg-muted">
                      <span>{w.authors.map((a) => a.name_bn).join(", ")}</span>
                      <span>{t(labels.count, { count: formatNumber(list.length, locale) })}</span>
                    </p>
                  </div>
                </div>
                <ul className="mt-4 divide-y divide-line border-y border-line">
                  {list.map((a) => (
                    <li key={a.id} className="flex gap-4 py-5">
                      <span
                        aria-hidden
                        className="w-1 shrink-0 rounded-full"
                        style={{ background: a.style === "underline" ? "var(--color-accent)" : SWATCH[a.color] }}
                      />
                      <div className="min-w-0 flex-1">
                        {a.orphaned || a.conflictOf ? (
                          <p className="mb-2 flex flex-wrap gap-2 text-xs">
                            {a.orphaned ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-fg-muted">
                                <Unlink aria-hidden className="size-3.5" />
                                {labels.orphaned}
                              </span>
                            ) : null}
                            {a.conflictOf ? (
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-fg-muted">
                                <Copy aria-hidden className="size-3.5" />
                                {labels.conflictCopy}
                              </span>
                            ) : null}
                          </p>
                        ) : null}
                        <blockquote className="font-read text-[1.05rem] leading-relaxed">{a.quote}</blockquote>
                        {a.note ? <p className="mt-3 rounded-[10px] bg-sunken px-3.5 py-2.5 text-[0.95rem] whitespace-pre-line">{a.note}</p> : null}
                        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
                          <span>
                            {chapterLabel(a.chapter, labels.reader.chapterOf) ?? ""} {formatPercent(a.fraction, locale)}
                          </span>
                          {a.orphaned ? null : (
                            <a
                              href={`${localizedPath(locale, `/read/${a.workSlug}`)}?cfi=${encodeURIComponent(a.cfi)}`}
                              className="text-fg underline decoration-accent underline-offset-4"
                            >
                              {labels.openInReader}
                            </a>
                          )}
                          <button type="button" onClick={() => setEditing(a.id)} className="inline-flex items-center gap-1.5 hover:text-fg">
                            <NotebookPen aria-hidden className="size-4" />
                            {a.note ? labels.reader.editNote : labels.reader.addNote}
                          </button>
                          <button type="button" onClick={() => void remove(a)} className="inline-flex items-center gap-1.5 hover:text-fg">
                            <Trash2 aria-hidden className="size-4" />
                            {labels.reader.deleteHighlight}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <p className="mt-10 text-fg-muted">{labels.noMatches}</p>
      )}

      <div className="mt-12">
        <WhereDataLives locale={locale} local={labels.localOnly} synced={labels.syncedNote} signIn={labels.signIn} next="/notes" />
      </div>

      <NoteEditor
        annotation={editingRow}
        labels={labels.reader}
        onClose={() => setEditing(null)}
        onSave={async (note) => {
          if (editingRow) await updateAnnotation(editingRow.id, { note });
          setEditing(null);
        }}
      />
      <Toast toast={toast} onDone={() => setToast(null)} className="bottom-20 pb-safe lg:bottom-6" />
    </div>
  );
}
