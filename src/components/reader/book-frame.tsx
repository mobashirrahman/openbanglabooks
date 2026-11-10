"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The physical book around the EPUB renderer. On wide screens: two facing
 * pages with a gutter shadow, a little paper depth, and page-block edges whose
 * thickness follows how far you have read (pages read on the left, pages to
 * come on the right). Live text is never transformed – the page-turn effect is
 * a moving shadow above the text, not a distortion of it.
 */
export function BookFrame({
  width,
  height,
  columns,
  mobile,
  fraction,
  sweep,
  edgeButtons,
  dark,
  onEdge,
  labels,
  pageRef,
  flapRef,
  shadeRef,
  creaseRef,
  children,
}: {
  width: number;
  height: number;
  columns: 1 | 2;
  mobile: boolean;
  fraction: number;
  /** the latest page turn (a new id replays the leaf shadow); null when motion is off */
  sweep: { id: number; dir: 1 | -1 } | null;
  /** enough desk for the hover arrows to sit beside the book, not on it */
  edgeButtons: boolean;
  dark: boolean;
  onEdge: (dir: 1 | -1) => void;
  labels: { prev: string; next: string };
  /** the layers a page curl draws with (see lib/reader/page-curl) */
  pageRef: React.Ref<HTMLDivElement>;
  flapRef: React.Ref<HTMLDivElement>;
  shadeRef: React.Ref<HTMLDivElement>;
  creaseRef: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}) {
  if (!width) return null;
  const edgeMax = 7;
  const leftEdge = Math.max(1, Math.round(fraction * edgeMax));
  const rightEdge = Math.max(1, Math.round((1 - fraction) * edgeMax));
  const edgeColor = dark ? "rgb(255 255 255 / 0.10)" : "rgb(40 39 32 / 0.16)";

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        className={cn("relative", !mobile && "rounded-[3px]")}
        style={{
          width,
          height,
          background: "var(--paper)",
          boxShadow: mobile
            ? undefined
            : dark
              ? "0 30px 70px -30px rgb(0 0 0 / 0.8), 0 0 0 1px rgb(255 255 255 / 0.04)"
              : "0 34px 70px -34px rgb(40 35 25 / 0.55), 0 8px 18px -10px rgb(40 35 25 / 0.25)",
        }}
      >
        {/* page-block edges: stacked page lines outside the cover boundary */}
        {!mobile ? (
          <>
            <div
              aria-hidden
              className="absolute top-[3px] bottom-[3px]"
              style={{
                right: "100%",
                width: leftEdge,
                background: `repeating-linear-gradient(90deg, var(--paper) 0 1px, ${edgeColor} 1px 2px)`,
                borderRadius: "2px 0 0 2px",
              }}
            />
            <div
              aria-hidden
              className="absolute top-[3px] bottom-[3px]"
              style={{
                left: "100%",
                width: rightEdge,
                background: `repeating-linear-gradient(90deg, ${edgeColor} 0 1px, var(--paper) 1px 2px)`,
                borderRadius: "0 2px 2px 0",
              }}
            />
          </>
        ) : null}

        {/* a curling leaf's shading: the shadow its still-flat part carries at the
            fold, the shadow on the page it uncovers, and the back of the paper.
            Painted beneath the page; visible only while a curl transition shows them. */}
        <div ref={creaseRef} data-curl-layer aria-hidden className="pointer-events-none absolute inset-0 -z-10" />
        <div ref={shadeRef} data-curl-layer aria-hidden className="pointer-events-none absolute inset-0 -z-10" />
        <div ref={flapRef} data-curl-layer aria-hidden className="pointer-events-none absolute inset-0 -z-10" />

        {/* the page itself: everything a page curl turns over */}
        <div ref={pageRef} className={cn("absolute inset-0 overflow-hidden bg-[var(--paper)]", !mobile && "rounded-[3px]")}>
          {children}

          {/* gutter: the fold between facing pages */}
          {columns === 2 ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-y-0 left-1/2 w-[9%] -translate-x-1/2"
              style={{
                background: dark
                  ? "linear-gradient(90deg, transparent, rgb(0 0 0 / 0.22) 46%, rgb(0 0 0 / 0.32) 50%, rgb(0 0 0 / 0.22) 54%, transparent)"
                  : "linear-gradient(90deg, transparent, rgb(60 45 25 / 0.07) 40%, rgb(60 45 25 / 0.16) 49.5%, rgb(255 255 255 / 0.25) 50.5%, rgb(60 45 25 / 0.07) 60%, transparent)",
              }}
            />
          ) : null}
          {/* a soft curvature at the outer edges of the paper */}
          {!mobile ? (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-[3px]"
              style={{
                background: dark
                  ? "linear-gradient(90deg, rgb(0 0 0 / 0.18), transparent 3%, transparent 97%, rgb(0 0 0 / 0.18))"
                  : "linear-gradient(90deg, rgb(60 45 25 / 0.06), transparent 3%, transparent 97%, rgb(60 45 25 / 0.06))",
              }}
            />
          ) : null}

          {/* leaf shadow sweeping across the page on a turn */}
          {sweep ? (
            <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
              <div
                key={sweep.id}
                className={cn("leaf-sweep absolute inset-y-0 w-[38%]", sweep.dir === 1 ? "leaf-sweep-next" : "leaf-sweep-prev")}
                style={{
                  background: dark
                    ? "linear-gradient(90deg, transparent, rgb(0 0 0 / 0.28) 70%, rgb(0 0 0 / 0.05))"
                    : "linear-gradient(90deg, transparent, rgb(60 45 25 / 0.12) 70%, rgb(255 255 255 / 0.18))",
                }}
              />
            </div>
          ) : null}
        </div>

      </div>

      {/* desktop page edges are buttons, too: in the desk margin at the screen's
          edge, so a wider book never pushes them off it */}
      {!mobile && edgeButtons ? (
        <>
          <button
            type="button"
            onClick={() => onEdge(-1)}
            aria-label={labels.prev}
            className="absolute top-1/2 left-2 z-10 flex size-14 -translate-y-1/2 items-center justify-center rounded-full text-[var(--ink-muted)] opacity-0 transition-[opacity,background-color] duration-200 hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronLeft aria-hidden className="size-7" />
          </button>
          <button
            type="button"
            onClick={() => onEdge(1)}
            aria-label={labels.next}
            className="absolute top-1/2 right-2 z-10 flex size-14 -translate-y-1/2 items-center justify-center rounded-full text-[var(--ink-muted)] opacity-0 transition-[opacity,background-color] duration-200 hover:bg-[color-mix(in_oklab,var(--ink)_7%,transparent)] hover:opacity-100 focus-visible:opacity-100"
          >
            <ChevronRight aria-hidden className="size-7" />
          </button>
        </>
      ) : null}
    </div>
  );
}
