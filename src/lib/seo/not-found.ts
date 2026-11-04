import type { Metadata } from "next";
import { getDictionary } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n/config";

/**
 * Metadata for a slug that does not exist. The page's own generateMetadata
 * takes precedence over not-found.tsx, so it must return this itself.
 */
export async function notFoundMetadata(locale?: Locale): Promise<Metadata> {
  const dict = await getDictionary(locale);
  return { title: dict.common.notFoundTitle, robots: { index: false, follow: true } };
}
