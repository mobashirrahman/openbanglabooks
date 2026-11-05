import { describe, expect, it } from "vitest";
import { parseCsv, unguard, writeCsv } from "@/lib/transfer/csv";
import { GoodreadsError, goodreadsCsv, lastFirst, parseDate, parseGoodreads, reviewText, type ExportBook } from "@/lib/transfer/goodreads";
import { MatchIndex, matchAll, type MatchWork } from "@/lib/transfer/match";

describe("csv", () => {
  it("reads quoted fields, doubled quotes, new lines inside fields and CRLF", () => {
    const text = '﻿a,b,c\r\n1,"two, three","say ""hi"""\r\n"multi\nline",,x\n\n';
    expect(parseCsv(text)).toEqual([
      ["a", "b", "c"],
      ["1", "two, three", 'say "hi"'],
      ["multi\nline", "", "x"],
    ]);
  });

  it("writes what it reads, and never a cell a spreadsheet would run", () => {
    const rows = [["title", "note"], ["দেবদাস, প্রথম", 'he said "no"'], ["=HYPERLINK(\"x\")", "line\nbreak"]];
    const back = parseCsv(writeCsv(rows));
    expect(back[1]).toEqual(rows[1]);
    expect(back[2][0]).toBe("'=HYPERLINK(\"x\")");
    expect(unguard(back[2][0])).toBe(rows[2][0]);
    expect(back[2][1]).toBe("line\nbreak");
  });
});

const HEADER =
  "Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies";
const row = (o: { title: string; author: string; extra?: string; rating?: number; read?: string; added?: string; shelves?: string; exclusive: string; review?: string; notes?: string; count?: number }) =>
  [
    "1",
    `"${o.title.replace(/"/g, '""')}"`,
    o.author,
    `"${lastFirst(o.author)}"`,
    o.extra ?? "",
    '"=""0143067290"""',
    '"=""9780143067290"""',
    o.rating ?? 0,
    "3.9",
    "Penguin",
    "Paperback",
    "200",
    "2002",
    "1917",
    o.read ?? "",
    o.added ?? "2022/01/01",
    `"${o.shelves ?? o.exclusive}"`,
    "",
    o.exclusive,
    `"${(o.review ?? "").replace(/"/g, '""')}"`,
    "",
    o.notes ?? "",
    o.count ?? 0,
    0,
  ].join(",");

const EXPORT = [
  HEADER,
  row({ title: "Debdas", author: "Sarat Chandra Chattopadhyay", rating: 4, read: "2023/03/14", added: "2023/01/02", shelves: "bengali, favorites, read", exclusive: "read", review: "Heartbreaking.<br/><br/>Paro &amp; Devdas &#8212; again.", count: 1 }),
  row({ title: "Gitanjali: Song Offerings", author: "Rabindranath Tagore", extra: "W.B. Yeats", rating: 5, read: "2022/11/20", shelves: "poetry, read", exclusive: "read", count: 1 }),
  row({ title: "Srikanta (Srikanta, #1)", author: "Saratchandra Chatterjee", exclusive: "currently-reading", shelves: "currently-reading" }),
  row({ title: "The Home and the World", author: "Rabindranath Tagore", exclusive: "to-read" }),
  row({ title: "Pride and Prejudice", author: "Jane Austen", exclusive: "to-read", rating: 0 }),
  row({ title: "গোরা", author: "রবীন্দ্রনাথ ঠাকুর", exclusive: "read", count: 1 }),
  row({ title: "Gora", author: "Somebody Else", exclusive: "to-read" }),
  row({ title: "The Golden Boat", author: "Rabindranath Tagore", exclusive: "to-read" }),
  row({ title: "Anandamatha", author: "Bankimchandra Chatterji", exclusive: "did-not-finish", shelves: "did-not-finish, history", notes: "too slow for me" }),
  row({ title: "Golpoguccho", author: "Robindronath Thakur", exclusive: "read", count: 1 }),
].join("\n");

