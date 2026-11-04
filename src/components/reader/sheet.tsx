"use client";

import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/** A reader side sheet: a bottom sheet on phones, a full-height panel at the side on larger screens. */
export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  side = "right",
  closeLabel = "Close",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  children: React.ReactNode;
  side?: "right" | "left";
  closeLabel?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[82dvh] flex-col rounded-t-[20px] bg-[var(--paper)] text-[var(--ink)] shadow-sheet pb-safe outline-none",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-8 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-8 duration-300",
            "sm:inset-y-0 sm:max-h-none sm:w-[24rem] sm:rounded-none",
            side === "right"
              ? "sm:right-0 sm:left-auto sm:data-[state=open]:slide-in-from-right-8 sm:data-[state=closed]:slide-out-to-right-8"
              : "sm:left-0 sm:right-auto sm:data-[state=open]:slide-in-from-left-8 sm:data-[state=closed]:slide-out-to-left-8",
          )}
        >
          <div className="flex items-center justify-between border-b border-[color-mix(in_oklab,var(--ink)_10%,transparent)] px-5 py-3 sm:pt-safe">
            <Dialog.Title className="font-display text-xl">{title}</Dialog.Title>
            <Dialog.Close className="inline-flex size-10 items-center justify-center rounded-full hover:bg-[color-mix(in_oklab,var(--ink)_8%,transparent)]">
              <X aria-hidden className="size-5" />
              <span className="sr-only">{closeLabel}</span>
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          {/* min-h-0: a flex child must be allowed to shrink, or it grows past the sheet and cannot scroll */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
