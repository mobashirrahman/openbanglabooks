"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { BookPlus, Check, CloudUpload, LoaderCircle, TriangleAlert } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { useAccount } from "@/lib/account/session";
import { cn } from "@/lib/utils";
import type { ImportStep } from "@/lib/personal/import";
import { personalSnapshot } from "@/lib/personal/store";

type Labels = Dictionary["personal"];
type State =
  | { kind: "idle" }
  | { kind: "working"; step: ImportStep; name: string }
  | { kind: "done"; id: string; title: string; author: string | null; added: boolean; cloud: "no" | "busy" | "yes"; cloudError?: string }
  | { kind: "error"; message: string };

const isEpub = (f: File) => /\.epub$/i.test(f.name) || f.type === "application/epub+zip";

/**
 * "Add your own book": a file picker, and dropping an EPUB anywhere on the
 * page. The work happens in this browser (src/lib/personal/import.ts); the
 * dialog shows each step, then offers to read the book or keep it in the
 * account (never by default).
 *
 * The state lives in a hook, so the button can move (the empty library's
 * button goes away once the first book is in) while the dialog stays open.
 */
export function useBookImport(labels: Labels) {
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragging, setDragging] = useState(false);

  const run = useCallback(
    async (file: File) => {
      setState({ kind: "working", step: "reading", name: file.name });
      try {
        // loaded on demand: the cleaner and zip writer are only needed here
        const [{ prepareEpub, ImportError }, { savePersonalBook }] = await Promise.all([import("@/lib/personal/import"), import("@/lib/personal/store")]);
        try {
          const prepared = await prepareEpub(file, (step) => setState({ kind: "working", step, name: file.name }));
          const added = await savePersonalBook(prepared);
          setState({ kind: "done", id: prepared.id, title: prepared.title, author: prepared.author, added, cloud: "no" });
        } catch (e) {
          const code = e instanceof ImportError ? e.code : "broken";
          if (!(e instanceof ImportError)) console.warn("[import]", e);
          setState({ kind: "error", message: labels[code] });
        }
      } catch {
        setState({ kind: "error", message: labels.failed });
      }
    },
    [labels],
  );

  // an EPUB dropped anywhere on the page
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const file = Array.from(e.dataTransfer?.files ?? []).find(isEpub) ?? e.dataTransfer?.files[0];
      if (file) void run(file);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [run]);

  const keep = async (id: string) => {
    setState((s) => (s.kind === "done" ? { ...s, cloud: "busy", cloudError: undefined } : s));
    try {
      const { keepInAccount, PersonalError } = await import("@/lib/personal/store");
      try {
        await keepInAccount(id);
        setState((s) => (s.kind === "done" ? { ...s, cloud: "yes" } : s));
      } catch (e) {
        setState((s) => (s.kind === "done" ? { ...s, cloud: "no", cloudError: labels[e instanceof PersonalError ? e.code : "failed"] } : s));
      }
    } catch {
      setState((s) => (s.kind === "done" ? { ...s, cloud: "no", cloudError: labels.failed } : s));
    }
  };

  return { input, state, setState, dragging, run, keep, choose: () => input.current?.click() };
}
export type BookImport = ReturnType<typeof useBookImport>;

export function ImportBookButton({ imp, labels, className }: { imp: BookImport; labels: Labels; className?: string }) {
  return (
    <button
      type="button"
      onClick={imp.choose}
      className={cn("inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-line-strong px-4 text-sm hover:bg-sunken", className)}
    >
      <BookPlus aria-hidden className="size-4" />
      {labels.addBook}
    </button>
  );
}

