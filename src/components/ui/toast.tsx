"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export type ToastMessage = { id: number; text: string; action?: { label: string; onClick: () => void }; duration?: number };

let seq = 0;
/** A fresh id, so the same message shown twice still re-announces. */
export const toastId = () => ++seq;

/** A short status line at the bottom of the screen; with an action (undo) it stays a little longer. */
export function Toast({ toast, onDone, className }: { toast: ToastMessage | null; onDone: () => void; className?: string }) {
  // the timer belongs to the message: re-renders (a page turn) must not restart it
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => done.current(), toast.duration ?? (toast.action ? 6000 : 2200));
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div role="status" aria-live="polite" className={cn("pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4", className ?? "bottom-6 pb-safe")}>
      {toast ? (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-4 rounded-full bg-[var(--ink,var(--fg))] py-2.5 pr-2.5 pl-5 text-sm text-[var(--paper,var(--surface))] shadow-sheet animate-in fade-in-0 slide-in-from-bottom-2 duration-200 motion-reduce:animate-none"
        >
          <span>{toast.text}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action!.onClick();
                onDone();
              }}
              className="h-8 rounded-full px-3 font-medium underline-offset-4 hover:underline"
            >
              {toast.action.label}
            </button>
          ) : (
            <span className="w-2.5" />
          )}
        </div>
      ) : null}
    </div>
  );
}
