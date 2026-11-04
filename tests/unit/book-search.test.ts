import { describe, expect, it } from "vitest";
import { buildHaystack, findAll, normalizeQuery } from "@/lib/reader/book-search";

const find = (segments: string[], q: string, breaks?: boolean[]) =>
  findAll(buildHaystack(segments, breaks), normalizeQuery(q)).map((m) => m.excerpt.match);

describe("Bengali-aware book search", () => {
  it("finds a word with conjuncts", () => {
    expect(find(["দেবদাস ও পার্ব্বতী পাঠশালায় যায়।"], "পার্ব্বতী")).toEqual(["পার্ব্বতী"]);
  });

  it("ignores zero-width joiners in either the text or the query", () => {
    const text = ["র‌্যাব এবং র্যাব"];
    expect(find(text, "র্যাব")).toEqual(["র‌্যাব", "র্যাব"]);
    expect(find(text, "র‌্যাব")).toEqual(["র‌্যাব", "র্যাব"]);
  });

  it("treats য় as one code point or two as the same letter", () => {
    const text = ["য়ে এবং য়ে"];
    expect(find(text, "য়ে")).toHaveLength(2);
    expect(find(text, "য়ে")).toHaveLength(2);
  });

  it("never ignores vowel signs or hasanta", () => {
    expect(find(["দেবদাস"], "দবদস")).toEqual([]);
    expect(find(["কাল"], "কল")).toEqual([]);
  });

  it("matches across inline markup but not across paragraphs without a space", () => {
    // "দেব" and "দাস" in two text nodes of one paragraph (e.g. split by <i>)
    expect(find(["দেব", "দাস এল"], "দেবদাস", [false, false])).toEqual(["দেবদাস"]);
    // two paragraphs: their text is separated
    expect(find(["শেষ", "শুরু"], "শেষশুরু", [false, true])).toEqual([]);
    expect(find(["শেষ", "শুরু"], "শেষ শুরু", [false, true])).toHaveLength(1);
  });

  it("collapses whitespace and ignores case in Latin text", () => {
    expect(find(["Devdas   and\nParbati"], "devdas and parbati")).toHaveLength(1);
  });

  it("maps matches back to exact positions and gives context", () => {
    const hay = buildHaystack(["আগের লেখা ", "য়ে মিলেছে"]);
    const [m] = findAll(hay, normalizeQuery("য়ে"));
    expect(m.start).toEqual({ seg: 1, offset: 0 });
    expect(m.end).toEqual({ seg: 1, offset: 3 });
    expect(m.excerpt.pre).toBe("আগের লেখা ");
    expect(m.excerpt.post).toBe(" মিলেছে");
  });
});
