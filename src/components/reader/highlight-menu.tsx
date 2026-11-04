"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Copy, NotebookPen, Trash2, Underline } from "lucide-react";
import type { Annotation, HighlightColor } from "@/lib/local/db";
import { HIGHLIGHT_COLORS, SWATCH } from "@/lib/reader/annotations";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { cn } from "@/lib/utils";

export type MenuAnchor = { first: DOMRect; last: DOMRect };
export type MenuState =
  | { kind: "selection"; anchor: MenuAnchor; quote: string }
  | { kind: "mark"; id: string; anchor: MenuAnchor };

/** For extra actions placed in the menu. */
export const menuButtonClass =
  "inline-flex size-10 shrink-0 items-center justify-center rounded-full text-[var(--ink)] transition-colors duration-150 hover:bg-[color-mix(in_oklab,var(--ink)_8%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--ink)]";

const GAP = 10;
const EDGE = 8;

/**
 * The menu for a text selection or a tapped highlight: colours, underline,
 * note, copy (and delete for an existing highlight). Above the selection on
 * desktop; below it on touch screens, where the system's own selection menu
 * sits above.
 */
export function HighlightMenu({
  state,
  annotation,
  labels,
  extra,
  onColor,
  onUnderline,
  onNote,
  onCopy,
  onDelete,
}: {
  state: MenuState;
  annotation: Annotation | null;
  labels: Dictionary["reader"];
  /** further actions (e.g. share as image) */
  extra?: React.ReactNode;
  onColor: (c: HighlightColor) => void;
  onUnderline: () => void;
  onNote: () => void;
  onCopy: () => void;
  onDelete: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const { first, last } = state.anchor;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const above = first.top - GAP - height;
    const below = last.bottom + GAP + (coarse ? 14 : 0); // clear the selection handles
    let top = coarse ? below : above;
    if (top < EDGE || top + height > vh - EDGE) top = coarse ? above : below;
    top = Math.min(Math.max(EDGE, top), vh - height - EDGE);
    const centre = ((coarse ? last : first).left + (coarse ? last : first).right) / 2;
    const left = Math.min(Math.max(EDGE, centre - width / 2), vw - width - EDGE);
    setPos({ left, top });
  }, [state]);

  const mark = state.kind === "mark" ? annotation : null;
  const btn = menuButtonClass;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label={labels.highlightMenu}
      data-highlight-menu
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        // "how it looks" (colours, underline) and "what to do" side by side; stacked on narrow phones
        "fixed z-30 flex max-w-[calc(100vw-16px)] flex-col items-center gap-0.5 rounded-[22px] border border-[color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[var(--paper)] p-1 shadow-sheet min-[460px]:flex-row min-[460px]:rounded-full",
        "animate-in fade-in-0 zoom-in-95 duration-150 motion-reduce:animate-none",
        !pos && "invisible",
      )}
      style={pos ?? { left: 0, top: 0 }}
    >
      <div className="flex items-center gap-0.5">
        {HIGHLIGHT_COLORS.map((c) => {
          const active = mark?.style === "highlight" && mark.color === c;
          return (
            <button
              key={c}
              type="button"
              aria-label={labels.colors[c]}
              aria-pressed={mark ? active : undefined}
              onClick={() => onColor(c)}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-[var(--ink)]"
            >
              <span
                aria-hidden
                className={cn(
                  "size-6 rounded-full transition-transform duration-150",
                  active && "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--paper)]",
                )}
                style={{ background: SWATCH[c] }}
              />
            </button>
          );
        })}
        <button
          type="button"
          aria-label={labels.underline}
          aria-pressed={mark ? mark.style === "underline" : undefined}
          onClick={onUnderline}
          className={cn(btn, mark?.style === "underline" && "text-accent")}
        >
          <Underline aria-hidden className="size-[18px]" />
        </button>
      </div>
      <span
        aria-hidden
        className="h-px w-[calc(100%-24px)] bg-[color-mix(in_oklab,var(--ink)_12%,transparent)] min-[460px]:mx-0.5 min-[460px]:h-6 min-[460px]:w-px"
      />
      <div className="flex items-center gap-0.5">
        <button type="button" aria-label={mark?.note ? labels.editNote : labels.addNote} onClick={onNote} className={btn}>
          <NotebookPen aria-hidden className="size-[18px]" />
        </button>
        <button type="button" aria-label={labels.copy} onClick={onCopy} className={btn}>
          <Copy aria-hidden className="size-[18px]" />
        </button>
        {extra}
        {mark ? (
          <button type="button" aria-label={labels.deleteHighlight} onClick={onDelete} className={btn}>
            <Trash2 aria-hidden className="size-[18px]" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
