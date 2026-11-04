"use client";

import { compare as compareCfi } from "@foliate/epubcfi.js";
import { localDB, snapshotOf, type Annotation, type HighlightColor, type HighlightStyle, type WorkSnapshot } from "@/lib/local/db";

export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink", "purple"];
const LAST_COLOR_KEY = "obb:highlight-color";

/**
 * Highlight colours per reader theme, as CSS variables on <html>. The SVG
 * marks foliate draws live in its shadow DOM, where custom properties still
 * inherit – so switching the reader theme recolours every highlight without
 * redrawing anything. Light pages multiply (a marker on paper: the ink stays
 * black); the night page screens (the ink stays light).
 */
export const HIGHLIGHT_THEME = {
  light: {
    yellow: "#f6c945",
    green: "#79d3a1",
    blue: "#7db6f4",
    pink: "#f59bc2",
    purple: "#b99cf5",
    opacity: "0.5",
    blend: "multiply",
    underline: "#a65d4e",
  },
  dark: {
    yellow: "#d9a92a",
    green: "#3f9e72",
    blue: "#4a86cf",
    pink: "#c95f8b",
    purple: "#8a6ad6",
    opacity: "0.55",
    blend: "screen",
    underline: "#d08c7b",
  },
} as const;

/** Solid swatch colours for the UI (menus, lists, export), readable on any theme. */
export const SWATCH: Record<HighlightColor, string> = {
  yellow: "#f2c230",
  green: "#4fbf86",
  blue: "#5a9df0",
  pink: "#ee7fae",
  purple: "#a083ef",
};

export function applyHighlightTheme(root: HTMLElement, dark: boolean) {
  const t = dark ? HIGHLIGHT_THEME.dark : HIGHLIGHT_THEME.light;
  for (const c of HIGHLIGHT_COLORS) root.style.setProperty(`--hl-${c}`, t[c]);
  root.style.setProperty("--hl-opacity", t.opacity);
  root.style.setProperty("--hl-blend", t.blend);
  root.style.setProperty("--hl-underline", t.underline);
}

export type MarkStyle = { color: HighlightColor; style: HighlightStyle; note: boolean };

const SVG = "http://www.w3.org/2000/svg";

/** foliate overlayer draw function: soft marker strokes (or an underline), plus a dot when there is a note. */
export function drawMark(rects: DOMRectList | DOMRect[], { color, style, note }: MarkStyle): SVGGElement {
  const list = Array.from(rects).filter((r) => r.width > 0.5 && r.height > 0.5);
  const wrap = document.createElementNS(SVG, "g");
  const g = document.createElementNS(SVG, "g");
  wrap.append(g);
  if (style === "underline") {
    g.style.fill = "var(--hl-underline)";
    for (const r of list) g.append(rect(r.left, r.bottom - 2.5, r.width, 2, 1));
  } else {
    g.style.fill = `var(--hl-${color})`;
    // opacity on the group, so overlapping fragments never double up
    g.style.opacity = "var(--hl-opacity)";
    g.style.mixBlendMode = "var(--hl-blend)";
    for (const r of list) g.append(rect(r.left - 1.5, r.top + r.height * 0.06, r.width + 3, r.height * 0.9, 3));
  }
  const last = list.at(-1);
  if (note && last) {
    const dot = document.createElementNS(SVG, "circle");
    dot.setAttribute("cx", String(last.right + 6));
    dot.setAttribute("cy", String(last.top + 5));
    dot.setAttribute("r", "3.5");
    dot.style.fill = style === "underline" ? "var(--hl-underline)" : `var(--hl-${color})`;
    dot.style.stroke = "var(--paper)";
    dot.style.strokeWidth = "1.5";
    wrap.append(dot);
  }
  return wrap;
}

function rect(x: number, y: number, w: number, h: number, r: number) {
  const el = document.createElementNS(SVG, "rect");
  el.setAttribute("x", String(x));
  el.setAttribute("y", String(y));
  el.setAttribute("width", String(Math.max(0, w)));
  el.setAttribute("height", String(Math.max(0, h)));
  el.setAttribute("rx", String(r));
  return el;
}

/** The selected text with ~40 characters of context on each side (for re-anchoring a changed file). */
export function quoteOf(range: Range) {
  const doc = range.startContainer.ownerDocument!;
  const before = doc.createRange();
  before.setStart(doc.body, 0);
  before.setEnd(range.startContainer, range.startOffset);
  const after = doc.createRange();
  after.setStart(range.endContainer, range.endOffset);
  after.setEnd(doc.body, doc.body.childNodes.length);
  const squash = (s: string) => s.replace(/\s+/g, " ");
  return {
    quote: squash(range.toString()).trim(),
    prefix: squash(before.toString()).slice(-40),
    suffix: squash(after.toString()).slice(0, 40),
  };
}

