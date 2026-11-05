"use client";

import { localDB, type LibraryStatus } from "@/lib/local/db";
import { isPersonal } from "@/lib/personal/ids";
import type { GoodreadsBook } from "@/lib/transfer/goodreads";
import { hardcoverFind, hardcoverLibrary, hardcoverSend, sendToReadwise, type Failure, type HighlightIn, type SendIn } from "./actions";
import { HARDCOVER_BUCKET, HARDCOVER_FIND_BATCH, HARDCOVER_REFILL_SECONDS, HARDCOVER_SEND_BATCH, READWISE_BATCH } from "./limits";
import type { HardcoverBook } from "./hardcover";

/**
 * The browser's half of the connections: it knows the reader's books and
 * highlights (they live here, in IndexedDB) and hands them to the server
 * actions in small batches; the server holds the tokens.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Calls an action again after the wait a rate limit asks for (twice at most). */
async function patiently<T extends { ok: boolean }>(call: () => Promise<T | Failure>, onWait?: (seconds: number) => void): Promise<T | Failure> {
  for (let attempt = 0; ; attempt++) {
    const r = await call();
    if (r.ok || (r as Failure).code !== "rateLimited" || attempt >= 2) return r;
    const seconds = (r as Failure).retryAfter ?? 30;
    onWait?.(seconds);
    await sleep(seconds * 1000);
  }
}

// ── Readwise ───────────────────────────────────────────────────────────────

const SENT_AT = "readwise:sent-at";

export async function readwiseLastSent(): Promise<number | null> {
  return ((await localDB().meta.get(SENT_AT))?.value as number | undefined) ?? null;
}

/** Highlights to send: new or changed since the last send (or all), never from a book kept only on this device. */
async function highlightsToSend(all: boolean, includeOwn: boolean): Promise<HighlightIn[]> {
  const db = localDB();
  const since = all ? 0 : ((await readwiseLastSent()) ?? 0);
  const [annotations, own] = await Promise.all([db.annotations.toArray(), db.personalBooks.toArray()]);
  const inAccount = new Set(own.filter((b) => b.cloud).map((b) => b.id));
  const origin = window.location.origin;
  return annotations
    .filter((a) => !a.conflictOf && a.quote.trim() && a.updatedAt > since)
    .filter((a) => !isPersonal(a.workSlug) || (includeOwn && inAccount.has(a.workSlug)))
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((a) => ({
      id: a.id,
      text: a.quote,
      note: a.note,
      title: a.work.title_bn,
      author: a.work.authors.map((x) => x.name_bn).join(", "),
      fraction: a.fraction,
      createdAt: a.createdAt,
      url: `${origin}/read/${a.workSlug}?cfi=${encodeURIComponent(a.cfi)}&h=${encodeURIComponent(a.id)}`,
    }));
}

export async function sendHighlights(
  opts: { all: boolean; includeOwn: boolean },
  progress: (p: { done: number; total: number; waiting?: number }) => void,
): Promise<{ ok: true; sent: number } | Failure> {
  const started = Date.now();
  const items = await highlightsToSend(opts.all, opts.includeOwn);
  let sent = 0;
  progress({ done: 0, total: items.length });
  for (let i = 0; i < items.length; i += READWISE_BATCH) {
    const batch = items.slice(i, i + READWISE_BATCH);
    const r = await patiently(
      () => sendToReadwise(batch),
      (seconds) => progress({ done: i, total: items.length, waiting: seconds }),
    );
    if (!r.ok) return r;
    sent += r.sent;
    progress({ done: Math.min(i + batch.length, items.length), total: items.length });
  }
  await localDB().meta.put({ key: SENT_AT, value: started });
  return { ok: true, sent };
}

// ── Hardcover ──────────────────────────────────────────────────────────────

/**
 * Hardcover's rate-limit bucket as this page last saw it (see limits.ts):
 * a call waits until the bucket holds what it may spend, so a long run of
 * calls goes at the rate Hardcover refills it instead of meeting 429s.
 */
