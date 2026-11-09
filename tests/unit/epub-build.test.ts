import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { buildEpub, type EpubBookInput } from "@/lib/epub/build";
import { bookCss } from "@/lib/epub/css";

function input(overrides: Partial<EpubBookInput> = {}): EpubBookInput {
  return {
    meta: {
      identifier: "urn:uuid:00000000-0000-4000-8000-000000000001",
      title: "নমুনা বই",
      author: "একজন লেখক",
      language: "bn",
      publisher: "OpenBanglaBooks",
      firstPublished: 1932,
      sourceName: "Synthetic sample",
      sourceUrl: "https://example.org/source",
      rights: "Public domain",
      subjects: ["কথাসাহিত্য"],
      modified: "2026-01-01T00:00:00Z",
    },
    sections: [
      {
        id: "title",
        label: "শিরোনাম",
        epubType: "titlepage",
        xhtml: `<div class="title-page"><p class="imprint">OpenBanglaBooks</p><h1>নমুনা বই</h1></div>`,
      },
      {
        id: "c001",
        label: "এক",
        epubType: "chapter",
        xhtml:
          `<h2 class="chapter-title">এক</h2>` +
          `<span id="page-1" class="page-anchor" epub:type="pagebreak" role="doc-pagebreak" title="১"></span>` +
          `<p>লেখা</p>`,
      },
      {
        id: "colophon",
        label: "উৎস ও স্বত্ব",
        epubType: "colophon",
        xhtml: `<div class="colophon"><p>Source: <a href="https://example.org/source">example</a></p></div>`,
      },
    ],
    assets: [
      {
        id: "cover-image",
        href: "images/cover.jpg",
        mediaType: "image/jpeg",
        data: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      },
    ],
    toc: [{ label: "এক", href: "c001" }],
    pageList: [{ label: "১", href: "c001.xhtml#page-1" }],
    coverImageId: "cover-image",
    css: bookCss({ fonts: false }),
    ...overrides,
  };
}

const files = (bytes: Uint8Array) => {
  const entries = unzipSync(bytes);
  return Object.fromEntries(Object.entries(entries).map(([name, data]) => [name, strFromU8(data)]));
};

describe("buildEpub", () => {
  it("writes a deterministic EPUB with stored mimetype and EPUB 3 metadata", () => {
    const a = buildEpub(input());
    const b = buildEpub(input());
    expect(a.sha256).toBe(b.sha256);

    const out = files(a.bytes);
    expect(out.mimetype).toBe("application/epub+zip");
    expect(out["OEBPS/content.opf"]).toContain(`property="dcterms:modified"`);
    expect(out["OEBPS/content.opf"]).toContain(`properties="cover-image"`);
    expect(out["OEBPS/content.opf"]).toContain(`property="schema:accessibilityFeature">printPageNumbers`);
    expect(out["OEBPS/content.opf"]).toContain(`<dc:source>Synthetic sample — https://example.org/source</dc:source>`);
    expect(out["META-INF/container.xml"]).toContain(`full-path="OEBPS/content.opf"`);
  });

  it("writes a real itemref spine, not bare IDs", () => {
    const out = files(buildEpub(input()).bytes);
    const opf = out["OEBPS/content.opf"];
    expect(opf).toContain(`<itemref idref="cover"/>`);
    expect(opf).toContain(`<itemref idref="title"/>`);
    expect(opf).toContain(`<itemref idref="c001"/>`);
    expect(opf).toContain(`<itemref idref="colophon"/>`);
    expect(opf).not.toMatch(/<spine[^>]*>\s*cover\s+title\s/);
  });

  it("links the nav, landmarks, page list and NCX to real chapter files", () => {
    const out = files(buildEpub(input()).bytes);
    const nav = out["OEBPS/nav.xhtml"];
    expect(nav).toContain(`href="chapters/c001.xhtml"`);
    expect(nav).toContain(`epub:type="titlepage" href="chapters/title.xhtml"`);
    expect(nav).toContain(`epub:type="colophon" href="chapters/colophon.xhtml"`);
    expect(nav).toContain(`href="chapters/c001.xhtml#page-1"`);
    expect(out["OEBPS/toc.ncx"]).toContain(`<meta name="dtb:depth" content="1"/>`);
    expect(out["OEBPS/toc.ncx"]).toContain(`src="chapters/c001.xhtml#page-1"`);
  });

  it("renders a cover page that points at the cover image", () => {
    const out = files(buildEpub(input()).bytes);
    expect(out["OEBPS/cover.xhtml"]).toContain(`src="images/cover.jpg"`);
    expect(out["OEBPS/content.opf"]).toContain(`<item id="cover" href="cover.xhtml"`);
  });

  it("nests parts in the nav and reports the real NCX depth", () => {
    const out = files(
      buildEpub(
        input({
          toc: [
            {
              label: "প্রথম খণ্ড",
              href: "c001",
              children: [{ label: "এক", href: "c001" }],
            },
          ],
        }),
      ).bytes,
    );
    expect(out["OEBPS/nav.xhtml"]).toMatch(/প্রথম খণ্ড<\/a>\s*<ol>/);
    expect(out["OEBPS/toc.ncx"]).toContain(`<meta name="dtb:depth" content="2"/>`);
  });

  it("omits the cover page when no cover asset is given", () => {
    const out = files(buildEpub(input({ assets: [], coverImageId: undefined })).bytes);
    expect(out["OEBPS/cover.xhtml"]).toBeUndefined();
    expect(out["OEBPS/content.opf"]).not.toContain(`properties="cover-image"`);
  });
});
