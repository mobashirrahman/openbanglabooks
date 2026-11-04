import { lang } from "next/root-params";
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "./config";
import type { Dictionary } from "./dictionaries/bn";

const dictionaries: Record<Locale, () => Promise<Dictionary>> = {
  bn: () => import("./dictionaries/bn").then((m) => m.default),
  en: () => import("./dictionaries/en").then((m) => m.default),
};

/** Current locale from the `[lang]` root segment (server only). */
export async function getLocale(): Promise<Locale> {
  const value = await lang();
  if (!value || !isLocale(value)) notFound();
  return value;
}

export async function getDictionary(locale?: Locale): Promise<Dictionary> {
  return dictionaries[locale ?? (await getLocale())]();
}

export { t } from "./t";
export type { Dictionary, Locale };
