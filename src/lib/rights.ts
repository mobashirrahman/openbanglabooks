/**
 * Public-domain rule used before a work may be published.
 *
 * - Bangladesh and India: copyright lasts 60 years after the author's death
 *   (counted from 1 January of the following year).
 * - United States: works first published 95+ years ago are public domain
 *   (in 2026, anything published before 1931).
 *
 * Both must hold. This is a conservative screen, not legal advice: every
 * work still needs a recorded rights basis and a named human reviewer.
 */
export type RightsInput = {
  authorDiedYears: (number | null | undefined)[];
  firstPublished: number | null | undefined;
  /** evaluation year (defaults to the current year) */
  year?: number;
};

export type RightsVerdict =
  | { ok: true; basis: string }
  | { ok: false; reason: string };

export function checkPublicDomain({ authorDiedYears, firstPublished, year = new Date().getUTCFullYear() }: RightsInput): RightsVerdict {
  if (!authorDiedYears.length) return { ok: false, reason: "No author recorded" };
  if (authorDiedYears.some((y) => y == null)) return { ok: false, reason: "An author's death year is unknown" };
  if (firstPublished == null) return { ok: false, reason: "First publication year is unknown" };
  const latestDeath = Math.max(...(authorDiedYears as number[]));
  const pdSouthAsia = latestDeath + 60 < year; // e.g. died 1941 → free from 1 Jan 2002
  if (!pdSouthAsia)
    return { ok: false, reason: `Author died in ${latestDeath}; protected in BD/IN until the end of ${latestDeath + 60}` };
  const usCutoff = year - 95;
  if (firstPublished >= usCutoff)
    return { ok: false, reason: `First published ${firstPublished}; US protection runs until ${firstPublished + 95}` };
  return {
    ok: true,
    basis: `Author died ${latestDeath} (public domain in Bangladesh and India since ${latestDeath + 61}); first published ${firstPublished} (public domain in the United States).`,
  };
}
