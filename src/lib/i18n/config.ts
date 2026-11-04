export const locales = ["bn", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "bn";

export const isLocale = (value: string): value is Locale =>
  (locales as readonly string[]).includes(value);

/** BCP-47 tags used for Intl formatting and `hreflang`. */
export const localeTag: Record<Locale, string> = { bn: "bn-BD", en: "en" };

/**
 * Public URL path for a route in a locale. Bengali is the default and is
 * served without a prefix; English lives under /en.
 */
export function localizedPath(locale: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === defaultLocale) return clean;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}
