"use client";

/**
 * Adapter around foliate-js (vendor/foliate-js, pinned). The rest of the app
 * talks only to this module, so the unstable upstream API is contained here.
 */
import { drawMark, drawSearchMark, snapToGraphemes, type MarkStyle } from "./annotations";
import { findInDocument, normalizeQuery } from "./book-search";
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
  /** characters of text after this page: the rest of the chapter, and (estimated) of the book */
  charsLeft: { chapter: number; book: number } | null;
  reason: string | null;
};

type FoliateView = HTMLElement & {
  book: {
    toc?: TocItem[];
    sections: { linear?: string; size?: number; createDocument?: () => Promise<Document> }[];
    metadata?: { title?: unknown };
  };
  renderer: HTMLElement & {
    next(): Promise<void>;
    prev(): Promise<void>;
    setStyles(css: string | [string, string]): void;
    page: number;
    pages: number;
    atStart: boolean;
    atEnd: boolean;
    getContents(): { doc: Document; index: number; overlayer?: { hitTest(p: { x: number; y: number }): [string?, Range?] } }[];
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
  addAnnotation(a: { value: string }, remove?: boolean): Promise<unknown>;
  deleteAnnotation(a: { value: string }): Promise<unknown>;
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
  /** a highlight was tapped */
  onShowMark?: (cfi: string) => void;
};

export type SearchHit = { cfi: string; excerpt: { pre: string; match: string; post: string } };
export type SearchEvent =
  | { kind: "progress"; progress: number }
  | { kind: "results"; label: string; hits: SearchHit[] }
  | { kind: "done" };

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
  /**
   * Highlights to draw, keyed by range CFI. Marks are drawn in every rendered
   * section and redrawn whenever a section (re)loads.
   */
  setMarks(marks: Map<string, MarkStyle>): void;
  /** The current non-empty text selection inside the book, if any. */
  selection(): { range: Range; cfi: string; doc: Document } | null;
  /** On-screen rectangles (viewport coordinates) of a range: first and last visible line. */
  screenRects(range: Range): { first: DOMRect; last: DOMRect } | null;
  /**
   * Searches the whole book, chapter by chapter. Bengali-aware: matching
   * ignores zero-width joiners and treats canonically equivalent spellings
   * (য় as one code point or two) as equal, but vowel signs always count.
   * Matches are outlined in the text; `clearSearch` removes them.
   */
  search(query: string): AsyncGenerator<SearchEvent>;
  clearSearch(): void;
  /** True when a point (in a section document's coordinates) lands on a highlight. */
  hitsMark(doc: Document, x: number, y: number): boolean;
  /** Takes over touches on the book (page-curl drags), or gives them back to foliate (null). */
  setTouchHandler(h: TouchHandler | null): void;
  element: HTMLElement;
  destroy(): void;
};

export type TouchPhase = "start" | "move" | "end";
/** Receives every touch on the book in page-viewport coordinates; returns true to keep it from foliate. */
export type TouchHandler = (phase: TouchPhase, point: { x: number; y: number }, e: TouchEvent) => boolean;

/**
 * Routes touches on the book (in capture phase, before foliate's own listeners).
 *
 * - With a handler (the page-curl mode), the handler decides; what it takes,
 *   foliate never sees, so foliate's own swipe never runs.
 * - Otherwise: foliate snaps the page into place on every `touchend` – after a
 *   swipe, but also after a tap that never scrolled anything. That snap runs
 *   alongside the page turn the same tap triggers; when it finishes last it
 *   pulls the page back and the tap is lost. A touch that never moved needs
 *   no snapping, so its `touchend` is kept from foliate. Swipes pass through.
 */