/** The file input, the drop overlay and the dialog: render once, where it will not move. */
export function ImportBookDialog({ imp, locale, labels }: { imp: BookImport; locale: Locale; labels: Labels }) {
  const { input, state, setState, dragging, run, keep } = imp;
  const account = useAccount();
  const open = state.kind !== "idle";
  const signedIn = account.status === "signed-in";

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".epub,application/epub+zip"
        className="sr-only"
        tabIndex={-1}
        aria-label={labels.chooseFile}
        data-testid="import-epub"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void run(file);
        }}
      />

      {dragging ? (
        <div className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center rounded-[20px] border-2 border-dashed border-cloth bg-surface/90 text-xl text-fg">
          {labels.dropHere}
        </div>
      ) : null}

      <Dialog.Root open={open} onOpenChange={(o) => !o && state.kind !== "working" && setState({ kind: "idle" })}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0" />
          <Dialog.Content
            onEscapeKeyDown={(e) => state.kind === "working" && e.preventDefault()}
            onPointerDownOutside={(e) => state.kind === "working" && e.preventDefault()}
            className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 -translate-y-1/2 rounded-[16px] bg-surface p-5 text-fg shadow-sheet outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:p-6"
          >
            <Dialog.Title className="font-display text-2xl">{labels.addBook}</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-fg-muted">{labels.addHint}</Dialog.Description>

            {state.kind === "working" ? (
              <div className="mt-6 flex items-center gap-3" role="status">
                <LoaderCircle aria-hidden className="size-5 animate-spin text-fg-muted motion-reduce:animate-none" />
                <div className="min-w-0">
                  <p>{labels[state.step]}</p>
                  <p className="truncate text-sm text-fg-subtle">{state.name}</p>
                </div>
              </div>
            ) : null}

            {state.kind === "error" ? (
              <div className="mt-6 space-y-5">
                <p role="alert" className="flex items-start gap-3">
                  <TriangleAlert aria-hidden className="mt-0.5 size-5 shrink-0 text-destructive" />
                  {state.message}
                </p>
                <div className="flex justify-end gap-3">
                  <Dialog.Close className="h-11 rounded-control px-4 text-fg-muted hover:bg-sunken hover:text-fg">{labels.close}</Dialog.Close>
                  <button type="button" onClick={() => input.current?.click()} className="h-11 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
                    {labels.chooseFile}
                  </button>
                </div>
              </div>
            ) : null}

            {state.kind === "done" ? (
              <div className="mt-6 space-y-5">
                <div className="flex items-center gap-4">
                  <div className="w-16 shrink-0">
                    <BookCover work={personalSnapshot({ id: state.id, title: state.title, author: state.author })} />
                  </div>
                  <p role="status" className="min-w-0">
                    {t(state.added ? labels.added : labels.already, { title: state.title })}
                  </p>
                </div>

                <div className="rounded-[12px] border border-line p-4">
                  {state.cloud === "yes" ? (
                    <p className="flex items-center gap-2 text-sm">
                      <Check aria-hidden className="size-4 text-cloth" />
                      {labels.uploaded}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm text-fg-muted">{signedIn ? labels.keepInAccountHint : labels.keepNeedsSignIn}</p>
                      {signedIn ? (
                        <button
                          type="button"
                          disabled={state.cloud === "busy"}
                          onClick={() => void keep(state.id)}
                          className="mt-3 inline-flex h-10 items-center gap-2 rounded-control border border-line-strong px-4 text-sm hover:bg-sunken disabled:opacity-60"
                        >
                          <CloudUpload aria-hidden className="size-4" />
                          {state.cloud === "busy" ? labels.uploading : labels.keepInAccount}
                        </button>
                      ) : null}
                      {state.cloudError ? (
                        <p role="alert" className="mt-2 text-sm text-destructive">
                          {state.cloudError}
                        </p>
                      ) : null}
                    </>
                  )}
                </div>

                <div className="flex justify-end gap-3">
                  <Dialog.Close className="h-11 rounded-control px-4 text-fg-muted hover:bg-sunken hover:text-fg">{labels.close}</Dialog.Close>
                  <a href={localizedPath(locale, `/read/${state.id}`)} className="inline-flex h-11 items-center rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
                    {labels.read}
                  </a>
                </div>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** The button and its dialog together, for a place that never unmounts the button. */
export function ImportBook({ locale, labels, className }: { locale: Locale; labels: Labels; className?: string }) {
  const imp = useBookImport(labels);
  return (
    <>
      <ImportBookButton imp={imp} labels={labels} className={className} />
      <ImportBookDialog imp={imp} locale={locale} labels={labels} />
    </>
  );
}
