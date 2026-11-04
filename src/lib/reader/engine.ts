"use client";

/**
 * Adapter around foliate-js (vendor/foliate-js, pinned). The rest of the app
 * talks only to this module, so the unstable upstream API is contained here.
 */
import { makeLoader } from "./epub-loader";
import { sanitizeSection } from "./styles";

export type TocItem = { label: string; href: string; subitems?: TocItem[] };

/** Bare numerals ("১", "12") read better as "অধ্যায় ১" / "Chapter 12". */
export function chapterLabel(label: string | null | undefined, prefix: string): string | null {
  if (!label) return null;
  return /^[০-৯0-9]+$/.test(label.trim()) ? `${prefix} ${label.trim()}` : label;
}

export type Relocation = {
  cfi: string;
  /** progress through the whole book, 0–1 */
  fraction: number;
  sectionIndex: number;
  sectionCount: number;
  tocLabel: string | null;
  tocHref: string | null;
  /** page (or spread) within the current section, 1-based */
  page: number;
  pages: number;
  atStart: boolean;
  atEnd: boolean;
  /** visible text range, for bookmarks and excerpts */
  range: Range | null;
  reason: string | null;
};

type FoliateView = HTMLElement & {
  book: { toc?: TocItem[]; sections: { linear?: string }[]; metadata?: { title?: unknown } };
  renderer: HTMLElement & {
    next(): Promise<void>;
    prev(): Promise<void>;
    setStyles(css: string | [string, string]): void;
    page: number;
    pages: number;
    atStart: boolean;
    atEnd: boolean;
    getContents(): { doc: Document; index: number }[];
  };
  lastLocation?: { cfi: string; range?: Range };
  open(book: unknown): Promise<void>;
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number): Promise<unknown>;
  goToFraction(f: number): Promise<void>;
  next(): Promise<void>;
  prev(): Promise<void>;
  close(): void;
  getSectionFractions(): number[];
  resolveNavigation(target: string): { index: number; anchor: (doc: Document) => Range | Node } | undefined;
  getCFI(index: number, range?: Range): string;
};

/**
 * A one-character range at the first visible letter of `range`. Foliate's
 * visible-range CFI often starts on an element boundary (before a paragraph
 * that began on an earlier page); anchoring to it re-opens on that earlier
 * page. A point at the first visible character is exact.
 */
function firstCharRange(range: Range): Range | null {
  const doc = range.startContainer.ownerDocument;
  if (!doc) return null;
  const root = range.commonAncestorContainer;
  const walker = doc.createTreeWalker(root.nodeType === 3 ? root.parentNode! : root, NodeFilter.SHOW_TEXT);
  let node: Node | null = range.startContainer.nodeType === 3 ? range.startContainer : walker.nextNode();
  if (range.startContainer.nodeType === 3) walker.currentNode = range.startContainer;
  while (node) {
    if (range.intersectsNode(node)) {
      const text = node.textContent ?? "";
      let i = node === range.startContainer ? range.startOffset : 0;
      while (i < text.length && /\s/.test(text[i])) i++;
      if (i < text.length) {
        const r = doc.createRange();
        r.setStart(node, i);
        r.setEnd(node, Math.min(text.length, i + 1));
        return r;
      }
    }
    node = walker.nextNode();
  }
  return null;
}

export type EngineCallbacks = {
  onRelocate: (r: Relocation) => void;
  onLoad?: (doc: Document, index: number) => void;
  onExternalLink?: (href: string) => void;
};

export type Engine = {
  toc: TocItem[];
  sectionFractions: number[];
  next(): Promise<void>;
  prev(): Promise<void>;
  goTo(target: string): Promise<void>;
  goToFraction(f: number): Promise<void>;
  setStyles(css: string): void;
  setLayout(opts: {
    flow: "paginated" | "scrolled";
    gap: string;
    margin: string;
    maxInlineSize: string;
    maxBlockSize: string;
    maxColumnCount: number;
    animated: boolean;
  }): void;
  /** Visible documents (one per rendered section) */
  contents(): { doc: Document; index: number }[];
  /** Resolves a CFI to a DOM range if its section is currently rendered */
  rangeFor(cfi: string): Range | null;
  element: HTMLElement;
  destroy(): void;
};

let foliateLoaded: Promise<unknown> | null = null;
function loadFoliate() {
  foliateLoaded ??= import("@foliate/view.js");
  return foliateLoaded;
}

