/**
 * Minimal, polite MediaWiki client for Bengali Wikisource.
 * - identifies itself with a descriptive User-Agent (no personal contact data)
 * - serialises requests with a delay and honours `maxlag`
 * - caches parsed pages on disk (.cache/wikisource) keyed by title
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const API = "https://bn.wikisource.org/w/api.php";
export const WIKI_BASE = "https://bn.wikisource.org/wiki/";
const USER_AGENT = "OpenBanglaBooks-ingest/0.1 (+https://openbanglabooks.com)";
const DELAY_MS = 400;
const cacheDir = resolve(import.meta.dirname, "../../.cache/wikisource");

export type ParsedPage = {
  title: string;
  revid: number;
  html: string;
};

let last = 0;
async function throttle() {
  const wait = last + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
}

async function api(params: Record<string, string>): Promise<unknown> {
  const url = new URL(API);
  for (const [k, v] of Object.entries({ ...params, format: "json", formatversion: "2", maxlag: "5" }))
    url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 4; attempt++) {
    await throttle();
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, "Api-User-Agent": USER_AGENT } });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      continue;
    }
    const json = (await res.json()) as { error?: { code: string; info: string } };
    if (json.error?.code === "maxlag") {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    if (json.error) throw new Error(`Wikisource API error for ${url.search}: ${json.error.info}`);
    return json;
  }
  throw new Error(`Wikisource API failed repeatedly: ${url.search}`);
}

export const titleUrl = (title: string) => WIKI_BASE + encodeURIComponent(title.replace(/ /g, "_"));

export async function parsePage(title: string, { refresh = false } = {}): Promise<ParsedPage> {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, createHash("sha1").update(title).digest("hex") + ".json");
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8")) as ParsedPage;
  const json = (await api({ action: "parse", page: title, prop: "text|revid", redirects: "1" })) as {
    parse: { title: string; revid: number; text: string };
  };
  const page = { title: json.parse.title, revid: json.parse.revid, html: json.parse.text };
  writeFileSync(file, JSON.stringify(page));
  return page;
}

/** Proofread quality of every transcluded scan page (0 empty … 4 validated). */
export function pageQualities(html: string): number[] {
  return [...html.matchAll(/data-page-quality="(\d)"/g)].map((m) => Number(m[1]));
}

/** Titles of subpages linked from a root page, in document order. */
export function subpageLinks(html: string, root: string): string[] {
  const prefix = root.replace(/ /g, "_") + "/";
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(/href="\/wiki\/([^"#?]+)"/g)) {
    const t = decodeURIComponent(m[1]);
    if (!t.startsWith(prefix)) continue;
    const title = t.replace(/_/g, " ");
    if (!seen.has(title)) {
      seen.add(title);
      out.push(title);
    }
  }
  return out;
}

/** Follows the "next" link in the header/footer navigation template. */
export function nextLink(html: string): string | null {
  const block =
    html.match(/class="footertemplate-next"[^>]*>([\s\S]*?)<\/div>/)?.[1] ??
    html.match(/id="headernext"[^>]*>([\s\S]*?)<\/(?:div|span)>/)?.[1];
  const href = block?.match(/href="\/wiki\/([^"#?]+)"/)?.[1];
  return href ? decodeURIComponent(href).replace(/_/g, " ") : null;
}
