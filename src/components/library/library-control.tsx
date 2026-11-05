"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { DropdownMenu } from "radix-ui";
import { BookmarkPlus, Check, ChevronDown, Heart, Plus, Trash2 } from "lucide-react";
import { localDB, type LibraryStatus, type WorkSnapshot } from "@/lib/local/db";
import { addToLibrary, createShelf, removeFromLibrary, setFavourite, setOnShelf, setStatus } from "@/lib/library/store";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { cn } from "@/lib/utils";
import { ShelfNameDialog } from "./shelf-name-dialog";

type Labels = Pick<
  Dictionary["library"],
  | "statusWant"
  | "statusReading"
  | "statusFinished"
  | "statusDnf"
  | "favourite"
  | "addToShelf"
  | "newShelf"
  | "shelfName"
  | "shelfNamePlaceholder"
  | "create"
  | "inLibraryAs"
> & { add: string; remove: string; cancel: string };

export const STATUSES: LibraryStatus[] = ["want", "reading", "finished", "dnf"];
export const statusLabel = (s: LibraryStatus, l: Pick<Labels, "statusWant" | "statusReading" | "statusFinished" | "statusDnf">) =>
  ({ want: l.statusWant, reading: l.statusReading, finished: l.statusFinished, dnf: l.statusDnf })[s];

const item =
  "flex min-h-11 cursor-default items-center gap-3 rounded-[8px] px-3 text-[0.95rem] outline-none select-none data-[highlighted]:bg-sunken data-[disabled]:opacity-50";

/**
 * The book page's library button: adds the book, then shows its status and
 * opens a menu for status, favourite, the reader's shelves and removal.
 */
export function LibraryControl({ work, labels }: { work: WorkSnapshot; labels: Labels }) {
  const data = useLiveQuery(async () => {
    const db = localDB();
    const [entry, shelves, items] = await Promise.all([
      db.library.get(work.slug),
      db.shelves.orderBy("position").toArray(),
      db.shelfItems.where("workSlug").equals(work.slug).toArray(),
    ]);
    return { entry: entry ?? null, shelves, on: new Set(items.map((i) => i.shelfId)) };
  }, [work.slug]);
  const [naming, setNaming] = useState(false);

  const base = "inline-flex h-12 items-center justify-center gap-2 rounded-control border px-5 text-base transition-colors duration-200";
  if (!data?.entry) {
    return (
      <button
        type="button"
        disabled={!data}
        onClick={() => void addToLibrary(work)}
        className={cn(base, "border-line-strong text-fg hover:bg-sunken")}
      >
        <BookmarkPlus aria-hidden className="size-5" />
        {labels.add}
      </button>
    );
  }

  const { entry, shelves, on } = data;
  const current = statusLabel(entry.status, labels);
  return (
    <>
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger
          aria-label={t(labels.inLibraryAs, { status: current })}
          className={cn(base, "border-line-strong text-fg hover:bg-sunken data-[state=open]:bg-sunken")}
        >
          <Check aria-hidden className="size-5 text-cloth dark:text-foil" />
          <span>{current}</span>
          {entry.favourite ? <Heart aria-hidden className="size-4 fill-accent text-accent" /> : null}
          <ChevronDown aria-hidden className="size-4 text-fg-muted" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            collisionPadding={8}
            // never taller than the room beside the button: on a short phone screen the
            // menu scrolls inside itself instead of running off the bottom
            className="z-50 max-h-[min(70dvh,var(--radix-dropdown-menu-content-available-height))] min-w-[15rem] overflow-y-auto overscroll-contain rounded-[14px] border border-line bg-surface p-1.5 text-fg shadow-sheet data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          >
            <DropdownMenu.RadioGroup value={entry.status} onValueChange={(v) => void setStatus(work, v as LibraryStatus)}>
              {STATUSES.map((s) => (
                <DropdownMenu.RadioItem key={s} value={s} className={item}>
                  <span className="inline-flex size-4 items-center justify-center">
                    <DropdownMenu.ItemIndicator>
                      <Check aria-hidden className="size-4" />
                    </DropdownMenu.ItemIndicator>
                  </span>
                  {statusLabel(s, labels)}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="my-1.5 h-px bg-line" />
            <DropdownMenu.CheckboxItem
              checked={Boolean(entry.favourite)}
              onCheckedChange={(c) => void setFavourite(work, c === true)}
              onSelect={(e) => e.preventDefault()}
              className={item}
            >
              <Heart aria-hidden className={cn("size-4", entry.favourite && "fill-accent text-accent")} />
              {labels.favourite}
            </DropdownMenu.CheckboxItem>
            <DropdownMenu.Separator className="my-1.5 h-px bg-line" />
            <DropdownMenu.Label className="px-3 pt-1 pb-1.5 text-xs text-fg-subtle">{labels.addToShelf}</DropdownMenu.Label>
            {shelves.map((s) => (
              <DropdownMenu.CheckboxItem
                key={s.id}
                checked={on.has(s.id)}
                onCheckedChange={(c) => void setOnShelf(s.id, work, c === true)}
                onSelect={(e) => e.preventDefault()}
                className={item}
              >
                <span className="inline-flex size-4 items-center justify-center rounded-[4px] border border-line-strong">
                  <DropdownMenu.ItemIndicator>
                    <Check aria-hidden className="size-3.5" />
                  </DropdownMenu.ItemIndicator>
                </span>
                <span className="min-w-0 truncate">{s.name}</span>
              </DropdownMenu.CheckboxItem>
            ))}
            <DropdownMenu.Item onSelect={() => setNaming(true)} className={item}>
              <Plus aria-hidden className="size-4" />
              {labels.newShelf}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1.5 h-px bg-line" />
            <DropdownMenu.Item onSelect={() => void removeFromLibrary(work.slug)} className={cn(item, "text-destructive")}>
              <Trash2 aria-hidden className="size-4" />
              {labels.remove}
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ShelfNameDialog
        open={naming}
        onOpenChange={setNaming}
        title={labels.newShelf}
        labels={{ shelfName: labels.shelfName, shelfNamePlaceholder: labels.shelfNamePlaceholder, submit: labels.create, cancel: labels.cancel }}
        onSubmit={async (name) => {
          const id = await createShelf(name);
          if (id) await setOnShelf(id, work, true);
          setNaming(false);
        }}
      />
    </>
  );
}
