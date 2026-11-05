"use client";

import { localizedPath, type Locale } from "@/lib/i18n/config";

/**
 * Talking to the service worker (public/sw-core.js) from pages: which pages
 * to have ready offline, and whether a page is kept.
 */

/** Fonts the pages and the reader need; kept up front so text never falls back offline. */
const FONT_FILES = [
  "hind-siliguri-bengali-400-normal",
  "hind-siliguri-bengali-500-normal",
  "hind-siliguri-bengali-600-normal",
  "hind-siliguri-latin-400-normal",
  "tiro-bangla-bengali-400-normal",
  "tiro-bangla-latin-400-normal",
  "noto-serif-bengali-bengali-wght-normal",
  "noto-serif-bengali-latin-wght-normal",
  "anek-bangla-bengali-wght-normal",
].map((f) => `/fonts/${f}.woff2`);

/** The app shell: the pages that work without the catalog, in the reader's language. */
export function shellPages(locale: Locale): string[] {
  return ["/", "/library", "/notes", "/profile", "/offline"].map((p) => localizedPath(locale, p));
}

export function swSupported(): boolean {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && window.isSecureContext;
}

async function post(message: unknown) {
  if (!swSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration();
  (reg?.active ?? navigator.serviceWorker.controller)?.postMessage(message);
}

/** Asks the worker to keep these pages (and their scripts) for offline use. */
export async function keepOffline(urls: string[], withFonts = false) {
  await post({ type: "warm", urls, assets: withFonts ? FONT_FILES : [] });
}

/** Asks the worker to keep these build assets (scripts, styles, fonts). */
export async function keepAssets(paths: string[]) {
  if (paths.length) await post({ type: "warm", urls: [], assets: paths });
}

/** True if a copy of this page is kept for offline use. */
export async function isKeptOffline(path: string): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    return Boolean(await caches.match(new URL(path, location.origin).href));
  } catch {
    return false;
  }
}

/** Forgets every kept page and asset (with "clear this device"). */
export async function forgetOfflinePages() {
  await post({ type: "clear" });
  if (typeof caches === "undefined") return;
  for (const name of await caches.keys().catch(() => [] as string[])) if (name.startsWith("obb-")) await caches.delete(name);
}
