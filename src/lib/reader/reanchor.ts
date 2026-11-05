import { normalizeQuery } from "./book-search";

/**
 * Re-anchoring a highlight in a changed book file. The highlight's quote is
 * searched for in the new file; when it occurs more than once, the words
 * around it (prefix and suffix, saved with the highlight) decide. A match is
 * only accepted when it is unique, or clearly the best fit — otherwise the
 * highlight is marked orphaned, never attached to a guess.
 */

export type Candidate = { pre: string; post: string };

function commonSuffix(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefix(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** How well a candidate's surroundings match the saved context (characters in common). */
export function contextScore(c: Candidate, prefix: string, suffix: string): number {
  return commonSuffix(normalizeQuery(c.pre), normalizeQuery(prefix)) + commonPrefix(normalizeQuery(c.post), normalizeQuery(suffix));
}

/** The index of the matching candidate, or -1 when there is none or no clear winner. */
export function pickAnchor(candidates: Candidate[], prefix: string, suffix: string): number {
  if (candidates.length === 0) return -1;
  if (candidates.length === 1) return 0;
  const scored = candidates.map((c, i) => ({ i, s: contextScore(c, prefix, suffix) })).sort((a, b) => b.s - a.s);
  return scored[0].s > 0 && scored[0].s > scored[1].s ? scored[0].i : -1;
}
