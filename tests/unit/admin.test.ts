import { describe, expect, it } from "vitest";
import { parseAuthor, parseEdition, parseTerm, parseWork } from "@/lib/admin/forms";
import { countChapters, parseNav, parseNcx } from "@/lib/epub/toc";

const A1 = "a0000000-0000-0000-0000-000000000001";
const A2 = "a0000000-0000-0000-0000-000000000002";
const G1 = "c0000000-0000-0000-0000-000000000001";

function form(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
  return fd;
}

const work = {
  slug: "pather-panchali",
  title_bn: "পথের পাঁচালী",
  title_en: "Pather Panchali",
  title_latn: "pather panchali",
  form: "novel",
  status: "draft",
  author_id: [A1],
  author_role: ["author"],
};

describe("work form", () => {
  it("accepts a complete work", () => {
    const r = parseWork(form({ ...work, original_pub_year: "১৯২৯", genre: [G1, G1, "nonsense"], cover_variant: "7" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.original_pub_year).toBe(1929); // Bengali digits count
    expect(r.value.genres).toEqual([G1]); // deduplicated, junk dropped
    expect(r.value.cover_variant).toBe(7);
    expect(r.value.authors).toEqual([{ id: A1, role: "author" }]);
  });

  it("explains what is wrong, field by field", () => {
    const r = parseWork(form({ ...work, slug: "Pather Panchali", title_en: "", original_pub_year: "3000", form: "epic", featured_rank: "x" }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toMatchObject({ slug: "slug", title_en: "required", original_pub_year: "year", form: "choice", featured_rank: "number" });
  });

  it("needs an author (a translator alone is not enough), and drops repeated credits", () => {
    const none = parseWork(form({ ...work, author_id: [A2], author_role: ["translator"] }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors.authors).toBe("credits");
    const twice = parseWork(form({ ...work, author_id: [A1, A1, A2], author_role: ["author", "author", "translator"] }));
    expect(twice.ok && twice.value.authors).toEqual([
      { id: A1, role: "author" },
      { id: A2, role: "translator" },
    ]);
  });

  it("will not record a verification without a reason", () => {
    const r = parseWork(form({ ...work, rights_verified: "on" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.rights_basis).toBe("required");
  });
});

describe("author, edition and genre forms", () => {
  it("checks life years and identifiers", () => {
    const r = parseAuthor(form({ slug: "x", name_bn: "ক", name_en: "K", status: "draft", born_year: "1900", died_year: "1890", wikidata_id: "12" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toMatchObject({ died_year: "years", wikidata_id: "wikidata" });
    expect(parseAuthor(form({ slug: "x", name_bn: "ক", name_en: "K", status: "published", wikidata_id: "Q7241", wikisource_url: "https://bn.wikisource.org/wiki/x" })).ok).toBe(true);
  });

  it("needs a source link and licence for an edition", () => {
    const r = parseEdition(form({ work_id: A1, source_name: "উইকিসংকলন", source_url: "javascript:alert(1)", license: "", status: "draft" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toMatchObject({ source_url: "url", license: "required" });
  });

  it("reads a genre", () => {
    const r = parseTerm(form({ slug: "romance", name_bn: "প্রেম", name_en: "Romance", position: "৩" }), false);
    expect(r.ok && r.value).toMatchObject({ slug: "romance", position: 3, status: null });
  });
});

describe("table of contents from an EPUB", () => {
  it("reads a nested nav document", () => {
    const nav = `<?xml version="1.0"?><html xmlns:epub="http://www.idpf.org/2007/ops"><body>
      <nav epub:type="toc" id="toc"><h1>সূচি</h1><ol>
        <li><a href="part1.xhtml">প্রথম খণ্ড</a><ol>
          <li><a href="c1.xhtml">প্রথম &amp; পরিচ্ছেদ</a></li>
          <li><a href="c2.xhtml#x">দ্বিতীয় পরিচ্ছেদ</a></li>
        </ol></li>
        <li><span>দ্বিতীয় খণ্ড</span><ol><li><a href="c3.xhtml">তৃতীয় পরিচ্ছেদ</a></li></ol></li>
      </ol></nav>
      <nav epub:type="landmarks"><ol><li><a href="c1.xhtml">Start</a></li></ol></nav></body></html>`;
    const toc = parseNav(nav);
    expect(toc).toEqual([
      {
        label: "প্রথম খণ্ড",
        href: "part1.xhtml",
        children: [
          { label: "প্রথম & পরিচ্ছেদ", href: "c1.xhtml" },
          { label: "দ্বিতীয় পরিচ্ছেদ", href: "c2.xhtml#x" },
        ],
      },
      { label: "দ্বিতীয় খণ্ড", href: "", children: [{ label: "তৃতীয় পরিচ্ছেদ", href: "c3.xhtml" }] },
    ]);
    expect(countChapters(toc)).toBe(3);
  });

  it("falls back to an EPUB 2 NCX", () => {
    const ncx = `<ncx><navMap>
      <navPoint id="a"><navLabel><text>এক</text></navLabel><content src="1.xhtml"/>
        <navPoint id="b"><navLabel><text>এক-ক</text></navLabel><content src="1a.xhtml"/></navPoint>
      </navPoint>
      <navPoint id="c"><navLabel><text>দুই</text></navLabel><content src="2.xhtml"/></navPoint>
    </navMap></ncx>`;
    expect(parseNcx(ncx)).toEqual([
      { label: "এক", href: "1.xhtml", children: [{ label: "এক-ক", href: "1a.xhtml" }] },
      { label: "দুই", href: "2.xhtml" },
    ]);
  });
});
