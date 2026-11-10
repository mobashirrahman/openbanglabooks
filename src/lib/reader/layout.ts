import type { ReaderLayout, ReaderMargin } from "./settings";

/**
 * Decides one page or a two-page spread for the available stage size.
 * A spread needs room for two comfortable columns (~28em each of Bengali
 * text) and a landscape stage; otherwise we fall back to a single page even
 * if the reader asked for two.
 */
export function columnsFor(width: number, height: number, pref: ReaderLayout): 1 | 2 {
  if (pref === "single") return 1;
  const landscape = width / Math.max(1, height) >= 1.15;
  if (pref === "spread") return width >= 860 && landscape ? 2 : 1;
  // 1024-wide tablets (iPad in landscape) fit two comfortable columns; leaving
  // them single left a page of empty desk on either side.
  return width >= 960 && landscape ? 2 : 1;
}

/** Paginator parameters for foliate (px / %). */
export function pageGeometry(width: number, height: number, columns: 1 | 2, margin: ReaderMargin, mobile: boolean) {
  const gapPct = { narrow: 4, medium: 6, wide: 9 }[margin] + (mobile ? 0 : 1);
  // the inline size of one page: comfortable line length for Bengali (≈ 28–34em)
  const maxInline = columns === 2 ? Math.min(600, Math.floor((width - 120) / 2)) : mobile ? width : Math.min(680, width - 80);
  // room above and below the text for the controls (when they appear) and for
  // the paper's own quiet; phones keep their full-bleed page
  const headerFooter = mobile ? 40 : Math.max(48, Math.round(height * 0.075));
  return {
    gap: `${gapPct}%`,
    maxInlineSize: `${maxInline}px`,
    maxBlockSize: `${Math.max(400, height - headerFooter * 2)}px`,
    margin: `${headerFooter}px`,
    maxColumnCount: columns,
  };
}

/**
 * The book's footprint on the stage: page proportions on desktop, full-bleed on
 * phones. The desk is breathing room, not storage: the page keeps its paper
 * proportions but grows until it is the largest book that still leaves a
 * comfortable margin for the controls and the screen's own edges.
 */
export function frameSize(width: number, height: number, columns: 1 | 2, mobile: boolean) {
  if (!width || !height) return { width: 0, height: 0 };
  if (mobile) return { width, height };
  const vPad = height > 900 ? 40 : height > 700 ? 28 : 20;
  const h = Math.max(320, height - vPad * 2);
  const side = width >= 1400 ? 64 : 32;
  const pageW = Math.min(h * 0.74, columns === 2 ? (width - side * 2) / 2 : Math.min(width - side * 2, 720));
  return { width: Math.round(pageW * columns), height: Math.round(h) };
}
