import type { LibraryStatus } from "@/lib/local/db";
import { parseCsv, unguard, writeCsv } from "./csv";

/**
 * Goodreads library exports (My Books → Import and export → Export
 * Library), read and written. There is no Goodreads API to call: the
 * reader brings the file, and takes ours back the same way.
 */

export type GoodreadsBook = {
  /** the row in the file, from 1 (the header is row 0) */
  row: number;
  title: string;
  /** "Srikanta, #1" from "Srikanta (Srikanta, #1)" */
  series: string | null;
  author: string;
  additionalAuthors: string[];
  isbn: string | null;
  /** 1–5, or null when unrated (Goodreads writes 0) */
  rating: number | null;
  status: LibraryStatus;
  /** the reader's own shelves, without to-read, read and the like */
  shelves: string[];
  favourite: boolean;
  dateRead: number | null;
  dateAdded: number | null;
  review: string | null;
  privateNotes: string | null;
  /** our own id, when the file is one we wrote */
  ourId: string | null;
};

export class GoodreadsError extends Error {
  constructor(readonly code: "notGoodreads" | "empty" | "tooMany") {
    super(code);
  }
}

export const MAX_ROWS = 20000;
export const OUR_ID = "OpenBanglaBooks Id";

const EXCLUSIVE: Record<string, LibraryStatus> = { "to-read": "want", "currently-reading": "reading", read: "finished" };
const DNF = /^(did-?not-?finish|dnf|abandon(ed)?|gave-?up)$/i;
const FAVOURITES = /^(favou?rites?|favs?)$/i;

const statusOfShelf = (name: string): LibraryStatus | null => EXCLUSIVE[name.toLowerCase()] ?? (DNF.test(name) ? "dnf" : null);

/** "2024/01/15" (Goodreads) or "2024-01-15", at noon local time so the day never shifts. */
export function parseDate(s: string | undefined): number | null {
  const m = s?.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = new Date(y, mo - 1, d, 12).getTime();
  return Number.isFinite(t) ? t : null;
}