function routeTouches(target: EventTarget, handler: () => TouchHandler | null) {
  let moved = false;
  // touches inside a section iframe report iframe coordinates
  const pointOf = (e: TouchEvent) => {
    const t = e.changedTouches[0];
    const frame = (target as Window).frameElement as HTMLElement | null | undefined;
    const off = frame ? frame.getBoundingClientRect() : { left: 0, top: 0 };
    return { x: (t?.clientX ?? 0) + off.left, y: (t?.clientY ?? 0) + off.top };
  };
  target.addEventListener(
    "touchstart",
    (e) => {
      moved = false;
      if (handler()?.("start", pointOf(e as TouchEvent), e as TouchEvent)) e.stopPropagation();
    },
    { capture: true, passive: true },
  );
  target.addEventListener(
    "touchmove",
    (e) => {
      moved = true;
      // (a handler dragging the page calls preventDefault itself; a text selection must stay native)
      if (handler()?.("move", pointOf(e as TouchEvent), e as TouchEvent)) e.stopPropagation();
    },
    { capture: true, passive: false },
  );
  for (const type of ["touchend", "touchcancel"])
    target.addEventListener(
      type,
      (e) => {
        const taken = handler()?.("end", pointOf(e as TouchEvent), e as TouchEvent);
        if (taken || !moved) e.stopPropagation();
      },
      { capture: true, passive: true },
    );
}

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
  let touchHandler: TouchHandler | null = null;
  routeTouches(view, () => touchHandler); // the page margins (foliate's shadow DOM)
  container.append(view);

  // characters per byte of section markup, learnt from opened chapters (Bengali UTF-8 is ~3 bytes a letter)
  const sectionChars = new Map<number, number>();
  const charsPerByte = () => {
    let chars = 0;
    let bytes = 0;
    for (const [i, c] of sectionChars) {
      const size = book.sections[i]?.size ?? 0;
      if (c > 1500 && size) {
        chars += c;
        bytes += size;
      }
    }
    return bytes ? chars / bytes : 0.28;
  };
  const textLength = (r: Range) => r.toString().replace(/\s+/g, " ").trim().length;
  /**
   * Characters of text after `range`: exact for the rest of its chapter, an
   * estimate for the rest of the book (from chapter sizes, using the
   * characters-per-byte ratio of chapters already opened).
   */
  const textLeft = (range: Range, index: number): { chapter: number; book: number } | null => {
    const doc = range.endContainer.ownerDocument;
    const body = doc?.body;
    if (!doc || !body) return null;
    // only from the document actually rendered for that section (not a stale one mid-transition)
    if (!view.renderer.getContents().some((c) => c.index === index && c.doc === doc)) return null;
    try {
      if (!sectionChars.has(index)) {
        const all = doc.createRange();
        all.selectNodeContents(body);
        const chars = textLength(all);
        const size = book.sections[index]?.size ?? 0;
        // text can never outweigh its own UTF-8 bytes plus markup: anything else is a bad sample
        if (!size || chars / size < 0.6) sectionChars.set(index, chars);
      }
      const after = doc.createRange();
      after.setStart(range.endContainer, range.endOffset);
      after.setEnd(body, body.childNodes.length);
      const chapter = textLength(after);
      let restBytes = 0;
      for (let i = index + 1; i < book.sections.length; i++)
        if (book.sections[i].linear !== "no") restBytes += book.sections[i].size ?? 0;
      return { chapter, book: chapter + Math.round(restBytes * charsPerByte()) };
    } catch {
      return null;
    }
  };

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
      charsLeft: d.range && d.section ? textLeft(d.range, d.section.current) : null,
    });
  });
  view.addEventListener("load", (e) => {
    const { doc, index } = (e as CustomEvent<{ doc: Document; index: number }>).detail;
    if (doc.defaultView) routeTouches(doc.defaultView, () => touchHandler); // the text (section iframe)
    callbacks.onLoad?.(doc, index);
  });
  view.addEventListener("external-link", (e) => {
    const { a, href_ } = (e as CustomEvent<{ a: HTMLAnchorElement; href_: string }>).detail;
    e.preventDefault(); // never open from inside the book automatically
    callbacks.onExternalLink?.(href_ ?? a.href);
  });

  // ── highlights ─────────────────────────────────────────────────────────────
  let marks = new Map<string, MarkStyle>();
  // search matches, outlined until the search changes (highlights win where both exist)
  const searchMarks = new Set<string>();
  const sectionOf = (cfi: string) => {
    try {
      return view.resolveNavigation(cfi)?.index ?? -1;
    } catch {
      return -1;
    }
  };
  view.addEventListener("draw-annotation", (e) => {
    type Draw = <O>(f: (rects: DOMRectList, options: O) => SVGElement, options: O) => void;
    const { draw, annotation } = (e as CustomEvent<{ draw: Draw; annotation: { value: string } }>).detail;
    const mark = marks.get(annotation.value);
    if (mark) draw(drawMark, mark);
    else if (searchMarks.has(annotation.value)) draw(drawSearchMark, undefined);
  });
  // a section was (re)rendered: draw the marks that belong to it
  view.addEventListener("create-overlay", (e) => {
    const { index } = (e as CustomEvent<{ index: number }>).detail;
    for (const cfi of new Set([...marks.keys(), ...searchMarks])) if (sectionOf(cfi) === index) void view.addAnnotation({ value: cfi });
  });
  view.addEventListener("show-annotation", (e) => {
    const { value } = (e as CustomEvent<{ value: string }>).detail;
    if (marks.has(value)) callbacks.onShowMark?.(value);
  });

  await view.open(book);
  const r = view.renderer;
  r.setAttribute("exportparts", "head,foot,filter");


  const clearSearchMarks = () => {
    const old = [...searchMarks];
    searchMarks.clear();
    // a highlight on the same text is drawn again; everything else goes
    for (const cfi of old) void (marks.has(cfi) ? view.addAnnotation({ value: cfi }) : view.deleteAnnotation({ value: cfi }));
  };
  // the chapter name for each section (sections without their own entry inherit the previous one)
  let labelCache: string[] | null = null;
  const sectionLabels = () => {
    if (labelCache) return labelCache;
    const bySection = new Map<number, string>();
    const walk = (items: TocItem[]) => {
      for (const it of items) {
        try {
          const i = view.resolveNavigation(it.href)?.index;
          if (i != null && !bySection.has(i)) bySection.set(i, it.label?.trim() ?? "");
        } catch {
          /* unresolvable entry */
        }
        if (it.subitems?.length) walk(it.subitems);
      }
    };
    walk(book.toc ?? []);
    let last = "";
    labelCache = book.sections.map((_, i) => (last = bySection.get(i) ?? last));
    return labelCache;
  };

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
        // not `instanceof Range`: the range comes from the section iframe, whose Range is a different constructor
        if (a && "startContainer" in a) return a as Range;
        const range = content.doc.createRange();
        range.selectNode(a as Node);
        return range;
      } catch {
        return null;
      }
    },
    setMarks: (next) => {
      const prev = marks;
      marks = new Map(next);
      for (const cfi of prev.keys()) if (!marks.has(cfi)) void view.deleteAnnotation({ value: cfi });
      for (const [cfi, m] of marks) {
        const old = prev.get(cfi);
        if (!old || old.color !== m.color || old.style !== m.style || old.note !== m.note) void view.addAnnotation({ value: cfi });
      }
    },
    selection: () => {
      for (const c of r.getContents()) {
        const sel = c.doc.getSelection();
        if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim()) continue;
        // a copy (the selection's own range is live), widened to whole letters
        const range = snapToGraphemes(sel.getRangeAt(0).cloneRange());
        try {
          return { range, doc: c.doc, cfi: view.getCFI(c.index, range) };
        } catch {
          return null;
        }
      }
      return null;
    },
    screenRects: (range) => {
      const frame = range.startContainer.ownerDocument?.defaultView?.frameElement as HTMLElement | null;
      if (!frame) return null;
      const f = frame.getBoundingClientRect();
      // in paginated mode a range can run across columns that are off screen
      const rects = Array.from(range.getClientRects())
        .map((x) => new DOMRect(x.left + f.left, x.top + f.top, x.width, x.height))
        .filter((x) => x.width > 0 && x.right > 0 && x.left < window.innerWidth && x.bottom > 0 && x.top < window.innerHeight);
      if (!rects.length) return null;
      return { first: rects[0], last: rects[rects.length - 1] };
    },
    async *search(query) {
      clearSearchMarks();
      const needle = normalizeQuery(query);
      if (!needle) return;
      const labels = sectionLabels();
      const { sections } = book;
      for (let index = 0; index < sections.length; index++) {
        const section = sections[index];
        if (section.createDocument && section.linear !== "no") {
          let doc: Document | null = null;
          try {
            doc = await section.createDocument();
          } catch {
            doc = null; // an unreadable chapter: search the rest
          }
          const found = doc ? findInDocument(doc, needle) : [];
          if (found.length) {
            const hits = found.map((f) => ({ cfi: view.getCFI(index, f.range), excerpt: f.excerpt }));
            for (const h of hits) {
              searchMarks.add(h.cfi);
              void view.addAnnotation({ value: h.cfi });
            }
            yield { kind: "results", label: labels[index] ?? "", hits };
          }
        }
        yield { kind: "progress", progress: (index + 1) / sections.length };
      }
      yield { kind: "done" };
    },
    clearSearch: () => clearSearchMarks(),
    setTouchHandler: (h) => {
      touchHandler = h;
    },
    hitsMark: (doc, x, y) => {
      const c = r.getContents().find((c) => c.doc === doc);
      const [value] = c?.overlayer?.hitTest({ x, y }) ?? [];
      return Boolean(value && marks.has(value));
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
