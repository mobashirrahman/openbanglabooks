/**
 * Bengali-aware text search over a book's section documents.
 *
 * Text is compared in a normalised form: canonically decomposed (so য় written
 * as one code point or as য + ় is the same), without zero-width joiners (a
 * ZWNJ that only changes how a conjunct is drawn never decides a match), and
 * lower-cased (for Latin text). Vowel signs and hasanta always count. Every
 * normalised character remembers where it came from, so matches map back to
 * exact DOM positions (and from there to CFIs).
 */

const JOINERS = /[‌‍]/;
const CONTEXT = 48;

/** Where a normalised character came from: segment (text node) index, offset, and length in the original. */
type Origin = { seg: number; offset: number; len: number; display: number };
export type Haystack = { text: string; origin: Origin[]; display: string };
export type Loc = { seg: number; offset: number };
export type Match = { start: Loc; end: Loc; excerpt: { pre: string; match: string; post: string } };

export function normalizeQuery(q: string): string {
  let out = "";
  for (const ch of q.normalize("NFD")) if (!JOINERS.test(ch)) out += ch.toLowerCase();
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Builds the searchable text from text segments (in document order).
 * `breakBefore[i]` puts a space before segment i (a new paragraph or heading),
 * so words in neighbouring blocks never run together.
 */
export function buildHaystack(segments: string[], breakBefore: boolean[] = []): Haystack {
  let text = "";
  let display = "";
  const origin: Origin[] = [];
  let lastSpace = true;
  segments.forEach((seg, i) => {
    if (breakBefore[i] && !lastSpace) {
      text += " ";
      origin.push({ seg: i, offset: 0, len: 0, display: display.length });
      display += " ";
      lastSpace = true;
    }
    let offset = 0;
    for (const ch of seg) {
      const len = ch.length;
      const at = display.length;
      if (/\s/.test(ch)) {
        // runs of whitespace (including line breaks in the markup) count as one space
        if (!lastSpace) {
          text += " ";
          origin.push({ seg: i, offset, len, display: at });
          display += " ";
        }
        lastSpace = true;
      } else {
        display += ch;
        if (!JOINERS.test(ch)) {
          for (const d of ch.normalize("NFD")) {
            const lower = d.toLowerCase();
            for (const c of lower) {
              text += c;
              origin.push({ seg: i, offset, len, display: at });
            }
          }
        }
        lastSpace = false;
      }
      offset += len;
    }
  });
  return { text, origin, display };
}

export function findAll(hay: Haystack, needle: string, limit = Infinity): Match[] {
  const out: Match[] = [];
  if (!needle) return out;
  let from = 0;
  while (out.length < limit) {
    const i = hay.text.indexOf(needle, from);
    if (i < 0) break;
    from = i + 1;
    const a = hay.origin[i];
    const b = hay.origin[i + needle.length - 1];
    // a match never starts or ends on a separator between blocks
    if (!a.len || !b.len) continue;
    const ds = a.display;
    const de = b.display + b.len;
    const squash = (s: string) => s.replace(/\s+/g, " ");
    const pre = squash(hay.display.slice(Math.max(0, ds - CONTEXT), ds)).trimStart();
    const post = squash(hay.display.slice(de, de + CONTEXT)).trimEnd();
    out.push({
      start: { seg: a.seg, offset: a.offset },
      end: { seg: b.seg, offset: b.offset + b.len },
      excerpt: {
        pre: (ds > CONTEXT ? "…" : "") + pre,
        match: hay.display.slice(ds, de),
        post: post + (de + CONTEXT < hay.display.length ? "…" : ""),
      },
    });
  }
  return out;
}

const BLOCK = "p,h1,h2,h3,h4,h5,h6,li,dt,dd,blockquote,div,td,th,pre,figcaption,section";

/** Finds every match in a document, as DOM ranges with excerpts. */
export function findInDocument(doc: Document, needle: string, limit = Infinity): { range: Range; excerpt: Match["excerpt"] }[] {
  const body = doc.body ?? doc.documentElement;
  if (!body) return [];
  const nodes: Text[] = [];
  const breaks: boolean[] = [];
  const walker = doc.createTreeWalker(body, 4 /* NodeFilter.SHOW_TEXT */, {
    acceptNode: (n) => (n.parentElement?.closest("script,style,rt") ? 2 /* REJECT */ : 1 /* ACCEPT */),
  });
  let lastBlock: Element | null = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const block = n.parentElement?.closest(BLOCK) ?? null;
    breaks.push(nodes.length > 0 && block !== lastBlock);
    lastBlock = block;
    nodes.push(n as Text);
  }
  const hay = buildHaystack(
    nodes.map((n) => n.data),
    breaks,
  );
  return findAll(hay, needle, limit).map((m) => {
    const range = doc.createRange();
    range.setStart(nodes[m.start.seg], m.start.offset);
    range.setEnd(nodes[m.end.seg], m.end.offset);
    return { range, excerpt: m.excerpt };
  });
}
