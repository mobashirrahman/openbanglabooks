"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Bookmark as BookmarkIcon, Heart, Pencil, Plus, Star, Trash2, X } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { localDB, type LibraryEntry, type LibraryStatus, type ReadingPosition, type WorkSnapshot } from "@/lib/local/db";
import { createShelf, deleteShelf, removeFromLibrary, renameShelf, setOnShelf } from "@/lib/library/store";
import { formatDuration, formatNumber, formatPercent } from "@/lib/i18n/format";
import { localeTag, localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { WhereDataLives } from "@/components/sync/where-data-lives";
import { cn } from "@/lib/utils";
import { Toast, toastId, type ToastMessage } from "@/components/ui/toast";
import { ShelfNameDialog } from "./shelf-name-dialog";
import { STATUSES, statusLabel } from "./library-control";
import { ImportBookButton, ImportBookDialog, useBookImport } from "@/components/personal/import-book";
import { OwnBooks } from "@/components/personal/own-books";
import { bookHref } from "@/lib/personal/ids";

type Labels = Dictionary["library"] & { want: string; remove: string; continueReading: string; signIn: string; cancel: string };

/** A book in the reader's library, from its library entry and/or reading position. */
type Book = { slug: string; work: WorkSnapshot; status: LibraryStatus; entry?: LibraryEntry; position?: ReadingPosition };
type Tab = "all" | LibraryStatus | "favourites" | "own" | "history" | `shelf:${string}`;

export function LibraryView({ locale, labels, personal }: { locale: Locale; labels: Labels; personal: Dictionary["personal"] }) {
  const data = useLiveQuery(async () => {
    const db = localDB();
    const [positions, library, bookmarks, shelves, shelfItems, days, remoteDays, own] = await Promise.all([
      db.positions.orderBy("openedAt").reverse().toArray(),
      db.library.orderBy("updatedAt").reverse().toArray(),
      db.bookmarks.orderBy("createdAt").reverse().toArray(),
      db.shelves.orderBy("position").toArray(),
      db.shelfItems.toArray(),
      db.days.toArray(),
      db.remoteDays.toArray(),
      db.personalBooks.count(),
    ]);
    return { positions, library, bookmarks, shelves, shelfItems, days: [...days, ...remoteDays], own };
  }, []);
  const [tab, setTab] = useState<Tab>("all");
  const imp = useBookImport(personal);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const notify = useCallback((text: string) => setToast({ id: toastId(), text, duration: 4000 }), []);
  const [naming, setNaming] = useState<null | { kind: "new" } | { kind: "rename"; id: string; name: string }>(null);

  const books = useMemo(() => {
    const map = new Map<string, Book>();
    if (!data) return map;
    for (const p of data.positions) map.set(p.workSlug, { slug: p.workSlug, work: p.work, status: p.finished ? "finished" : "reading", position: p });
    for (const e of data.library) {
      const b = map.get(e.workSlug);
      map.set(e.workSlug, { slug: e.workSlug, work: e.work, status: e.status, entry: e, position: b?.position });
    }
    return map;
  }, [data]);

  if (!data) return <div className="min-h-64" aria-busy />;
  const all = [...books.values()];
  const byStatus = (s: LibraryStatus) => all.filter((b) => b.status === s);
  const favourites = all.filter((b) => b.entry?.favourite);
  const empty = !all.length && !data.bookmarks.length && !data.shelves.length;

  // the dialog stays where it is when the first book turns the empty library into a full one
  const importDialog = <ImportBookDialog key="import" imp={imp} locale={locale} labels={personal} />;
  const notice = <Toast key="toast" toast={toast} onDone={() => setToast(null)} className="bottom-20 pb-safe lg:bottom-6" />;

  if (empty) {
    return [
      <div key="view" className="space-y-8">
        <div className="rounded-[14px] border border-dashed border-line-strong px-6 py-14 text-center">
          <p className="mx-auto max-w-md text-fg-muted">{labels.empty}</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link href={localizedPath(locale, "/")} className="inline-flex h-11 items-center rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
              {locale === "bn" ? "বই খুঁজুন" : "Find a book"}
            </Link>
            <ImportBookButton imp={imp} labels={personal} className="h-11 rounded-control" />
          </div>
        </div>
        <WhereDataLives locale={locale} local={labels.localNote} synced={labels.syncedNote} signIn={labels.signIn} next="/library" />
      </div>,
      importDialog,
      notice,
    ];
  }

  const n = (x: number) => formatNumber(x, locale);
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "all", label: labels.all },
    ...STATUSES.filter((s) => s !== "dnf" || byStatus("dnf").length).map((s) => ({ id: s as Tab, label: statusLabel(s, labels), count: byStatus(s).length })),
    ...(favourites.length ? [{ id: "favourites" as Tab, label: labels.favourites, count: favourites.length }] : []),
    ...(data.own ? [{ id: "own" as Tab, label: personal.ownBooks, count: data.own }] : []),
    ...data.shelves.map((s) => ({
      id: `shelf:${s.id}` as Tab,
      label: s.name,
      count: data.shelfItems.filter((i) => i.shelfId === s.id).length,
    })),
    { id: "history", label: labels.history },
  ];
  const active = tabs.some((x) => x.id === tab) ? tab : "all";
  const shelf = active.startsWith("shelf:") ? data.shelves.find((s) => `shelf:${s.id}` === active) : undefined;

  return [
    <div key="view" className="space-y-10">
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
        <div role="tablist" aria-label={labels.shelves} className="flex shrink-0 gap-2 sm:flex-wrap">
          {tabs.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              id={`tab-${x.id}`}
              aria-selected={active === x.id}
              aria-controls="library-panel"
              onClick={() => setTab(x.id)}
              className={cn(
                "inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-4 text-sm whitespace-nowrap transition-colors",
                active === x.id ? "border-cloth bg-cloth text-on-cloth" : "border-line-strong text-fg-muted hover:text-fg",
              )}
            >
              {x.label}
              {x.count ? <span className={cn("text-xs", active === x.id ? "text-on-cloth-muted" : "text-fg-subtle")}>{n(x.count)}</span> : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setNaming({ kind: "new" })}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm text-link hover:bg-sunken"
        >
          <Plus aria-hidden className="size-4" />
          {labels.newShelf}
        </button>
        <ImportBookButton imp={imp} labels={personal} className="sm:ml-auto" />
      </div>

      <div id="library-panel" role="tabpanel" aria-labelledby={`tab-${active}`} className="space-y-14">
        {active === "all" ? (
          <>
            <ReadingList books={byStatus("reading")} locale={locale} labels={labels} title={labels.current} />
            <GridSection title={labels.want} books={byStatus("want")} locale={locale} labels={labels} />
            <GridSection title={labels.finished} books={byStatus("finished")} locale={locale} labels={labels} />
            <GridSection title={labels.statusDnf} books={byStatus("dnf")} locale={locale} labels={labels} />
            <Bookmarks data={data.bookmarks} locale={locale} labels={labels} />
          </>
        ) : active === "reading" ? (
          <ReadingList books={byStatus("reading")} locale={locale} labels={labels} emptyText={labels.emptyStatus} />
        ) : active === "want" || active === "finished" || active === "dnf" ? (
          <BookGrid books={byStatus(active)} locale={locale} labels={labels} emptyText={labels.emptyStatus} />
        ) : active === "favourites" ? (
          <BookGrid books={favourites} locale={locale} labels={labels} emptyText={labels.emptyStatus} />
        ) : active === "own" ? (
          <OwnBooks locale={locale} labels={personal} onNotice={notify} />
        ) : active === "history" ? (
          <History books={all} days={data.days} locale={locale} labels={labels} />
        ) : shelf ? (
          <section aria-label={shelf.name}>
            <div className="mb-6 flex flex-wrap items-center gap-2">
              <h2 className="mr-auto text-2xl sm:text-3xl">{shelf.name}</h2>
              <button
                type="button"
                onClick={() => setNaming({ kind: "rename", id: shelf.id, name: shelf.name })}
                className="inline-flex h-10 items-center gap-1.5 rounded-control px-3 text-sm text-fg-muted hover:bg-sunken hover:text-fg"
              >
                <Pencil aria-hidden className="size-4" />
                {labels.rename}
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!window.confirm(t(labels.deleteShelfConfirm, { name: shelf.name }))) return;
                  await deleteShelf(shelf.id);
                  setTab("all");
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-control px-3 text-sm text-destructive hover:bg-destructive/10"
              >
                <Trash2 aria-hidden className="size-4" />
                {labels.deleteShelf}
              </button>
            </div>
            <BookGrid
              books={data.shelfItems
                .filter((i) => i.shelfId === shelf.id)
                .sort((a, b) => b.addedAt - a.addedAt)
                .map((i) => books.get(i.workSlug) ?? { slug: i.workSlug, work: i.work, status: "want" as const })}
              locale={locale}
              labels={labels}
              emptyText={labels.emptyShelf}
              onRemove={(b) => void setOnShelf(shelf.id, b.work, false)}
              removeLabel={labels.remove}
            />
          </section>
        ) : null}
      </div>

      <WhereDataLives locale={locale} local={labels.localNote} synced={labels.syncedNote} signIn={labels.signIn} next="/library" />

      <ShelfNameDialog
        open={naming !== null}
        onOpenChange={(o) => !o && setNaming(null)}
        title={naming?.kind === "rename" ? labels.rename : labels.newShelf}
        initial={naming?.kind === "rename" ? naming.name : ""}
        labels={{
          shelfName: labels.shelfName,
          shelfNamePlaceholder: labels.shelfNamePlaceholder,
          submit: naming?.kind === "rename" ? labels.rename : labels.create,
          cancel: labels.cancel,
        }}
        onSubmit={async (name) => {
          if (naming?.kind === "rename") await renameShelf(naming.id, name);
          else {
            const id = await createShelf(name);
            if (id) setTab(`shelf:${id}`);
          }
          setNaming(null);
        }}
      />
    </div>,
    importDialog,
    notice,
  ];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-5 text-2xl sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}

