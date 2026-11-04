"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { Search, X, UserRound } from "lucide-react";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { BookCover } from "@/components/cover/book-cover";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";
import type { SearchResponse } from "@/app/api/search/route";

type Labels = {
  search: string;
  placeholder: string;
  hint: string;
  books: string;
  authors: string;
  noResults: string;
  shortcut: string;
  close: string;
  seeAll: string;
};

type Item = { key: string; href: string };

export function SearchDialog({ locale, labels }: { locale: Locale; labels: Labels }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [fetched, setFetched] = useState<SearchResponse | null>(null);
  // results belong to a non-empty query: clearing the box clears them, no effect needed
  const data = query.trim() ? fetched : null;
  const [active, setActive] = useState(0);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const listId = useId();
  const abortRef = useRef<AbortController | null>(null);

  // "/" or Ctrl/⌘+K opens search, unless the user is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el?.tagName ?? "");
      if ((e.key === "/" && !typing) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      startTransition(async () => {
        try {
          const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&lang=${locale}`, { signal: ctrl.signal });
          if (res.ok) {
            setFetched((await res.json()) as SearchResponse);
            setActive(0);
          }
        } catch {
          /* aborted or offline – keep previous results */
        }
      });
    }, 140);
    return () => clearTimeout(timer);
  }, [query, locale]);

  const items: Item[] = [
    ...(data?.works ?? []).map((w) => ({ key: `w-${w.slug}`, href: localizedPath(locale, `/books/${w.slug}`) })),
    ...(data?.authors ?? []).map((a) => ({ key: `a-${a.slug}`, href: localizedPath(locale, `/authors/${a.slug}`) })),
  ];

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = items[active];
      if (target) go(target.href);
      else if (query.trim()) go(localizedPath(locale, `/search?q=${encodeURIComponent(query.trim())}`));
    }
  };

  const empty = data && !data.works.length && !data.authors.length;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex h-10 items-center gap-2 rounded-control text-on-cloth-muted transition-colors duration-200 hover:text-on-cloth focus-visible:outline-on-cloth",
            "w-10 justify-center sm:w-64 sm:justify-start sm:bg-cloth-raised sm:px-3 sm:hover:bg-[color-mix(in_oklab,var(--cloth-raised),white_6%)]",
          )}
        >
          <Search aria-hidden className="size-5 shrink-0 sm:size-[18px]" />
          {/* accessible name contains the visible text (WCAG 2.5.3) */}
          <span className="sr-only">{labels.search}: </span>
          <span className="hidden truncate text-sm sm:inline">{labels.placeholder}</span>
          <kbd aria-hidden className="ml-auto hidden rounded border border-on-cloth/25 px-1.5 font-sans text-xs text-on-cloth-muted sm:inline">/</kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 top-0 z-50 mx-auto flex max-h-[85dvh] w-full flex-col overflow-hidden bg-surface text-fg shadow-pop sm:top-[10dvh] sm:max-w-xl sm:rounded-sheet",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-2 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
          )}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector("input")?.focus();
          }}
        >
          <Dialog.Title className="sr-only">{labels.search}</Dialog.Title>
          <Dialog.Description className="sr-only">{labels.hint}</Dialog.Description>
          <div className="flex items-center gap-3 border-b border-line px-4 pt-safe sm:pt-0">
            <Search aria-hidden className="size-5 shrink-0 text-fg-subtle" />
            <input
              type="search"
              role="combobox"
              aria-expanded={items.length > 0}
              aria-controls={listId}
              aria-activedescendant={items[active] ? `${listId}-${items[active].key}` : undefined}
              aria-autocomplete="list"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={labels.placeholder}
              className="h-14 w-full bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle [&::-webkit-search-cancel-button]:hidden"
            />
            <Dialog.Close
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-control text-fg-subtle hover:bg-sunken hover:text-fg"
              aria-label={labels.close}
            >
              <X aria-hidden className="size-5" />
            </Dialog.Close>
          </div>

          <div id={listId} role="listbox" aria-label={labels.search} className="overflow-y-auto overscroll-contain p-2" aria-busy={pending}>
            {!query.trim() ? <p className="px-3 py-6 text-sm text-fg-muted">{labels.hint}</p> : null}
            {empty ? <p className="px-3 py-6 text-sm text-fg-muted">{t(labels.noResults, { query: query.trim() })}</p> : null}

            {data?.works.length ? (
              <section aria-label={labels.books}>
                <h3 className="px-3 pt-2 pb-1 font-sans text-xs text-fg-subtle">{labels.books}</h3>
                {data.works.map((w) => {
                  const key = `w-${w.slug}`;
                  const index = items.findIndex((i) => i.key === key);
                  return (
                    <a
                      key={key}
                      id={`${listId}-${key}`}
                      role="option"
                      aria-selected={index === active}
                      href={items[index].href}
                      onClick={(e) => {
                        e.preventDefault();
                        go(items[index].href);
                      }}
                      onMouseMove={() => setActive(index)}
                      className={cn(
                        "flex items-center gap-3 rounded-control px-3 py-2 transition-colors duration-150",
                        index === active ? "bg-sunken" : "",
                      )}
                    >
                      <div className="w-9 shrink-0">
                        <BookCover work={w} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate font-display text-lg leading-snug">
                          {w.title_bn}
                          {w.subtitle_bn ? <span className="text-fg-muted"> ({w.subtitle_bn})</span> : null}
                        </div>
                        <div className="truncate text-sm text-fg-muted">{w.authors.map((a) => a.name_bn).join(", ")}</div>
                      </div>
                    </a>
                  );
                })}
              </section>
            ) : null}

            {data?.authors.length ? (
              <section aria-label={labels.authors}>
                <h3 className="px-3 pt-3 pb-1 font-sans text-xs text-fg-subtle">{labels.authors}</h3>
                {data.authors.map((a) => {
                  const key = `a-${a.slug}`;
                  const index = items.findIndex((i) => i.key === key);
                  return (
                    <a
                      key={key}
                      id={`${listId}-${key}`}
                      role="option"
                      aria-selected={index === active}
                      href={items[index].href}
                      onClick={(e) => {
                        e.preventDefault();
                        go(items[index].href);
                      }}
                      onMouseMove={() => setActive(index)}
                      className={cn(
                        "flex items-center gap-3 rounded-control px-3 py-2.5 transition-colors duration-150",
                        index === active ? "bg-sunken" : "",
                      )}
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-cloth text-on-cloth">
                        <UserRound aria-hidden className="size-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-display text-lg leading-snug">{a.name_bn}</span>
                        {a.years ? <span className="block text-sm text-fg-muted">{a.years}</span> : null}
                      </span>
                    </a>
                  );
                })}
              </section>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
