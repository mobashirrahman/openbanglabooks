/**
 * Builds a reflowable EPUB 3 (with an EPUB 2 NCX for older readers) from
 * cleaned chapter XHTML. Output is deterministic: same input → same bytes →
 * same sha256, so files can be cached immutably and annotations anchored to a
 * file hash stay meaningful.
 */
import { zipSync, strToU8 } from "fflate";
import { createHash } from "node:crypto";
import { escapeAttr, escapeText } from "../../src/lib/epub/xhtml.ts";

export type EpubChapter = {
  id: string; // c001
  label: string;
  part?: string;
  xhtml: string; // body content
};

export type EpubMeta = {
  identifier: string; // urn:uuid:… stable per edition
  title: string;
  titleEn?: string;
  author: string;
  language: "bn";
  firstPublished?: number;
  publisher?: string;
  editionYear?: number;
  sourceUrl: string;
  sourceName: string;
  license: string;
  licenseUrl: string;
  /** chapter title → permanent revision URL, for attribution */
  revisions: { title: string; url: string }[];
  modified: string; // ISO, second precision
};

const FIXED_MTIME = new Date("2026-01-01T00:00:00Z");

const BOOK_CSS = `@charset "utf-8";
/* Base typography. The OpenBanglaBooks reader overrides fonts, size and spacing. */
html { line-height: 1.8; }
body { margin: 0; font-family: "Noto Serif Bengali", serif; text-align: start; hyphens: none; }
p { margin: 0; text-indent: 1.5em; orphans: 2; widows: 2; }
h1 + p, h2 + p, h3 + p, .center + p, p.noindent, .poem p { text-indent: 0; }
h1.part { font-size: 1.5em; text-align: center; margin: 2em 0 1.5em; font-weight: normal; break-before: page; }
h2.chapter-title { font-size: 1.3em; text-align: center; margin: 1.5em 0 1.4em; font-weight: normal; line-height: 1.45; }
.center { text-align: center; text-indent: 0; }
.right { text-align: right; }
.larger { font-size: 1.15em; }
.smaller { font-size: 0.88em; }
.poem { margin: 1em 0 1em 1.5em; }
.poem p { margin: 0 0 0.9em; }
blockquote { margin: 1em 1.5em; }
.noteref a { text-decoration: none; }
.footnotes { font-size: 0.88em; margin-top: 2em; border-top: 1px solid currentColor; padding-top: 0.6em; }
.title-page { text-align: center; padding-top: 18%; }
.title-page h1 { font-size: 2em; font-weight: normal; margin: 0 0 0.6em; line-height: 1.4; }
.title-page .author { font-size: 1.2em; margin: 0 0 3em; }
.title-page .edition { font-size: 0.9em; opacity: 0.8; }
.colophon { font-size: 0.9em; }
.colophon p { text-indent: 0; margin: 0 0 0.8em; }
.colophon ol { padding-inline-start: 1.4em; font-size: 0.9em; }
table { border-collapse: collapse; margin: 1em auto; }
td, th { padding: 0.2em 0.6em; vertical-align: top; }
`;

const xhtmlDoc = (title: string, body: string, bodyClass?: string, epubType?: string) =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="bn" lang="bn">
<head>
<meta charset="utf-8"/>
<title>${escapeText(title)}</title>
<link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body${bodyClass ? ` class="${bodyClass}"` : ""}${epubType ? ` epub:type="${epubType}"` : ""}>
<section${epubType ? ` epub:type="${epubType}"` : ""}>
${body}
</section>
</body>
</html>
`;

const bnDigits = (n: number) => n.toLocaleString("bn-BD", { useGrouping: false });

export function buildEpub(meta: EpubMeta, chapters: EpubChapter[]): { bytes: Uint8Array; sha256: string; toc: TocEntry[] } {
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, content: string) => (files[path] = strToU8(content));

  // title page
  const editionLine = [meta.publisher, meta.editionYear ? `${bnDigits(meta.editionYear)} সংস্করণ` : undefined]
    .filter(Boolean)
    .join(", ");
  add(
    "OEBPS/title.xhtml",
    xhtmlDoc(
      meta.title,
      `<div class="title-page">
<h1>${escapeText(meta.title)}</h1>
<p class="author">${escapeText(meta.author)}</p>
${editionLine ? `<p class="edition">${escapeText(editionLine)}</p>` : ""}
</div>`,
      undefined,
      "titlepage",
    ),
  );

  // chapters; part heading only on the first chapter of each part
  let lastPart: string | undefined;
  for (const ch of chapters) {
    let body = ch.xhtml;
    if (ch.part && ch.part === lastPart) body = body.replace(/^<h1 class="part">[\s\S]*?<\/h1>\n/, "");
    lastPart = ch.part;
    add(`OEBPS/${ch.id}.xhtml`, xhtmlDoc(ch.label, body, undefined, "chapter"));
  }

  // colophon: source, license, contributors' revisions (CC BY-SA attribution)
  add(
    "OEBPS/colophon.xhtml",
    xhtmlDoc(
      "উৎস ও স্বত্ব",
      `<div class="colophon">