export function lastHighlightColor(): HighlightColor {
  try {
    const v = localStorage.getItem(LAST_COLOR_KEY);
    return HIGHLIGHT_COLORS.includes(v as HighlightColor) ? (v as HighlightColor) : "yellow";
  } catch {
    return "yellow";
  }
}
export function rememberHighlightColor(c: HighlightColor) {
  try {
    localStorage.setItem(LAST_COLOR_KEY, c);
  } catch {
    /* private mode */
  }
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export async function createAnnotation(
  work: WorkSnapshot,
  fileSha: string,
  a: Pick<Annotation, "cfi" | "quote" | "prefix" | "suffix" | "color" | "style" | "chapter" | "fraction"> & { note?: string | null },
): Promise<Annotation> {
  const now = Date.now();
  const row: Annotation = {
    id: newId(),
    workSlug: work.slug,
    fileSha,
    note: null,
    ...a,
    createdAt: now,
    updatedAt: now,
    work: snapshotOf(work),
  };
  await localDB().annotations.put(row);
  return row;
}

export async function updateAnnotation(id: string, patch: Partial<Pick<Annotation, "color" | "style" | "note">>) {
  await localDB().annotations.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteAnnotation(id: string) {
  await localDB().annotations.delete(id);
}

/** Copies text, falling back to execCommand where the async clipboard needs a secure context. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

/** Reading order: by CFI (exact), falling back to the stored fraction. */
export function byPosition(a: Pick<Annotation, "cfi" | "fraction">, b: Pick<Annotation, "cfi" | "fraction">) {
  try {
    return compareCfi(a.cfi, b.cfi);
  } catch {
    return a.fraction - b.fraction;
  }
}

type ExportLabels = { title: string; exportedOn: string; note: string; chapterOf: string };

/** Markdown export, grouped by book in reading order. */
export function annotationsToMarkdown(rows: Annotation[], labels: ExportLabels, locale: string): string {
  const books = new Map<string, Annotation[]>();
  for (const r of rows) books.set(r.workSlug, [...(books.get(r.workSlug) ?? []), r]);
  const date = new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", { dateStyle: "long" }).format(new Date());
  const out = [`# ${labels.title} — OpenBanglaBooks`, "", `_${labels.exportedOn}: ${date}_`, ""];
  for (const list of books.values()) {
    const w = list[0].work;
    const author = w.authors.map((a) => a.name_bn).join(", ");
    out.push(`## ${w.title_bn}${author ? ` — ${author}` : ""}`, "");
    for (const a of [...list].sort(byPosition)) {
      out.push(...a.quote.split("\n").map((l) => `> ${l}`));
      const where = [a.chapter ? chapterText(a.chapter, labels.chapterOf) : null, `${Math.round(a.fraction * 100)}%`]
        .filter(Boolean)
        .join(", ");
      out.push(">", `> — ${where}`, "");
      if (a.note) out.push(`**${labels.note}:** ${a.note}`, "");
    }
  }
  return out.join("\n").trimEnd() + "\n";
}

const chapterText = (label: string, prefix: string) => (/^[০-৯0-9]+$/.test(label.trim()) ? `${prefix} ${label.trim()}` : label);

export function annotationsToJson(rows: Annotation[]): string {
  return JSON.stringify(
    {
      format: "openbanglabooks.annotations",
      version: 1,
      exportedAt: new Date().toISOString(),
      annotations: [...rows].sort((a, b) => a.workSlug.localeCompare(b.workSlug) || byPosition(a, b)),
    },
    null,
    2,
  );
}

/** Saves text as a file (no server round trip). */
export function downloadText(text: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("bn", { granularity: "grapheme" }) : null;

/**
 * Widens a range so it never starts or ends inside a grapheme cluster. A
 * Bengali highlight that begins on a vowel sign (া) or ends on a hasanta (্)
 * would store, and render, a broken letter.
 */
export function snapToGraphemes(range: Range): Range {
  if (!graphemes) return range;
  const snap = (node: Node, offset: number, toEnd: boolean) => {
    if (node.nodeType !== Node.TEXT_NODE) return offset;
    for (const { index, segment } of graphemes.segment(node.textContent ?? "")) {
      const end = index + segment.length;
      if (offset > index && offset < end) return toEnd ? end : index;
      if (index >= offset) break;
    }
    return offset;
  };
  const start = snap(range.startContainer, range.startOffset, false);
  const end = snap(range.endContainer, range.endOffset, true);
  range.setStart(range.startContainer, start);
  range.setEnd(range.endContainer, end);
  return range;
}

/** Search matches: a thin outline in the accent colour, distinct from a reader's own highlights. */
export function drawSearchMark(rects: DOMRectList | DOMRect[]): SVGGElement {
  const g = document.createElementNS(SVG, "g");
  g.style.fill = "none";
  g.style.stroke = "var(--hl-underline)";
  g.style.strokeWidth = "1.5";
  for (const r of Array.from(rects)) if (r.width > 0.5) g.append(rect(r.left - 1.5, r.top + r.height * 0.04, r.width + 3, r.height * 0.92, 4));
  return g;
}
