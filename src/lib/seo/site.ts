import { localizedPath, type Locale } from "@/lib/i18n/config";

/** Public origin (configurable). Production intent: https://openbanglabooks.com */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function absoluteUrl(locale: Locale, path: string): string {
  return siteUrl() + localizedPath(locale, path);
}

/**
 * Canonical + language alternates. Alternates are only emitted when the page
 * really exists with translated content in the other language.
 */
export function alternates(locale: Locale, path: string, hasEnglish: boolean) {
  const languages: Record<string, string> = { bn: absoluteUrl("bn", path) };
  if (hasEnglish) {
    languages.en = absoluteUrl("en", path);
    languages["x-default"] = absoluteUrl("bn", path);
  }
  return {
    canonical: absoluteUrl(locale, path),
    languages: hasEnglish ? languages : undefined,
  };
}

export const SITE_NAME = "OpenBanglaBooks";
