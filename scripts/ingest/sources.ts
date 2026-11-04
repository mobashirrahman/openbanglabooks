/**
 * Resolves a work's Wikisource source into an ordered list of chapters,
 * with proofreading quality and scan-index edition metadata.
 */
import { nextLink, pageQualities, parsePage, subpageLinks, type ParsedPage } from "./wikisource.ts";

export type SourceSpec =
  | { root: string; exclude?: string[] }
  | { chain: string; exclude?: string[] };

export type Chapter = {
  title: string; // full Wikisource title
  label: string; // display label (last path segment)
  /** Part heading this chapter belongs to (e.g. "প্রথম খণ্ড"), if any */
  part?: string;
  page: ParsedPage;
  qualities: number[];
};

export type ResolvedSource = {
  rootTitle: string;
  root?: ParsedPage;
  chapters: Chapter[];
  indexTitle?: string;
  index?: Record<string, string>;
};

const lastSegment = (t: string) => t.slice(t.lastIndexOf("/") + 1);

export async function resolveSource(spec: SourceSpec): Promise<ResolvedSource> {
  const exclude = new Set(spec.exclude ?? []);
  let titles: string[];
  let root: ParsedPage | undefined;
  let rootTitle: string;
  if ("root" in spec) {
    root = await parsePage(spec.root);
    rootTitle = root.title;
    titles = subpageLinks(root.html, root.title);
  } else {
    rootTitle = spec.chain.split("/")[0];
    titles = [];
    let t: string | null = spec.chain;
    while (t && titles.length < 500 && !titles.includes(t)) {
      titles.push(t);
      t = nextLink((await parsePage(t)).html);
    }
  }
  titles = titles.filter((t) => !exclude.has(lastSegment(t)) && !exclude.has(t));

  // A linked subpage that has its own subpages is a part heading, not content.
  const parents = new Set(titles.filter((t) => titles.some((o) => o !== t && o.startsWith(t + "/"))));
  const chapters: Chapter[] = [];
  for (const title of titles) {
    if (parents.has(title)) continue;
    const page = await parsePage(title);
    const rel = title.slice(rootTitle.length + 1);
    const segments = rel.split("/");
    chapters.push({
      title: page.title,
      label: segments[segments.length - 1],
      part: segments.length > 1 ? segments[segments.length - 2] : undefined,
      page,
      qualities: pageQualities(page.html),
    });
  }

  const firstScan = (root?.html ?? chapters[0]?.page.html ?? "").match(/data-page-name="পাতা:([^"/]+)\//)?.[1]
    ?? chapters.map((c) => c.page.html.match(/data-page-name="পাতা:([^"/]+)\//)?.[1]).find(Boolean);
  const indexTitle = firstScan ? `নির্ঘণ্ট:${firstScan}` : undefined;
  let index: Record<string, string> | undefined;
  if (indexTitle) {
    try {
      index = indexFields((await parsePage(indexTitle)).html);
    } catch {
      index = undefined;
    }
  }
  return { rootTitle, root, chapters, indexTitle, index };
}

/** Extracts labelled fields (নাম, লেখক, প্রকাশক, প্রকাশসাল…) from an index page. */
function indexFields(html: string): Record<string, string> {
  const text = (s: string) =>
    s.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&#160;|&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  const out: Record<string, string> = {};
  for (const m of html.matchAll(/<tr[^>]*>\s*<t[hd][^>]*>([\s\S]*?)<\/t[hd]>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
    const k = text(m[1]);
    const v = text(m[2]);
    if (k && v && k.length < 30) out[k] = v;
  }
  return out;
}

export function qualitySummary(chapters: Chapter[]) {
  const all = chapters.flatMap((c) => c.qualities);
  const counts: Record<number, number> = {};
  for (const q of all) counts[q] = (counts[q] ?? 0) + 1;
  const proofread = all.filter((q) => q >= 3).length;
  return { pages: all.length, counts, proofreadShare: all.length ? proofread / all.length : 0 };
}
