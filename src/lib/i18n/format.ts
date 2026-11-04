import { localeTag, type Locale } from "./config";

const numberFormats = new Map<string, Intl.NumberFormat>();

function nf(locale: Locale, options?: Intl.NumberFormatOptions) {
  const key = locale + JSON.stringify(options ?? {});
  let f = numberFormats.get(key);
  if (!f) {
    f = new Intl.NumberFormat(localeTag[locale], { useGrouping: false, ...options });
    numberFormats.set(key, f);
  }
  return f;
}

/** Numbers in the UI language: Bengali digits (০–৯) for bn. */
export function formatNumber(n: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return nf(locale, options).format(n);
}

export function formatPercent(fraction: number, locale: Locale): string {
  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  return `${formatNumber(pct, locale)}%`;
}

/** Year spans like ১৮৯৪–১৯৫০ (years are written without grouping). */
export function formatYearRange(from: number | null, to: number | null, locale: Locale): string {
  const f = (y: number | null) => (y == null ? "" : formatNumber(y, locale));
  if (from == null && to == null) return "";
  return `${f(from)}–${f(to)}`;
}

const BENGALI_DIGITS = "০১২৩৪৫৬৭৮৯";
/** Converts any Bengali digits in a string to ASCII (for parsing user input). */
export function toAsciiDigits(s: string): string {
  return s.replace(/[০-৯]/g, (d) => String(BENGALI_DIGITS.indexOf(d)));
}

/**
 * A reading-time estimate: "৭ মিনিট", "৩ ঘণ্টা ২০ মিনিট" / "7 min", "3 h 20 min".
 * Rounded like a person would say it: whole minutes, and steps of five once
 * it runs to hours.
 */
export function formatDuration(seconds: number, locale: Locale): string {
  const bn = locale === "bn";
  const n = (x: number) => formatNumber(x, locale);
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return bn ? "১ মিনিটের কম" : "under a minute";
  if (minutes < 60) return bn ? `${n(minutes)} মিনিট` : `${n(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round((minutes % 60) / 5) * 5;
  const hh = m === 60 ? h + 1 : h;
  const mm = m === 60 ? 0 : m;
  if (!mm) return bn ? `${n(hh)} ঘণ্টা` : `${n(hh)} h`;
  return bn ? `${n(hh)} ঘণ্টা ${n(mm)} মিনিট` : `${n(hh)} h ${n(mm)} min`;
}
