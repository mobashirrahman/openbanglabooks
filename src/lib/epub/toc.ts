/**
 * Reads an EPUB's table of contents (EPUB 3 nav document, or the EPUB 2
 * NCX as a fallback) without a DOM, for the edition record shown on the
 * book page. Only call on files that passed validateEpub.
 */
import { strFromU8, unzipSync } from "fflate";
import type { TocEntry } from "@/lib/catalog/types";

const decode = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();

/** Nested <ol>/<li>/<a> (or <span>) of a nav document, as entries. */
export function parseNav(xhtml: string): TocEntry[] {
  const nav = xhtml.match(/<nav\b[^>]*epub:type="[^"]*\btoc\b[^"]*"[^>]*>([\s\S]*?)<\/nav>/i)?.[1];
  if (!nav) return [];
  const root: TocEntry[] = [];
  const stack: TocEntry[][] = [];
  let current = root;
  let last: TocEntry | null = null;
  const token = /<(\/?)(ol|li|a|span)\b([^>]*)>([\s\S]*?)(?=<\/?(?:ol|li|a|span)\b|$)/gi;
  let depth = 0;
  for (const m of nav.matchAll(token)) {
    const [, close, tag, attrs, after] = m;
    const name = tag.toLowerCase();
    if (name === "ol") {
      if (close) {
        current = stack.pop() ?? root;
        depth--;
      } else if (depth++ > 0 && last) {
        stack.push(current);
        last.children = [];
        current = last.children;
      }
    } else if ((name === "a" || name === "span") && !close) {
      const href = attrs.match(/\bhref="([^"]*)"/)?.[1] ?? "";
      const label = decode(after);
      if (label) {
        last = { label, href: decode(href) };
        current.push(last);
      }
    }
  }
  return root;
}

/** navPoints of an NCX document, as entries. */
export function parseNcx(xml: string): TocEntry[] {
  const root: TocEntry[] = [];
  const stack: TocEntry[][] = [root];
  const token = /<(\/?)navPoint\b[^>]*>|<text>([\s\S]*?)<\/text>|<content\b[^>]*\bsrc="([^"]*)"/gi;
  let pending: TocEntry | null = null;
  for (const m of xml.matchAll(token)) {
    if (m[0].startsWith("</")) {
      stack.pop();
    } else if (m[0].startsWith("<navPoint")) {
      pending = { label: "", href: "" };
      stack[stack.length - 1].push(pending);
      pending.children = [];
      stack.push(pending.children);
    } else if (m[2] !== undefined && pending && !pending.label) {
      pending.label = decode(m[2]);
    } else if (m[3] !== undefined && pending && !pending.href) {
      pending.href = decode(m[3]);
    }
  }
  const tidy = (list: TocEntry[]): TocEntry[] =>
    list.filter((e) => e.label).map((e) => (e.children?.length ? { ...e, children: tidy(e.children) } : { label: e.label, href: e.href }));
  return tidy(root);
}

export function readToc(bytes: Uint8Array): TocEntry[] {
  const files = unzipSync(bytes, { filter: (f) => /\.(opf|xhtml|html|ncx|xml)$/i.test(f.name) });
  const container = files["META-INF/container.xml"];
  const opfPath = container ? strFromU8(container).match(/full-path="([^"]+)"/)?.[1] : undefined;
  if (!opfPath || !files[opfPath]) return [];
  const opf = strFromU8(files[opfPath]);
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const items = [...opf.matchAll(/<item\b[^>]*>/g)].map((m) => m[0]);
  const navHref = items.find((i) => /\bproperties="[^"]*\bnav\b/.test(i))?.match(/\bhref="([^"]+)"/)?.[1];
  if (navHref && files[base + decodeURIComponent(navHref)]) {
    const toc = parseNav(strFromU8(files[base + decodeURIComponent(navHref)]));
    if (toc.length) return toc;
  }
  const ncxHref = items.find((i) => /media-type="application\/x-dtbncx\+xml"/.test(i))?.match(/\bhref="([^"]+)"/)?.[1];
  if (ncxHref && files[base + decodeURIComponent(ncxHref)]) return parseNcx(strFromU8(files[base + decodeURIComponent(ncxHref)]));
  return [];
}

/** Number of entries at the deepest level that holds chapters (leaves). */
export function countChapters(toc: TocEntry[]): number {
  return toc.reduce((n, e) => n + (e.children?.length ? countChapters(e.children) : 1), 0);
}
