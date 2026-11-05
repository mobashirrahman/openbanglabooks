"use client";

import { localDB, type WorkSnapshot } from "@/lib/local/db";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { isKeptOffline } from "./pages";

export type ReadableOffline = { slug: string; work: WorkSnapshot; fraction: number; href: string };

/** Books that open without a network: the file is in IndexedDB and the reader page is kept. */
export async function readableOffline(locale: Locale): Promise<ReadableOffline[]> {
  const db = localDB();
  const positions = await db.positions.orderBy("openedAt").reverse().toArray();
  const out: ReadableOffline[] = [];
  for (const p of positions) {
    const href = localizedPath(locale, `/read/${p.workSlug}`);
    const [file, page] = await Promise.all([db.files.get(p.fileSha).catch(() => undefined), isKeptOffline(href)]);
    if (file && page) out.push({ slug: p.workSlug, work: p.work, fraction: p.fraction, href });
  }
  return out;
}
