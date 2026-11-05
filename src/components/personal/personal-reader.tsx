"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { CloudDownload, BookX } from "lucide-react";
import { localDB } from "@/lib/local/db";
import { Reader, type ReaderProps } from "@/components/reader/reader";
import { downloadPersonalBook, PersonalError, personalSnapshot } from "@/lib/personal/store";
import { useAccount } from "@/lib/account/session";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

type Props = Omit<ReaderProps, "work" | "fileSha" | "fileUrl" | "next"> & {
  id: string;
  libraryHref: string;
  signInHref: string;
  personal: Dictionary["personal"];
};

/**
 * The reader for a reader's own book. The server knows nothing about it, so
 * everything comes from this device: the book's record and its file. A book
 * kept in the account but not yet on this device is downloaded first.
 */
export function PersonalReader({ id, libraryHref, signInHref, personal, ...reader }: Props) {
  const book = useLiveQuery(async () => {
    const db = localDB();
    const b = await db.personalBooks.get(id);
    if (!b) return null;
    const file = await db.files.get(b.fileSha);
    return { book: b, here: Boolean(file) };
  }, [id]);
  const account = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (book === undefined) return <div className="reader fixed inset-0" data-phase="loading" aria-busy />;

  if (book?.here) {
    const work = personalSnapshot(book.book);
    return <Reader {...reader} work={{ ...work, title_en: book.book.title }} fileSha={book.book.fileSha} fileUrl={null} next={[]} />;
  }

  const inAccount = Boolean(book?.book.cloud);
  const signedIn = account.status === "signed-in";
  return (
    <div className="reader fixed inset-0 flex items-center justify-center bg-[var(--desk,#F5EFE4)] px-6" data-phase="missing">
      <div className="max-w-sm text-center">
        {inAccount ? <CloudDownload aria-hidden className="mx-auto size-8 opacity-70" /> : <BookX aria-hidden className="mx-auto size-8 opacity-70" />}
        <h1 className="mt-4 font-display text-2xl">{inAccount ? book!.book.title : personal.notHereTitle}</h1>
        <p className="mt-2 opacity-75">{inAccount ? (signedIn ? personal.downloadBody : personal.keepNeedsSignIn) : personal.notHereBody}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          {inAccount && signedIn ? (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  await downloadPersonalBook(id);
                } catch (e) {
                  setError(personal[e instanceof PersonalError ? e.code : "failed"]);
                } finally {
                  setBusy(false);
                }
              }}
              className="h-11 rounded-[10px] bg-[var(--ink,#282720)] px-5 text-[var(--paper,#FBF8F2)] disabled:opacity-60"
            >
              {busy ? personal.downloading : personal.download}
            </button>
          ) : null}
          {inAccount && !signedIn ? (
            <a href={signInHref} className="inline-flex h-11 items-center rounded-[10px] bg-[var(--ink,#282720)] px-5 text-[var(--paper,#FBF8F2)]">
              {personal.signIn}
            </a>
          ) : null}
          <a href={libraryHref} className="inline-flex h-11 items-center rounded-[10px] border border-current/40 px-5">
            {personal.backToLibrary}
          </a>
        </div>
        <p role="status" className="mt-4 min-h-6 text-sm">
          {error}
        </p>
      </div>
    </div>
  );
}
