/**
 * Generic EPUB 3.3 assembler for OpenBanglaBooks.
 *
 * The Wikisource ingestion path has its own specialised builder; this one
 * exists for PDF-sourced books (and, eventually, publisher uploads) and is
 * deliberately stricter about accessibility, page lists and cover semantics.
 * Output is deterministic: sorted entries, fixed mtimes, stored mimetype.
 */
import { createHash } from "node:crypto";
import { zipSync, strToU8 } from "fflate";
import { escapeAttr, escapeText } from "./xhtml.ts";

export type EpubAsset = {
  id: string;
  /** Path relative to OEBPS/, e.g. `images/img-001.jpg` or `fonts/noto.woff2`. */
  href: string;
  mediaType: string;
  data: Uint8Array;
  properties?: string;
};

export type EpubSection = {
  id: string;
  label: string;
  /** Body XHTML fragment, already sanitised. */
  xhtml: string;
  epubType?: string;
  part?: string;
};

export type EpubTocEntry = {
  label: string;
  /** Section id, optionally with a fragment, e.g. `c001` or `c001#page-12`. */
  href: string;
  children?: EpubTocEntry[];
};

export type EpubPage = { label: string; href: string };

export type EpubMetadata = {
  identifier: string;
  title: string;
  titleEn?: string;
  subtitle?: string;
  author: string;
  authorEn?: string;
  authorSort?: string;
  language: string;
  publisher?: string;
  firstPublished?: number;
  sourceUrl?: string;
  sourceName?: string;
  rights?: string;
  license?: string;
  licenseUrl?: string;
  description?: string;
  subjects?: string[];
  modified: string;
  ocrModel?: string;
};

export type EpubBookInput = {
  meta: EpubMetadata;
  sections: EpubSection[];
  assets: EpubAsset[];
  toc: EpubTocEntry[];
  pageList?: EpubPage[];
  coverImageId?: string;
  css: string;
};

export type BuildResult = {
  bytes: Uint8Array;
  sha256: string;
  toc: EpubTocEntry[];
};

const FIXED_MTIME = new Date("2026-01-01T00:00:00Z");
const OEBPS = "OEBPS";

const xhtmlDoc = (title: string, lang: string, body: string, bodyClass?: string, cssHref = "styles.css") =>
  `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeAttr(lang)}" lang="${escapeAttr(lang)}">
<head>
<meta charset="utf-8"/>
<title>${escapeText(title)}</title>
<link rel="stylesheet" type="text/css" href="${escapeAttr(cssHref)}"/>
</head>
<body${bodyClass ? ` class="${escapeAttr(bodyClass)}"` : ""}>
${body}
</body>
</html>
`;