const WORKS: MatchWork[] = [
  ["anandamath", "আনন্দমঠ", "Anandamath", "anandamath anondomoth ananda math anandamatha", "বঙ্কিমচন্দ্র চট্টোপাধ্যায়/Bankim Chandra Chattopadhyay"],
  ["bardidi", "বড়দিদি", "Bardidi", "bardidi boro didi borodidi", "শরৎচন্দ্র চট্টোপাধ্যায়/Sarat Chandra Chattopadhyay"],
  ["chaturanga", "চতুরঙ্গ", "Chaturanga", "chaturanga chaturango choturongo", "রবীন্দ্রনাথ ঠাকুর/Rabindranath Tagore"],
  ["devdas", "দেবদাস", "Devdas", "devdas debdas debdash", "শরৎচন্দ্র চট্টোপাধ্যায়/Sarat Chandra Chattopadhyay"],
  ["galpaguchchha-1", "গল্পগুচ্ছ", "Galpaguchchha (Volume One)", "galpaguchchha golpoguccho galpaguccha golpo guccho short stories tagore", "রবীন্দ্রনাথ ঠাকুর/Rabindranath Tagore"],
  ["gitanjali", "গীতাঞ্জলি", "Gitanjali", "gitanjali geetanjali gitanjoli song offerings", "রবীন্দ্রনাথ ঠাকুর/Rabindranath Tagore"],
  ["gora", "গোরা", "Gora", "gora", "রবীন্দ্রনাথ ঠাকুর/Rabindranath Tagore"],
  ["kapalkundala", "কপালকুণ্ডলা", "Kapalkundala", "kapalkundala kopalkundola kapal kundala", "বঙ্কিমচন্দ্র চট্টোপাধ্যায়/Bankim Chandra Chattopadhyay"],
  ["palli-samaj", "পল্লী-সমাজ", "Palli Samaj", "palli samaj polli somaj pallisamaj", "শরৎচন্দ্র চট্টোপাধ্যায়/Sarat Chandra Chattopadhyay"],
  ["shesher-kobita", "শেষের কবিতা", "Shesher Kobita", "shesher kobita shesher kabita the last poem farewell song", "রবীন্দ্রনাথ ঠাকুর/Rabindranath Tagore"],
  ["sonar-tori", "সোনার তরী", "Sonar Tori", "sonar tori sonar tari the golden boat", "রবীন্দ্রনাথ ঠাকুর/Rabindranath Tagore"],
  ["srikanta-1", "শ্রীকান্ত", "Srikanta (Part One)", "srikanta srikanto shrikanta srikanta part 1 prothom porbo", "শরৎচন্দ্র চট্টোপাধ্যায়/Sarat Chandra Chattopadhyay"],
  ["tuntunir-boi", "টুনটুনির বই", "Tuntunir Boi", "tuntunir boi tuntuni tuntunir bai", "উপেন্দ্রকিশোর রায়চৌধুরী/Upendrakishore Ray Chowdhury"],
].map(([slug, title_bn, title_en, title_latn, author]) => {
  const [name_bn, name_en] = author.split("/");
  return { slug, title_bn, title_en, title_latn, authors: [{ name_bn, name_en }] };
});

describe("Goodreads export", () => {
  const books = parseGoodreads(EXPORT);

  it("reads every book with its status, rating, dates, shelves and review", () => {
    expect(books).toHaveLength(10);
    const [debdas, gitanjali, srikanta, , pride, , , , anandamath] = books;
    expect(debdas).toMatchObject({
      title: "Debdas",
      author: "Sarat Chandra Chattopadhyay",
      isbn: "9780143067290",
      rating: 4,
      status: "finished",
      shelves: ["bengali"],
      favourite: true,
      review: "Heartbreaking.\n\nParo & Devdas — again.",
    });
    expect(new Date(debdas.dateRead!).toDateString()).toBe(new Date(2023, 2, 14).toDateString());
    expect(gitanjali.additionalAuthors).toEqual(["W.B. Yeats"]);
    expect(gitanjali.shelves).toEqual(["poetry"]);
    expect(srikanta).toMatchObject({ title: "Srikanta", series: "Srikanta, #1", status: "reading" });
    expect(pride.rating).toBeNull();
    expect(anandamath).toMatchObject({ status: "dnf", shelves: ["history"], privateNotes: "too slow for me" });
  });

  it("refuses files that are not Goodreads exports", () => {
    expect(() => parseGoodreads("name,email\nx,y")).toThrow(GoodreadsError);
    expect(() => parseGoodreads(HEADER)).toThrow(/empty/);
  });

  it("reads dates in both spellings and nothing else", () => {
    expect(parseDate("2024/01/15")).toBe(new Date(2024, 0, 15, 12).getTime());
    expect(parseDate("2024-1-5")).toBe(new Date(2024, 0, 5, 12).getTime());
    expect(parseDate("15/01/2024")).toBeNull();
    expect(parseDate("")).toBeNull();
  });

  it("keeps review text and drops markup", () => {
    expect(reviewText('<b>Loved</b> it<br/>&lt;3 <a href="x">link</a>')).toBe("Loved it\n<3 link");
    expect(reviewText("<br/>  ")).toBeNull();
  });
});