function ReadingList({ books, locale, labels, title, emptyText }: { books: Book[]; locale: Locale; labels: Labels; title?: string; emptyText?: string }) {
  if (!books.length) return emptyText ? <p className="text-fg-muted">{emptyText}</p> : null;
  const withPlace = books.filter((b) => b.position);
  const withoutPlace = books.filter((b) => !b.position);
  const body = (
    <div className="space-y-6">
      {withPlace.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {withPlace.map((b) => (
            <PositionRow key={b.slug} p={b.position!} locale={locale} labels={labels} />
          ))}
        </ul>
      ) : null}
      {withoutPlace.length ? <BookGrid books={withoutPlace} locale={locale} labels={labels} /> : null}
    </div>
  );
  return title ? <Section title={title}>{body}</Section> : body;
}

function GridSection({ title, books, locale, labels }: { title: string; books: Book[]; locale: Locale; labels: Labels }) {
  if (!books.length) return null;
  return (
    <Section title={title}>
      <BookGrid books={books} locale={locale} labels={labels} />
    </Section>
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

function BookGrid({
  books,
  locale,
  labels,
  emptyText,
  onRemove,
  removeLabel,
}: {
  books: Book[];
  locale: Locale;
  labels: Labels;
  emptyText?: string;
  onRemove?: (b: Book) => void;
  removeLabel?: string;
}) {
  if (!books.length) return emptyText ? <p className="text-fg-muted">{emptyText}</p> : null;
  const remove = onRemove ?? ((b: Book) => void removeFromLibrary(b.slug));
  return (
    <ul className="grid grid-cols-3 gap-5 sm:grid-cols-5 lg:grid-cols-7">
      {books.map((b) => (
        <li key={b.slug} className="group relative">
          <Link href={bookHref(locale, b.slug)} className="block">
            <BookCover work={b.work} interactive />
            <span className="mt-2 block truncate font-display">{b.work.title_bn}</span>
            {b.entry?.rating || b.entry?.favourite ? (
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-fg-subtle">
                {b.entry.favourite ? <Heart aria-label={labels.favourite} className="size-3.5 fill-accent text-accent" /> : null}
                {b.entry.rating ? (
                  <span className="inline-flex items-center gap-0.5" aria-label={t(labels.stars, { count: formatNumber(b.entry.rating, locale) })}>
                    <Star aria-hidden className="size-3.5 fill-foil text-foil-text" />
                    {formatNumber(b.entry.rating, locale)}
                  </span>
                ) : null}
              </span>
            ) : null}
          </Link>
          {b.entry || onRemove ? (
            <button
              type="button"
              onClick={() => remove(b)}
              className="absolute top-1 right-1 inline-flex size-8 items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
              aria-label={`${removeLabel ?? labels.remove}: ${b.work.title_bn}`}
            >
              {onRemove ? <X aria-hidden className="size-4" /> : <Trash2 aria-hidden className="size-4" />}
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function Bookmarks({ data, locale, labels }: { data: { id: string; workSlug: string; cfi: string; chapter: string | null; excerpt: string; work: WorkSnapshot }[]; locale: Locale; labels: Labels }) {
  return (
    <Section title={labels.bookmarks}>
      {data.length ? (
        <ul className="divide-y divide-line border-y border-line">
          {data.map((b) => (
            <li key={b.id} className="flex items-start gap-4 py-4">
              <BookmarkIcon aria-hidden className="mt-1 size-5 shrink-0 text-accent" />
              <a href={`${localizedPath(locale, `/read/${b.workSlug}`)}?cfi=${encodeURIComponent(b.cfi)}`} className="min-w-0 flex-1 hover:text-link">
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
  );
}

/** Month by month: reading time (all devices) and the books finished. */
function History({ books, days, locale, labels }: { books: Book[]; days: { day: string; seconds: number }[]; locale: Locale; labels: Labels }) {
  const months = new Map<string, { seconds: number; finished: { book: Book; at: number }[] }>();
  const month = (key: string) => {
    let m = months.get(key);
    if (!m) months.set(key, (m = { seconds: 0, finished: [] }));
    return m;
  };
  for (const d of days) month(d.day.slice(0, 7)).seconds += d.seconds;
  for (const b of books) {
    if (b.status !== "finished") continue;
    const at = b.entry?.finishedAt ?? b.position?.updatedAt;
    if (!at) continue;
    const date = new Date(at);
    month(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`).finished.push({ book: b, at });
  }
  const list = [...months.entries()].filter(([, m]) => m.seconds >= 60 || m.finished.length).sort(([a], [b]) => b.localeCompare(a));
  if (!list.length) return <p className="text-fg-muted">{labels.historyEmpty}</p>;
  const monthName = new Intl.DateTimeFormat(localeTag[locale], { month: "long", year: "numeric" });
  const dayName = new Intl.DateTimeFormat(localeTag[locale], { day: "numeric", month: "long" });
  return (
    <ol className="space-y-10">
      {list.map(([key, m]) => {
        const [y, mo] = key.split("-").map(Number);
        return (
          <li key={key}>
            <h2 className="text-2xl">{monthName.format(new Date(y, mo - 1, 1))}</h2>
            <p className="mt-1 text-sm text-fg-muted">
              {[
                m.seconds >= 60 ? t(labels.monthTime, { time: formatDuration(m.seconds, locale) }) : null,
                m.finished.length ? t(labels.booksFinished, { count: formatNumber(m.finished.length, locale) }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
            {m.finished.length ? (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {m.finished
                  .sort((a, b) => b.at - a.at)
                  .map(({ book, at }) => (
                    <li key={book.slug}>
                      <Link
                        href={bookHref(locale, book.slug)}
                        className="flex items-center gap-4 rounded-[14px] border border-line bg-surface p-3 transition-colors hover:border-line-strong"
                      >
                        <div className="w-11 shrink-0">
                          <BookCover work={book.work} />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-display text-lg">{book.work.title_bn}</p>
                          <p className="text-sm text-fg-muted">{t(labels.finishedOn, { date: dayName.format(new Date(at)) })}</p>
                        </div>
                      </Link>
                    </li>
                  ))}
              </ul>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
