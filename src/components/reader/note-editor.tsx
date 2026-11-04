"use client";

import { useState } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import type { Annotation } from "@/lib/local/db";
import { SWATCH } from "@/lib/reader/annotations";
import { cn } from "@/lib/utils";

type Labels = { note: string; notePlaceholder: string; save: string; cancel: string; deleteNote: string; closeMenu: string };

/**
 * Writing or editing the note on a highlight. Used in the reader and on the
 * notes page, so it reads the reader's page colours when they exist and the
 * site's surface colours otherwise. Ctrl/⌘+Enter saves.
 */
export function NoteEditor({
  annotation,
  labels,
  onSave,
  onClose,
}: {
  annotation: Annotation | null;
  labels: Labels;
  onSave: (note: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open={annotation !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[90dvh] flex-col rounded-t-[20px] bg-[var(--paper,var(--surface))] text-[var(--ink,var(--fg))] shadow-sheet pb-safe outline-none",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-8 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-300",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[32rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px] sm:data-[state=open]:slide-in-from-bottom-2",
          )}
        >
          {/* keyed by highlight, so the draft resets for each one */}
          {annotation ? <EditorBody key={annotation.id} annotation={annotation} labels={labels} onSave={onSave} onClose={onClose} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function EditorBody({
  annotation,
  labels,
  onSave,
  onClose,
}: {
  annotation: Annotation;
  labels: Labels;
  onSave: (note: string | null) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(annotation.note ?? "");
  const save = () => onSave(draft.trim() ? draft.trim() : null);
  const accent = annotation.style === "underline" ? "var(--color-accent)" : SWATCH[annotation.color];
  return (
    <>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <Dialog.Title className="font-display text-xl">{labels.note}</Dialog.Title>
        <Dialog.Close className="inline-flex size-10 items-center justify-center rounded-full hover:bg-[color-mix(in_oklab,currentColor_8%,transparent)]">
          <X aria-hidden className="size-5" />
          <span className="sr-only">{labels.closeMenu}</span>
        </Dialog.Close>
      </div>
      <Dialog.Description asChild>
        <blockquote
          className="mx-5 line-clamp-4 border-l-[3px] pl-3 font-read text-[0.98rem] leading-relaxed opacity-90"
          style={{ borderColor: accent }}
        >
          {annotation.quote}
        </blockquote>
      </Dialog.Description>
      <div className="px-5 pt-4">
        <label htmlFor="note-text" className="sr-only">
          {labels.note}
        </label>
        <textarea
          id="note-text"
          autoFocus
          rows={5}
          maxLength={5000}
          value={draft}
          placeholder={labels.notePlaceholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
              e.preventDefault();
              save();
            }
          }}
          className="block w-full resize-y rounded-[12px] border border-[color-mix(in_oklab,currentColor_18%,transparent)] bg-transparent px-3.5 py-3 text-base leading-relaxed outline-none placeholder:opacity-55 focus:border-[color-mix(in_oklab,currentColor_45%,transparent)]"
        />
      </div>
      <div className="flex items-center gap-3 px-5 pt-4 pb-5">
        {annotation.note ? (
          <button
            type="button"
            onClick={() => onSave(null)}
            className="mr-auto h-11 rounded-[10px] px-3 text-sm text-accent-text hover:bg-[color-mix(in_oklab,currentColor_6%,transparent)]"
          >
            {labels.deleteNote}
          </button>
        ) : (
          <span className="mr-auto" />
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-[10px] border border-[color-mix(in_oklab,currentColor_25%,transparent)] px-4"
        >
          {labels.cancel}
        </button>
        <button
          type="button"
          onClick={save}
          className="h-11 rounded-[10px] bg-[var(--ink,var(--fg))] px-5 text-[var(--paper,var(--surface))]"
        >
          {labels.save}
        </button>
      </div>
    </>
  );
}