const sectionPath = (id: string) => `chapters/${id}.xhtml`;
const relink = (href: string) => {
  if (/^(?:[a-z]+:)?\/\//i.test(href) || href.startsWith("#")) return href;
  if (href.startsWith("chapters/")) return href;
  return `chapters/${href}`;
};

export function buildEpub(input: EpubBookInput): BuildResult {
  const { meta } = input;
  const files: Record<string, Uint8Array> = {};
  const add = (path: string, content: string | Uint8Array) =>
    (files[path] = typeof content === "string" ? strToU8(content) : content);

  const coverAsset = input.coverImageId
    ? input.assets.find((a) => a.id === input.coverImageId)
    : undefined;

  // Cover page.
  if (coverAsset) {
    add(
      `${OEBPS}/cover.xhtml`,
      xhtmlDoc(
        meta.title,
        meta.language,
        `<section epub:type="cover" class="cover-page"><img src="${escapeAttr(coverAsset.href)}" alt="${escapeAttr(meta.title)}"/></section>`,
        "cover",
      ),
    );
  }

  // Sections.
  for (const section of input.sections) {
    const type = section.epubType ?? "chapter";
    add(
      `${OEBPS}/${sectionPath(section.id)}`,
      xhtmlDoc(
        section.label,
        meta.language,
        `<section epub:type="${escapeAttr(type)}" id="${escapeAttr(section.id)}">\n${section.xhtml}\n</section>`,
        type,
        "../styles.css",
      ),
    );
  }

  add(`${OEBPS}/styles.css`, input.css);
  for (const asset of input.assets) add(`${OEBPS}/${asset.href}`, asset.data);
  add(`${OEBPS}/nav.xhtml`, navDoc(input));
  add(`${OEBPS}/toc.ncx`, ncxDoc(input));
  add(`${OEBPS}/content.opf`, opfDoc(input, coverAsset));
  add(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${OEBPS}/content.opf" media-type="application/oebps-package+xml"/>
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
  return { bytes, sha256, toc: input.toc };
}

function navDoc(input: EpubBookInput): string {
  const { meta } = input;
  const list = (entries: EpubTocEntry[]): string =>
    `<ol>\n${entries
      .map(
        (e) =>
          `<li><a href="${escapeAttr(relink(e.href))}">${escapeText(e.label)}</a>${
            e.children?.length ? "\n" + list(e.children) : ""
          }</li>`,
      )
      .join("\n")}\n</ol>`;
  const firstBody = input.sections.find((s) => s.epubType !== "titlepage" && s.epubType !== "frontmatter");
  const title = input.sections.find((s) => s.epubType === "titlepage");
  const colophon = input.sections.find((s) => s.epubType === "colophon");
  const pageList = input.pageList ?? [];
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeAttr(meta.language)}" lang="${escapeAttr(meta.language)}">
<head><meta charset="utf-8"/><title>${escapeText(meta.title)} — সূচিপত্র</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>
<body>
<nav epub:type="toc" id="toc" role="doc-toc">
<h1>সূচিপত্র</h1>
${list(input.toc)}
</nav>
<nav epub:type="landmarks" id="landmarks" hidden="hidden">
<ol>
${title ? `<li><a epub:type="titlepage" href="${escapeAttr(sectionPath(title.id))}">শিরোনাম</a></li>` : ""}
${firstBody ? `<li><a epub:type="bodymatter" href="${escapeAttr(sectionPath(firstBody.id))}">শুরু</a></li>` : ""}
${colophon ? `<li><a epub:type="colophon" href="${escapeAttr(sectionPath(colophon.id))}">উৎস ও স্বত্ব</a></li>` : ""}
<li><a epub:type="toc" href="nav.xhtml">সূচিপত্র</a></li>
</ol>
</nav>
${
  pageList.length
    ? `<nav epub:type="page-list" id="page-list" hidden="hidden">\n<ol>\n${pageList
        .map((p) => `<li><a href="${escapeAttr(relink(p.href))}">${escapeText(p.label)}</a></li>`)
        .join("\n")}\n</ol>\n</nav>`
    : ""
}
</body>
</html>
`;
}

function ncxDoc(input: EpubBookInput): string {
  const { meta } = input;
  let order = 0;
  const points = (entries: EpubTocEntry[]): string =>
    entries
      .map((e) => {
        order++;
        return `<navPoint id="np${order}" playOrder="${order}"><navLabel><text>${escapeText(e.label)}</text></navLabel><content src="${escapeAttr(relink(e.href))}"/>${e.children ? points(e.children) : ""}</navPoint>`;
      })
      .join("\n");
  const pages = input.pageList ?? [];
  const pageTargets = pages.length
    ? `<pageList>\n${pages
        .map(
          (p, i) =>
            `<pageTarget id="pt${i + 1}" type="normal" value="${escapeAttr(p.label)}"><navLabel><text>${escapeText(p.label)}</text></navLabel><content src="${escapeAttr(relink(p.href))}"/></pageTarget>`,
        )
        .join("\n")}\n</pageList>`
    : "";
  const depth = tocDepth(input.toc);
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${escapeAttr(meta.language)}">
<head><meta name="dtb:uid" content="${escapeAttr(meta.identifier)}"/><meta name="dtb:depth" content="${depth}"/></head>
<docTitle><text>${escapeText(meta.title)}</text></docTitle>
<navMap>
${points(input.toc)}
</navMap>
${pageTargets}
</ncx>
`;
}

function tocDepth(entries: EpubTocEntry[]): number {
  let depth = 0;
  for (const entry of entries) {
    depth = Math.max(depth, 1 + (entry.children?.length ? tocDepth(entry.children) : 0));
  }
  return Math.max(1, depth);
}

function opfDoc(input: EpubBookInput, coverAsset?: EpubAsset): string {
  const { meta } = input;
  const manifest: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    `<item id="css" href="styles.css" media-type="text/css"/>`,
  ];
  if (coverAsset) manifest.push(`<item id="cover-image" href="${escapeAttr(coverAsset.href)}" media-type="${escapeAttr(coverAsset.mediaType)}" properties="cover-image"/>`);
  if (coverAsset) manifest.push(`<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`);
  for (const asset of input.assets) {
    if (asset.id === "cover-image") continue;
    if (asset.mediaType.startsWith("image/")) {
      manifest.push(
        `<item id="${escapeAttr(asset.id)}" href="${escapeAttr(asset.href)}" media-type="${escapeAttr(asset.mediaType)}"${asset.properties ? ` properties="${escapeAttr(asset.properties)}"` : ""}/>`,
      );
    }
  }
  for (const section of input.sections) {
    manifest.push(
      `<item id="${escapeAttr(section.id)}" href="${escapeAttr(sectionPath(section.id))}" media-type="application/xhtml+xml"/>`,
    );
  }
  // Fonts and other non-image assets.
  for (const asset of input.assets) {
    if (asset.mediaType.startsWith("image/")) continue;
    manifest.push(
      `<item id="${escapeAttr(asset.id)}" href="${escapeAttr(asset.href)}" media-type="${escapeAttr(asset.mediaType)}"${asset.properties ? ` properties="${escapeAttr(asset.properties)}"` : ""}/>`,
    );
  }

  const spine = ["cover", ...input.sections.map((s) => s.id)]
    .filter((id) => id !== "cover" || coverAsset)
    .map((id) => `<itemref idref="${escapeAttr(id)}"/>`)
    .join("\n");
  const subjects = (meta.subjects ?? []).map((s) => `<dc:subject>${escapeText(s)}</dc:subject>`).join("\n");
  const description = meta.description ? `<dc:description>${escapeText(meta.description)}</dc:description>` : "";
  const rights = meta.license
    ? `${meta.license}${meta.licenseUrl ? ` — ${meta.licenseUrl}` : ""}`
    : meta.rights ?? "";
  const source = [meta.sourceName, meta.sourceUrl].filter(Boolean).join(" — ");
  const pageFeatures = (input.pageList?.length ?? 0) > 0 ? `<meta property="schema:accessibilityFeature">printPageNumbers</meta>` : "";
  const hasImages = input.assets.some((a) => a.mediaType.startsWith("image/"));

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${escapeAttr(meta.language)}" prefix="schema: http://schema.org/">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="uid">${escapeText(meta.identifier)}</dc:identifier>
<dc:title id="title">${escapeText(meta.title)}</dc:title>
<meta refines="#title" property="title-type">main</meta>
${meta.subtitle ? `<dc:title id="subtitle">${escapeText(meta.subtitle)}</dc:title><meta refines="#subtitle" property="title-type">subtitle</meta>` : ""}
<dc:creator id="author">${escapeText(meta.author)}</dc:creator>
<meta refines="#author" property="role" scheme="marc:relators">aut</meta>
${meta.authorSort ? `<meta refines="#author" property="file-as">${escapeText(meta.authorSort)}</meta>` : ""}
<dc:language>${escapeText(meta.language)}</dc:language>
${meta.firstPublished ? `<dc:date>${meta.firstPublished}</dc:date>` : ""}
${meta.publisher ? `<dc:publisher>${escapeText(meta.publisher)}</dc:publisher>` : ""}
${source ? `<dc:source>${escapeText(source)}</dc:source>` : ""}
${rights ? `<dc:rights>${escapeText(rights)}</dc:rights>` : ""}
${description}
${subjects}
<dc:contributor id="bkp">OpenBanglaBooks</dc:contributor>
<meta refines="#bkp" property="role" scheme="marc:relators">bkp</meta>
<meta property="dcterms:modified">${escapeText(meta.modified)}</meta>
<meta property="rendition:layout">reflowable</meta>
<meta property="rendition:flow">paginated</meta>
<meta property="rendition:spread">auto</meta>
<meta property="schema:accessMode">textual</meta>
${hasImages ? `<meta property="schema:accessMode">visual</meta>` : ""}
<meta property="schema:accessModeSufficient">textual</meta>
<meta property="schema:accessibilityFeature">structuralNavigation</meta>
<meta property="schema:accessibilityFeature">tableOfContents</meta>
<meta property="schema:accessibilityFeature">readingOrder</meta>
${hasImages ? `<meta property="schema:accessibilityFeature">alternativeText</meta>` : ""}
${pageFeatures}
<meta property="schema:accessibilityHazard">none</meta>
<meta property="schema:accessibilitySummary">${escapeText(
    `A reflowable ${meta.language} book with a table of contents, reading order and page navigation.${hasImages ? " Figures have text alternatives." : ""}`,
  )}</meta>
${coverAsset ? `<meta name="cover" content="cover-image"/>` : ""}
</metadata>
<manifest>
${manifest.join("\n")}
</manifest>
<spine toc="ncx">
${spine}
</spine>
</package>
`;
}