const bucket = { tokens: HARDCOVER_BUCKET, at: Date.now() };
function refill() {
  const now = Date.now();
  bucket.tokens = Math.min(HARDCOVER_BUCKET, bucket.tokens + (now - bucket.at) / (HARDCOVER_REFILL_SECONDS * 1000));
  bucket.at = now;
}
async function hardcoverTurn(cost: number) {
  refill();
  if (bucket.tokens < cost) await sleep((cost - bucket.tokens) * HARDCOVER_REFILL_SECONDS * 1000);
  refill();
}
const hardcoverSpent = (n: number) => {
  bucket.tokens -= n;
};

// bringing books in

const HC_STATUS: Record<number, LibraryStatus | null> = { 1: "want", 2: "reading", 3: "finished", 4: "reading", 5: "dnf", 6: null };

const dayOf = (d: string | null) => {
  const m = d?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime() : null;
};

/** The reader's Hardcover library, as rows the Goodreads review step understands. */
export async function readHardcoverLibrary(progress: (count: number) => void): Promise<{ ok: true; books: GoodreadsBook[] } | Failure> {
  const books: GoodreadsBook[] = [];
  for (let offset = 0; offset < 20000; ) {
    await hardcoverTurn(1);
    const r = await patiently(() => hardcoverLibrary(offset));
    if (!r.ok) return r;
    hardcoverSpent(r.spent);
    for (const e of r.entries) {
      const status = HC_STATUS[e.status];
      if (!status) continue; // "ignored" on Hardcover
      books.push({
        row: books.length + 1,
        title: e.title,
        series: null,
        author: e.authors[0] ?? "",
        additionalAuthors: e.authors.slice(1),
        isbn: null,
        rating: e.rating && e.rating >= 1 ? Math.min(5, Math.round(e.rating)) : null,
        status,
        shelves: [],
        favourite: false,
        dateRead: status === "finished" ? dayOf(e.lastRead) : null,
        dateAdded: dayOf(e.dateAdded),
        review: null,
        privateNotes: null,
        ourId: null,
      });
    }
    progress(books.length);
    if (!r.more) break;
    offset += r.entries.length || 100;
  }
  return { ok: true, books };
}

// sending books out

const BOOK_MAP = "hardcover:books";

/** Our book → the Hardcover book the reader confirmed for it, remembered on this device. */
export async function knownHardcoverBooks(): Promise<Record<string, HardcoverBook>> {
  return ((await localDB().meta.get(BOOK_MAP))?.value as Record<string, HardcoverBook> | undefined) ?? {};
}

/** Remembers confirmed books; null forgets one (the reader left it out this time). */
export async function rememberHardcoverBooks(changes: Record<string, HardcoverBook | null>) {
  const map = await knownHardcoverBooks();
  for (const [slug, book] of Object.entries(changes)) {
    if (book) map[slug] = book;
    else delete map[slug];
  }
  await localDB().meta.put({ key: BOOK_MAP, value: map });
}

export async function findOnHardcover(queries: string[], progress: (done: number) => void): Promise<{ ok: true; results: HardcoverBook[][] } | Failure> {
  const results: HardcoverBook[][] = [];
  for (let i = 0; i < queries.length; i += HARDCOVER_FIND_BATCH) {
    const batch = queries.slice(i, i + HARDCOVER_FIND_BATCH);
    await hardcoverTurn(batch.length);
    const r = await patiently(() => hardcoverFind(batch));
    if (!r.ok) return r;
    hardcoverSpent(r.spent);
    results.push(...r.results);
    progress(Math.min(i + HARDCOVER_FIND_BATCH, queries.length));
  }
  return { ok: true, results };
}

export async function sendToHardcover(
  items: SendIn[],
  progress?: (done: number) => void,
): Promise<{ ok: true; added: number; updated: number; unchanged: number; failed: number } | Failure> {
  const total = { added: 0, updated: 0, unchanged: 0, failed: 0 };
  for (let i = 0; i < items.length; i += HARDCOVER_SEND_BATCH) {
    const batch = items.slice(i, i + HARDCOVER_SEND_BATCH);
    await hardcoverTurn(batch.length + 1);
    const r = await patiently(() => hardcoverSend(batch));
    if (!r.ok) return r;
    hardcoverSpent(r.spent);
    progress?.(Math.min(i + HARDCOVER_SEND_BATCH, items.length));
    total.added += r.added;
    total.updated += r.updated;
    total.unchanged += r.unchanged;
    total.failed += r.failed;
  }
  return { ok: true, ...total };
}