export function formatDate(t: number | null | undefined): string {
  if (!t) return "";
  const d = new Date(t);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Goodreads reviews are HTML: line breaks become new lines, other tags go. */
export function reviewText(html: string): string | null {
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}

/** ISBNs come wrapped for spreadsheets: ="0140449264". */
const isbnOf = (s: string | undefined) => s?.replace(/^="?|"$/g, "").replace(/[^0-9Xx]/g, "") || null;

/** Reads a Goodreads export (or a file we wrote, which has the same columns). */
export function parseGoodreads(text: string): GoodreadsBook[] {
  const rows = parseCsv(text);
  if (!rows.length) throw new GoodreadsError("empty");
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const at = {
    title: col("Title"),
    author: col("Author"),
    additional: col("Additional Authors"),
    isbn: col("ISBN13") >= 0 ? col("ISBN13") : col("ISBN"),
    isbn10: col("ISBN"),
    rating: col("My Rating"),
    dateRead: col("Date Read"),
    dateAdded: col("Date Added"),
    shelves: col("Bookshelves"),
    exclusive: col("Exclusive Shelf"),
    review: col("My Review"),
    notes: col("Private Notes"),
    readCount: col("Read Count"),
    ours: col(OUR_ID),
  };
  if (at.title < 0 || (at.author < 0 && at.ours < 0)) throw new GoodreadsError("notGoodreads");
  if (rows.length - 1 > MAX_ROWS) throw new GoodreadsError("tooMany");

  const books: GoodreadsBook[] = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const get = (i: number) => (i >= 0 ? unguard((row[i] ?? "").trim()) : "");
    const rawTitle = get(at.title).replace(/\s+/g, " ");
    if (!rawTitle) continue;
    const series = rawTitle.match(/\s*\(([^()]*#\s*[\d.]+[^()]*)\)\s*$/);
    const title = series ? rawTitle.slice(0, series.index).trim() : rawTitle;

    const shelfNames = get(at.shelves)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const exclusive = get(at.exclusive);
    const rating = Number(get(at.rating));
    const readCount = Number(get(at.readCount)) || 0;
    const dateRead = parseDate(get(at.dateRead));
    const status: LibraryStatus =
      (exclusive && statusOfShelf(exclusive)) ||
      shelfNames.map(statusOfShelf).find(Boolean) ||
      (readCount > 0 || dateRead ? "finished" : "want");
    const custom = [...new Set([...shelfNames, ...(exclusive && !statusOfShelf(exclusive) ? [exclusive] : [])])].filter(
      (s) => !statusOfShelf(s) && !FAVOURITES.test(s),
    );

    books.push({
      row: r,
      title,
      series: series ? series[1].trim() : null,
      author: get(at.author).replace(/\s+/g, " "),
      additionalAuthors: get(at.additional)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      isbn: isbnOf(get(at.isbn)) ?? isbnOf(get(at.isbn10)),
      rating: rating >= 1 && rating <= 5 ? Math.round(rating) : null,
      status,
      shelves: custom,
      favourite: shelfNames.some((s) => FAVOURITES.test(s)),
      dateRead,
      dateAdded: parseDate(get(at.dateAdded)),
      review: reviewText(get(at.review)),
      privateNotes: get(at.notes) || null,
      ourId: get(at.ours) || null,
    });
  }
  if (!books.length) throw new GoodreadsError("empty");
  return books;
}

// ── writing ───────────────────────────────────────────────────────────────

export type ExportBook = {
  id: string;
  title: string;
  titleBn: string;
  author: string;
  authorBn: string;
  year: number | null;
  status: LibraryStatus;
  rating: number | null;
  favourite: boolean;
  shelves: string[];
  dateRead: number | null;
  dateAdded: number | null;
  /** the private reflection, only when the reader asked for it */
  notes: string | null;
};

/** Goodreads' own export columns, so its import (and StoryGraph's, and others') reads the file; ours go last. */
export const GOODREADS_COLUMNS = [
  "Book Id", "Title", "Author", "Author l-f", "Additional Authors", "ISBN", "ISBN13", "My Rating", "Average Rating",
  "Publisher", "Binding", "Number of Pages", "Year Published", "Original Publication Year", "Date Read", "Date Added",
  "Bookshelves", "Bookshelves with positions", "Exclusive Shelf", "My Review", "Spoiler", "Private Notes", "Read Count",
  "Owned Copies",
];
const OUR_COLUMNS = [OUR_ID, "Title (Bengali)", "Author (Bengali)"];

const SHELF_OF: Record<LibraryStatus, string> = { want: "to-read", reading: "currently-reading", finished: "read", dnf: "did-not-finish" };

/** "Sarat Chandra Chattopadhyay" → "Chattopadhyay, Sarat Chandra". */
export function lastFirst(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts.at(-1)}, ${parts.slice(0, -1).join(" ")}` : name.trim();
}

// Goodreads separates shelves with commas, so a comma cannot be in a shelf name
const shelfName = (s: string) => s.replace(/,/g, " ").replace(/\s+/g, " ").trim();

export function goodreadsCsv(books: ExportBook[]): string {
  const rows = books.map((b) => {
    const exclusive = SHELF_OF[b.status];
    const shelves = [exclusive, ...(b.favourite ? ["favorites"] : []), ...b.shelves.map(shelfName).filter(Boolean)];
    return [
      "", b.title, b.author, b.author ? lastFirst(b.author) : "", "", "", "", b.rating ?? 0, "",
      "", "", "", "", b.year ?? "", formatDate(b.dateRead), formatDate(b.dateAdded),
      shelves.join(", "), "", exclusive, "", "", b.notes ?? "", b.status === "finished" ? 1 : 0,
      0, b.id, b.titleBn, b.authorBn,
    ];
  });
  return writeCsv([[...GOODREADS_COLUMNS, ...OUR_COLUMNS], ...rows]);
}
