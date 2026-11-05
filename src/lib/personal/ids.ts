import { localizedPath, type Locale } from "@/lib/i18n/config";

/**
 * A reader's own books live beside the catalogue under ids of their own:
 * "mine-" and the first 24 hex digits of the cleaned file's SHA-256. The
 * same file added on two devices gets the same id. Catalogue slugs can never
 * start with "mine-" (a database check).
 */
export const PERSONAL_PREFIX = "mine-";
export const PERSONAL_ID = /^mine-[0-9a-f]{24}$/;

export const isPersonal = (slug: string) => slug.startsWith(PERSONAL_PREFIX);
export const personalIdFor = (sha256: string) => `${PERSONAL_PREFIX}${sha256.slice(0, 24)}`;

/** A cloth and motif for the generated cover, from the id (stable across devices). */
export function coverVariantFor(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return h % 36;
}

/** Where a book in the library leads: the catalogue page, or straight into a reader's own book. */
export function bookHref(locale: Locale, slug: string): string {
  return localizedPath(locale, isPersonal(slug) ? `/read/${slug}` : `/books/${slug}`);
}
