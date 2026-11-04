"use client";

import { usePathname } from "next/navigation";
import { useCallback } from "react";
import { localizedPath, type Locale } from "@/lib/i18n/config";

/** Pathname without the locale prefix (e.g. "/en/books/x" → "/books/x"). */
export function useBarePathname(): string {
  const pathname = usePathname() ?? "/";
  const stripped = pathname.replace(/^\/(en|bn)(?=\/|$)/, "");
  return stripped === "" ? "/" : stripped;
}

export function useLocalizedHref(locale: Locale) {
  return useCallback((path: string) => localizedPath(locale, path), [locale]);
}