describe("matching a Goodreads library against the catalogue", () => {
  const books = parseGoodreads(EXPORT);
  const index = new MatchIndex(WORKS);

  it("finds books spelt differently or in another script, and asks about the doubtful ones", async () => {
    const results = await matchAll(index, books);
    const got = results.map((r, i) => [books[i].title, r.verdict, r.slug ?? r.candidates[0]?.slug ?? null]);
    expect(got).toEqual([
      ["Debdas", "match", "devdas"],
      ["Gitanjali: Song Offerings", "match", "gitanjali"],
      ["Srikanta", "match", "srikanta-1"],
      ["The Home and the World", "none", null],
      ["Pride and Prejudice", "none", null],
      ["গোরা", "match", "gora"],
      // the right title by someone else: the reader decides
      ["Gora", "maybe", "gora"],
      // an English title we know as another name
      ["The Golden Boat", "match", "sonar-tori"],
      ["Anandamatha", "match", "anandamath"],
      ["Golpoguccho", "match", "galpaguchchha-1"],
    ]);
  });

  it("is never sure when two books fit equally", () => {
    const two = new MatchIndex([...WORKS, { slug: "srikanta-2", title_bn: "শ্রীকান্ত", title_en: "Srikanta (Part Two)", title_latn: "srikanta part 2", authors: WORKS.find((w) => w.slug === "srikanta-1")!.authors }]);
    const r = two.match({ title: "Srikanta", author: "Sarat Chandra Chattopadhyay" });
    expect(r.verdict).toBe("maybe");
    expect(r.candidates.map((c) => c.slug).sort()).toEqual(["srikanta-1", "srikanta-2"]);
  });

  it("tells books by the same author apart", () => {
    expect(index.match({ title: "Kapalkundala", author: "Bankim Chandra Chatterjee" }).slug).toBe("kapalkundala");
    expect(index.match({ title: "Bardidi", author: "Bankim Chandra Chatterjee" }).verdict).not.toBe("match");
  });

  it("knows its own files by id", async () => {
    const [r] = await matchAll(index, [{ title: "anything", author: "", ourId: "palli-samaj" }]);
    expect(r).toMatchObject({ verdict: "match", slug: "palli-samaj" });
  });
});

describe("our Goodreads-format export", () => {
  const books: ExportBook[] = [
    { id: "devdas", title: "Devdas", titleBn: "দেবদাস", author: "Sarat Chandra Chattopadhyay", authorBn: "শরৎচন্দ্র চট্টোপাধ্যায়", year: 1917, status: "finished", rating: 5, favourite: true, shelves: ["Classics, Bengali"], dateRead: new Date(2025, 5, 1, 12).getTime(), dateAdded: new Date(2025, 0, 1, 12).getTime(), notes: "Paro." },
    { id: "mine-0123456789abcdef01234567", title: "আমার বই", titleBn: "আমার বই", author: "", authorBn: "", year: null, status: "dnf", rating: null, favourite: false, shelves: [], dateRead: null, dateAdded: null, notes: null },
  ];
  const csv = goodreadsCsv(books);

  it("has Goodreads' columns and our own after them", () => {
    const [header, devdas] = parseCsv(csv);
    expect(header.slice(0, 3)).toEqual(["Book Id", "Title", "Author"]);
    expect(header).toContain("Exclusive Shelf");
    expect(header.at(-3)).toBe("OpenBanglaBooks Id");
    const at = (name: string) => devdas[header.indexOf(name)];
    expect(at("Author l-f")).toBe("Chattopadhyay, Sarat Chandra");
    expect(at("My Rating")).toBe("5");
    expect(at("Date Read")).toBe("2025/06/01");
    expect(at("Exclusive Shelf")).toBe("read");
    expect(at("Bookshelves")).toBe("read, favorites, Classics Bengali");
    expect(at("Private Notes")).toBe("Paro.");
    expect(at("My Review")).toBe("");
  });

  it("comes back as it went out", () => {
    const back = parseGoodreads(csv);
    expect(back[0]).toMatchObject({ title: "Devdas", status: "finished", rating: 5, favourite: true, shelves: ["Classics Bengali"], ourId: "devdas", privateNotes: "Paro." });
    expect(back[1]).toMatchObject({ title: "আমার বই", status: "dnf", rating: null, ourId: "mine-0123456789abcdef01234567" });
  });
});
