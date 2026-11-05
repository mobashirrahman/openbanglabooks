import { coverage, likeness, skeletons } from "./phonetic";

/**
 * Finding a Goodreads book in our catalogue. Goodreads has none of our
 * ids and our public-domain editions have no ISBNs, so a book is found by
 * its title and author, compared as phonetic skeletons (./phonetic): the
 * same book spelt "Debdas" there and দেবদাস here still agrees.
 *
 * Each book gets a verdict: "match" (one book agrees on title and author),
 * "maybe" (something is close, or several are: the reader decides) or
 * "none". Nothing is added to the library until the reader has looked.
 */

export type MatchWork = {
  slug: string;
  title_bn: string;
  title_en: string | null;
  /** romanised spellings and other titles, space-separated */
  title_latn: string | null;
  authors: { name_bn: string; name_en: string | null }[];
};

export type Verdict = "match" | "maybe" | "none";
export type Candidate = { slug: string; score: number; title: number; author: number | null };
export type Match = { verdict: Verdict; slug: string | null; candidates: Candidate[] };

const STOP = new Set([
  "the", "a", "an", "of", "and", "part", "vol", "volume", "book", "edition", "complete",
  "one", "two", "three", "first", "second", "third", "i", "ii", "iii",
  "khanda", "khondo", "porbo", "parba", "খণ্ড", "পর্ব", "ভাগ", "প্রথম", "দ্বিতীয়",
]);

/** A title without the parts editions disagree on: "(Part One)", "[Bengali]", ": a novel". */
const titleOnly = (t: string) =>
  t
    .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
    .split(/\s[:–—-]\s|:\s/)[0]
    .trim();

type Entry = { slug: string; titles: string[][]; bag: Set<string>; authors: string[][] };

/** SymSpell-style keys: a word, and the word with any one letter left out, so near spellings meet. */
function keys(w: string): string[] {
  if (w.length < 4) return [w];
  const out = [w];
  for (let i = 0; i < w.length; i++) out.push(w.slice(0, i) + w.slice(i + 1));
  return out;
}

export class MatchIndex {
  private entries: Entry[] = [];
  private byKey = new Map<string, Set<number>>();
  readonly slugs = new Set<string>();

  constructor(works: MatchWork[]) {
    for (const w of works) {
      const titles = [titleOnly(w.title_bn), w.title_bn, ...(w.title_en ? [titleOnly(w.title_en), w.title_en] : [])]
        .map((t) => skeletons(t, STOP))
        .filter((t) => t.length);
      const bag = new Set([...titles.flat(), ...skeletons(w.title_latn ?? "", STOP)]);
      const authors = w.authors.flatMap((a) => [skeletons(a.name_bn), ...(a.name_en ? [skeletons(a.name_en)] : [])]).filter((a) => a.length);
      const i = this.entries.push({ slug: w.slug, titles, bag, authors }) - 1;
      this.slugs.add(w.slug);
      for (const word of [...bag, ...titles.map((t) => t.join(""))])
        for (const k of keys(word)) {
          let set = this.byKey.get(k);
          if (!set) this.byKey.set(k, (set = new Set()));
          set.add(i);
        }
    }
  }

  /** Scores one book against the catalogue. */
  match(book: { title: string; author?: string | null; additionalAuthors?: string[] }): Match {
    const full = skeletons(book.title, STOP);
    const main = skeletons(titleOnly(book.title), STOP);
    const queries = [main, full].filter((q) => q.length);
    if (!queries.length) return { verdict: "none", slug: null, candidates: [] };
    const people = [book.author ?? "", ...(book.additionalAuthors ?? [])].map((a) => skeletons(a)).filter((a) => a.length);

    const hits = new Set<number>();
    for (const q of queries)
      for (const word of [...q, q.join("")])
        for (const k of keys(word)) for (const i of this.byKey.get(k) ?? []) hits.add(i);

    const candidates: Candidate[] = [];
    for (const i of hits) {
      const e = this.entries[i];
      let title = 0;
      for (const q of queries) {
        for (const t of e.titles) title = Math.max(title, likeness(q, t));
        // other titles (translations, alternative spellings) are words in a bag: weigh them a little lower
        title = Math.max(title, coverage(q, e.bag) * (q.length >= 2 ? 0.9 : 0.7));
      }
      let author: number | null = null;
      if (people.length) {
        author = 0;
        for (const p of people) for (const a of e.authors) author = Math.max(author, likeness(p, a));
      }
      const score = author === null ? title : 0.65 * title + 0.35 * author;
      if (score >= 0.4) candidates.push({ slug: e.slug, score, title, author });
    }
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 5);

    const sure = top.filter((c) => c.title >= 0.85 && (c.author === null ? c.title >= 0.95 : c.author >= 0.75));
    if (sure.length === 1) return { verdict: "match", slug: sure[0].slug, candidates: top };
    if (sure.length > 1 || top.some((c) => c.title >= 0.6 || (c.title >= 0.45 && (c.author ?? 0) >= 0.75)))
      return { verdict: "maybe", slug: null, candidates: top };
    return { verdict: "none", slug: null, candidates: top };
  }
}

/** Matches many books without holding up the page: a pause every few hundred. */
export async function matchAll<T extends { title: string; author?: string | null; additionalAuthors?: string[]; ourId?: string | null }>(
  index: MatchIndex,
  books: T[],
  onProgress?: (done: number) => void,
): Promise<Match[]> {
  const out: Match[] = [];
  for (let i = 0; i < books.length; i++) {
    const b = books[i];
    // a file we wrote names the book itself
    if (b.ourId && index.slugs.has(b.ourId)) out.push({ verdict: "match", slug: b.ourId, candidates: [{ slug: b.ourId, score: 1, title: 1, author: null }] });
    else out.push(index.match(b));
    if (i % 200 === 199) {
      onProgress?.(i + 1);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(books.length);
  return out;
}
