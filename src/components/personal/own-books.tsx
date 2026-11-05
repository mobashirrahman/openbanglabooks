"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Dialog, DropdownMenu } from "radix-ui";
import { Cloud, CloudUpload, HardDrive, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { localDB, type PersonalBook } from "@/lib/local/db";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { useAccount } from "@/lib/account/session";
import { deletePersonalBook, keepInAccount, PersonalError, personalSnapshot, renamePersonalBook } from "@/lib/personal/store";

type Labels = Dictionary["personal"];

const itemClass =
  "flex h-11 cursor-pointer items-center gap-3 rounded-[8px] px-3 text-sm outline-none select-none data-[disabled]:cursor-default data-[disabled]:opacity-50 data-[highlighted]:bg-sunken";

/** The reader's own books: where each one lives, and what can be done with it. */
export function OwnBooks({ locale, labels, onNotice }: { locale: Locale; labels: Labels; onNotice: (text: string) => void }) {
  const books = useLiveQuery(async () => {
    const db = localDB();
    const list = await db.personalBooks.orderBy("addedAt").reverse().toArray();
    const here = await Promise.all(list.map((b) => db.files.get(b.fileSha).then(Boolean)));
    return list.map((b, i) => ({ book: b, here: here[i] }));
  }, []);
  const account = useAccount();
  const [busy, setBusy] = useState<{ id: string; label: string | null } | null>(null);
  const [renaming, setRenaming] = useState<PersonalBook | null>(null);

  if (!books) return <div className="min-h-40" aria-busy />;

  const act = async (id: string, fn: () => Promise<void>, done?: string, pending: string | null = null) => {
    setBusy({ id, label: pending });
    try {
      await fn();
      // told by the library, which outlives this list (the last book deleted takes the list with it)
      if (done) onNotice(done);
    } catch (e) {
      onNotice(labels[e instanceof PersonalError ? e.code : "failed"]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="own-books-heading" className="space-y-5">
      <h2 id="own-books-heading" className="text-2xl sm:text-3xl">
        {labels.ownBooks}
      </h2>
      <p className="max-w-2xl text-sm text-fg-muted">{labels.privacy}</p>
      <ul className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-4 lg:grid-cols-6">
        {books.map(({ book, here }) => (
          <li key={book.id} className="relative" data-own-book={book.id}>
            <a href={localizedPath(locale, `/read/${book.id}`)} className="group block">
              <BookCover work={personalSnapshot(book)} interactive />
              <span className="mt-2 block truncate font-display">{book.title}</span>
              {book.author ? <span className="block truncate text-sm text-fg-muted">{book.author}</span> : null}
            </a>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-fg-subtle">
                {book.cloud ? <Cloud aria-hidden className="size-3.5 shrink-0" /> : <HardDrive aria-hidden className="size-3.5 shrink-0" />}
                <span className="truncate">{book.cloud ? labels.inAccount : labels.onThisDevice}</span>
              </span>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger
                  disabled={busy?.id === book.id}
                  aria-label={t(labels.actions, { title: book.title })}
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-control text-fg-muted hover:bg-sunken hover:text-fg disabled:opacity-50"
                >
                  <MoreHorizontal aria-hidden className="size-5" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content align="end" sideOffset={4} className="z-50 min-w-56 rounded-[12px] border border-line bg-surface p-1.5 text-fg shadow-sheet">
                    {!book.cloud ? (
                      <DropdownMenu.Item
                        className={itemClass}
                        disabled={account.status !== "signed-in" || !here}
                        onSelect={() => void act(book.id, () => keepInAccount(book.id), labels.uploaded, labels.uploading)}
                      >
                        <CloudUpload aria-hidden className="size-4" />
                        {labels.keepInAccount}
                      </DropdownMenu.Item>
                    ) : null}
                    <DropdownMenu.Item className={itemClass} onSelect={() => setRenaming(book)}>
                      <Pencil aria-hidden className="size-4" />
                      {labels.edit}
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={`${itemClass} text-destructive`}
                      onSelect={() => {
                        if (!window.confirm(t(book.cloud ? labels.deleteConfirmCloud : labels.deleteConfirm, { title: book.title }))) return;
                        void act(book.id, () => deletePersonalBook(book.id), labels.deleted);
                      }}
                    >
                      <Trash2 aria-hidden className="size-4" />
                      {labels.delete}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
            {busy?.id === book.id && busy.label ? <p className="text-xs text-fg-muted">{busy.label}</p> : null}
          </li>
        ))}
      </ul>
      {account.status !== "signed-in" && books.some((b) => !b.book.cloud) ? <p className="text-sm text-fg-subtle">{labels.keepNeedsSignIn}</p> : null}

      <Dialog.Root open={renaming !== null} onOpenChange={(o) => !o && setRenaming(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-[16px] bg-surface p-5 text-fg shadow-sheet outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:p-6">
            <Dialog.Title className="font-display text-2xl">{labels.edit}</Dialog.Title>
            <Dialog.Description className="sr-only">{labels.titleLabel}</Dialog.Description>
            {renaming ? (
              <form
                className="mt-5 space-y-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = new FormData(e.currentTarget);
                  await renamePersonalBook(renaming.id, String(form.get("title") ?? ""), String(form.get("author") ?? ""));
                  setRenaming(null);
                }}
              >
                <label className="block space-y-2">
                  <span className="block text-sm text-fg-muted">{labels.titleLabel}</span>
                  <input name="title" required maxLength={500} defaultValue={renaming.title} autoFocus className="h-12 w-full rounded-control border border-line-strong bg-bg px-4 outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30" />
                </label>
                <label className="block space-y-2">
                  <span className="block text-sm text-fg-muted">{labels.authorLabel}</span>
                  <input name="author" maxLength={500} defaultValue={renaming.author ?? ""} className="h-12 w-full rounded-control border border-line-strong bg-bg px-4 outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30" />
                </label>
                <div className="flex justify-end gap-3 pt-1">
                  <Dialog.Close type="button" className="h-11 rounded-control px-4 text-fg-muted hover:bg-sunken hover:text-fg">
                    {labels.cancel}
                  </Dialog.Close>
                  <button type="submit" className="h-11 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
                    {labels.save}
                  </button>
                </div>
              </form>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
