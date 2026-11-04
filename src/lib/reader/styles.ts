import { READER_FONT_FACES } from "./font-faces";
import { FONTS, THEMES, type ReaderSettings } from "./settings";

/**
 * CSS injected into every EPUB section (foliate renderer.setStyles).
 * Overrides publisher typography where it fights readability, keeps
 * structural styles (centring, poems, headings) from the book.
 */
export function readerCss(s: ReaderSettings, origin: string): string {
  const theme = THEMES[s.theme];
  const font = FONTS[s.font].family;
  // sections are blob: documents, where root-relative URLs cannot resolve
  const faces = READER_FONT_FACES.replaceAll("url(/fonts/", `url(${origin}/fonts/`);
  return `${faces}
@namespace epub "http://www.idpf.org/2007/ops";
html {
  color-scheme: ${s.theme === "dark" ? "dark" : "light"};
  background: ${theme.paper} !important;
  color: ${theme.ink} !important;
  font-size: ${(s.fontSize / 100) * 19}px !important;
  -webkit-text-size-adjust: 100%;
  text-rendering: optimizeLegibility;
}
body {
  background: transparent !important;
  color: inherit !important;
  font-family: ${font} !important;
  line-height: ${s.lineHeight} !important;
  hyphens: none !important;
  word-break: normal;
  overflow-wrap: break-word;
  font-kerning: normal;
}
p, li, blockquote, dd, td, div {
  font-family: inherit !important;
  line-height: inherit !important;
  text-align: ${s.justify ? "justify" : "start"};
  ${s.justify ? "text-justify: inter-word;" : ""}
}
p { margin-top: 0; margin-bottom: 0; }
.center, .center p { text-align: center !important; }
.right { text-align: right !important; }
h1, h2, h3, h4 {
  font-family: "Tiro Bangla", ${font} !important;
  font-weight: normal !important;
  line-height: 1.45 !important;
  color: inherit !important;
  text-align: center;
  break-after: avoid;
}
h1.part { font-size: 1.55em; margin: 2.5em 0 1.6em; }
h2.chapter-title { font-size: 1.3em; margin: 1.6em 0 1.5em; }
a { color: ${theme.link} !important; text-decoration-thickness: 1px; text-underline-offset: 0.2em; }
::selection { background: ${theme.selection}; }
img, svg { max-width: 100%; height: auto; }
.poem { margin-inline-start: 1.2em; }
.poem p { text-align: start !important; text-indent: 0 !important; margin-bottom: 0.9em; }
.footnotes, .colophon { color: ${theme.muted} !important; }
.title-page, .title-page * { text-align: center !important; text-indent: 0 !important; }
.title-page { padding-top: 22% !important; }
.title-page h1 { font-size: 2.2em; margin-top: 0; }
.title-page .author { color: ${theme.muted}; }
`;
}

/** Strips active content from EPUB XHTML before rendering (CSP is the primary guard). */
export function sanitizeSection(xhtml: string): string {
  return xhtml
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<script\b[^>]*\/>/gi, "")
    .replace(/<(iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|xlink:href)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');
}