export async function createEngine(
  container: HTMLElement,
  bytes: Uint8Array,
  { initialCfi, initialHref }: { initialCfi?: string | null; initialHref?: string | null },
  callbacks: EngineCallbacks,
): Promise<Engine & { start(): Promise<void> }> {
  const [, loader, epubModule] = await Promise.all([
    loadFoliate(),
    makeLoader(bytes),
    import("@foliate/epub.js") as Promise<{ EPUB: new (l: unknown) => { init(): Promise<unknown> } }>,
  ]);
  const book = (await new epubModule.EPUB(loader).init()) as FoliateView["book"] & {
    transformTarget?: EventTarget;
  };

  // Defence in depth: strip active content from section markup before it is rendered.
  book.transformTarget?.addEventListener("data", (e) => {
    const detail = (e as CustomEvent<{ type: string; data: unknown }>).detail;
    if (/x?html/.test(detail.type)) detail.data = Promise.resolve(detail.data).then((d) => (typeof d === "string" ? sanitizeSection(d) : d));
  });

  const view = document.createElement("foliate-view") as FoliateView;
  view.style.cssText = "display:block;width:100%;height:100%";
  container.append(view);

  view.addEventListener("relocate", (e) => {
    const d = (e as CustomEvent).detail as {
      cfi: string;
      fraction: number;
      section?: { current: number; total: number };
      tocItem?: { label?: string; href?: string };
      range?: Range;
      reason?: string;
    };
    const r = view.renderer;
    // foliate renders a blank page before and after each section
    const pages = Math.max(1, (r.pages ?? 3) - 2);
    const page = Math.min(pages, Math.max(1, r.page ?? 1));
    let cfi = d.cfi;
    if (d.range && d.section) {
      const point = firstCharRange(d.range);
      if (point) {
        try {
          cfi = view.getCFI(d.section.current, point);
        } catch {
          /* keep the range CFI */
        }
      }
    }
    callbacks.onRelocate({
      cfi,
      fraction: Number.isFinite(d.fraction) ? Math.min(1, Math.max(0, d.fraction)) : 0,
      sectionIndex: d.section?.current ?? 0,
      sectionCount: d.section?.total ?? book.sections.length,
      tocLabel: d.tocItem?.label?.trim() ?? null,
      tocHref: d.tocItem?.href ?? null,
      page,
      pages,
      atStart: r.atStart,
      atEnd: r.atEnd,
      range: d.range ?? null,
      reason: d.reason ?? null,
    });
  });
  view.addEventListener("load", (e) => {
    const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
    callbacks.onLoad?.(doc, index);
  });
  view.addEventListener("external-link", (e) => {
    const { a, href_ } = (e as CustomEvent<{ a: HTMLAnchorElement; href_: string }>).detail;
    e.preventDefault(); // never open from inside the book automatically
    callbacks.onExternalLink?.(href_ ?? a.href);
  });

  await view.open(book);
  const r = view.renderer;
  r.setAttribute("exportparts", "head,foot,filter");

  const engine: Engine = {
    toc: (book.toc ?? []) as TocItem[],
    sectionFractions: view.getSectionFractions(),
    next: () => view.next(),
    prev: () => view.prev(),
    goTo: async (target) => {
      await view.goTo(target);
    },
    goToFraction: (f) => view.goToFraction(Math.min(0.9999, Math.max(0, f))),
    setStyles: (css) => r.setStyles(css),
    setLayout: (o) => {
      r.setAttribute("flow", o.flow);
      r.setAttribute("gap", o.gap);
      r.setAttribute("margin", o.margin);
      r.setAttribute("max-inline-size", o.maxInlineSize);
      r.setAttribute("max-block-size", o.maxBlockSize);
      r.setAttribute("max-column-count", String(o.maxColumnCount));
      r.toggleAttribute("animated", o.animated);
    },
    contents: () => r.getContents(),
    rangeFor: (cfi) => {
      try {
        const resolved = view.resolveNavigation(cfi);
        if (!resolved) return null;
        const content = r.getContents().find((c) => c.index === resolved.index);
        if (!content) return null;
        const a = resolved.anchor(content.doc);
        if (a instanceof Range) return a;
        const range = content.doc.createRange();
        range.selectNode(a as Node);
        return range;
      } catch {
        return null;
      }
    },
    element: view,
    destroy: () => {
      try {
        view.close();
      } catch {
        /* already closed */
      }
      view.remove();
    },
  };

  return Object.assign(engine, {
    async start() {
      // a fresh book opens on its title page, like a physical book
      await view.init({ lastLocation: initialCfi ?? null, showTextStart: false });
      if (initialHref && !initialCfi) await view.goTo(initialHref);
    },
  });
}