<h2 class="chapter-title">উৎস ও স্বত্ব</h2>
<p>এই বইয়ের পাঠ <a href="${escapeAttr(meta.sourceUrl)}">${escapeText(meta.sourceName)}</a> থেকে নেওয়া। স্বেচ্ছাসেবকেরা মূল মুদ্রিত বইয়ের সঙ্গে মিলিয়ে পাঠটি সংশোধন করেছেন।</p>
<p>মূল রচনা স্বত্বমুক্ত। উইকিসংকলনের প্রতিলিপি ${escapeText(meta.license)} লাইসেন্সে প্রকাশিত: ${escapeText(meta.licenseUrl)}</p>
<p>OpenBanglaBooks পাঠটি বই আকারে সাজিয়েছে; মূল পাঠে কোনো পরিবর্তন করা হয়নি।</p>
<p>ব্যবহৃত পাতার সংস্করণ:</p>
<ol>
${meta.revisions.map((r) => `<li>${escapeText(r.title)} — ${escapeText(r.url)}</li>`).join("\n")}
</ol>
</div>`,
      undefined,
      "colophon",
    ),
  );
  add("OEBPS/styles.css", BOOK_CSS);

  // TOC (nested by part)
  const toc = buildToc(chapters);
  add("OEBPS/nav.xhtml", navDoc(meta, toc));
  add("OEBPS/toc.ncx", ncxDoc(meta, toc));

  const spine = ["title", ...chapters.map((c) => c.id), "colophon"];
  add("OEBPS/content.opf", opfDoc(meta, chapters, spine));
  add(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`,
  );

  const ordered: Record<string, [Uint8Array, { level: 0 | 9; mtime: Date }]> = {
    mimetype: [strToU8("application/epub+zip"), { level: 0, mtime: FIXED_MTIME }],
  };
  for (const path of Object.keys(files).sort()) ordered[path] = [files[path], { level: 9, mtime: FIXED_MTIME }];
  const bytes = zipSync(ordered);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { bytes, sha256, toc };
}

export type TocEntry = { label: string; href: string; children?: TocEntry[] };

function buildToc(chapters: EpubChapter[]): TocEntry[] {
  const out: TocEntry[] = [];
  let currentPart: TocEntry | undefined;
  for (const ch of chapters) {
    const entry = { label: ch.label, href: `${ch.id}.xhtml` };
    if (ch.part) {
      if (!currentPart || currentPart.label !== ch.part) {
        currentPart = { label: ch.part, href: entry.href, children: [] };
        out.push(currentPart);
      }
      currentPart.children!.push(entry);
    } else {
      currentPart = undefined;
      out.push(entry);
    }
  }
  return out;
}

function navDoc(meta: EpubMeta, toc: TocEntry[]) {
  const list = (entries: TocEntry[]): string =>
    `<ol>\n${entries
      .map(
        (e) =>
          `<li><a href="${e.href}">${escapeText(e.label)}</a>${e.children?.length ? "\n" + list(e.children) : ""}</li>`,
      )
      .join("\n")}\n</ol>`;
  const first = toc[0]?.children?.[0]?.href ?? toc[0]?.href ?? "title.xhtml";
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="bn" lang="bn">
<head><meta charset="utf-8"/><title>${escapeText(meta.title)} — সূচিপত্র</title></head>
<body>
<nav epub:type="toc" id="toc">
<h1>সূচিপত্র</h1>
${list(toc)}
</nav>
<nav epub:type="landmarks" hidden="hidden">
<ol>
<li><a epub:type="titlepage" href="title.xhtml">শিরোনাম</a></li>
<li><a epub:type="bodymatter" href="${first}">শুরু</a></li>
<li><a epub:type="colophon" href="colophon.xhtml">উৎস ও স্বত্ব</a></li>
</ol>
</nav>
</body>
</html>
`;
}

function ncxDoc(meta: EpubMeta, toc: TocEntry[]) {
  let order = 0;
  const points = (entries: TocEntry[]): string =>
    entries
      .map((e) => {
        order++;
        return `<navPoint id="np${order}" playOrder="${order}"><navLabel><text>${escapeText(e.label)}</text></navLabel><content src="${e.href}"/>${e.children ? points(e.children) : ""}</navPoint>`;
      })
      .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="bn">
<head><meta name="dtb:uid" content="${escapeAttr(meta.identifier)}"/><meta name="dtb:depth" content="2"/></head>
<docTitle><text>${escapeText(meta.title)}</text></docTitle>
<navMap>
${points(toc)}
</navMap>
</ncx>
`;
}

function opfDoc(meta: EpubMeta, chapters: EpubChapter[], spine: string[]) {
  const items = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles.css" media-type="text/css"/>`,
    `<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapters.map((c) => `<item id="${c.id}" href="${c.id}.xhtml" media-type="application/xhtml+xml"/>`),
    `<item id="colophon" href="colophon.xhtml" media-type="application/xhtml+xml"/>`,
  ];
  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="bn">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${escapeText(meta.identifier)}</dc:identifier>
<dc:title id="title">${escapeText(meta.title)}</dc:title>
<dc:creator id="author">${escapeText(meta.author)}</dc:creator>
<meta refines="#author" property="role" scheme="marc:relators">aut</meta>
<dc:language>${meta.language}</dc:language>
${meta.firstPublished ? `<dc:date>${meta.firstPublished}</dc:date>` : ""}
${meta.publisher ? `<dc:publisher>${escapeText(meta.publisher)}</dc:publisher>` : ""}
<dc:source>${escapeText(meta.sourceUrl)}</dc:source>
<dc:rights>${escapeText(meta.license)} — ${escapeText(meta.licenseUrl)}</dc:rights>
<dc:contributor id="bkp">OpenBanglaBooks</dc:contributor>
<meta refines="#bkp" property="role" scheme="marc:relators">bkp</meta>
<meta property="dcterms:modified">${meta.modified}</meta>
</metadata>
<manifest>
${items.join("\n")}
</manifest>
<spine toc="ncx">
${spine.map((id) => `<itemref idref="${id}"/>`).join("\n")}
</spine>
</package>
`;
}
