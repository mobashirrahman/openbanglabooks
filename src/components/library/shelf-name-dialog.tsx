"use client";

import { useState } from "react";
import { Dialog } from "radix-ui";
import { SHELF_NAME_MAX } from "@/lib/library/store";

/** Asks for a shelf name (new shelf, or a rename). */
export function ShelfNameDialog({
  open,
  onOpenChange,
  title,
  initial = "",
  labels,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  initial?: string;
  labels: { shelfName: string; shelfNamePlaceholder: string; submit: string; cancel: string };
  onSubmit: (name: string) => void | Promise<void>;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 rounded-[16px] bg-surface p-5 text-fg shadow-sheet outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:p-6">
          <Dialog.Title className="font-display text-2xl">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{labels.shelfName}</Dialog.Description>
          {open ? <NameForm initial={initial} labels={labels} onSubmit={onSubmit} onCancel={() => onOpenChange(false)} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NameForm({
  initial,
  labels,
  onSubmit,
  onCancel,
}: {
  initial: string;
  labels: { shelfName: string; shelfNamePlaceholder: string; submit: string; cancel: string };
  onSubmit: (name: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  return (
    <form
      className="mt-5 space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim()) await onSubmit(name.trim());
      }}
    >
      <label className="block space-y-2">
        <span className="block text-sm text-fg-muted">{labels.shelfName}</span>
        <input
          autoFocus
          value={name}
          maxLength={SHELF_NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          placeholder={labels.shelfNamePlaceholder}
          className="h-12 w-full rounded-control border border-line-strong bg-bg px-4 text-base outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
        />
      </label>
      <div className="flex justify-end gap-3">
        <button type="button" onClick={onCancel} className="h-11 rounded-control px-4 text-fg-muted hover:bg-sunken hover:text-fg">
          {labels.cancel}
        </button>
        <button type="submit" disabled={!name.trim()} className="h-11 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised disabled:opacity-60">
          {labels.submit}
        </button>
      </div>
    </form>
  );
}
