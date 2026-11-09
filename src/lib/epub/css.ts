/**
 * Book stylesheet for PDF-sourced EPUBs.
 *
 * The site reader overrides fonts and spacing for on-screen reading; this
 * stylesheet is what standalone e-readers (Apple Books, Calibre, KOReader,
 * Kobo, Kindle via conversion) see. Keep it self-contained and conservative.
 */
export function bookCss({ fonts }: { fonts: boolean }): string {
  return `@charset "utf-8";
${
  fonts
    ? `@font-face {
  font-family: "Noto Serif Bengali";
  src: url("fonts/noto-serif-bengali.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Noto Serif Bengali";
  src: url("fonts/noto-serif-bengali-latin.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215;
}
@font-face {
  font-family: "Tiro Bangla";
  src: url("fonts/tiro-bangla.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
`
    : ""
}
html {
  line-height: 1.8;
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}
body {
  margin: 0 5%;
  font-family: ${fonts ? '"Noto Serif Bengali", "Tiro Bangla", ' : ""}"Noto Serif", Georgia, "Times New Roman", serif;
  font-size: 1em;
  line-height: 1.82;
  text-align: start;
  hyphens: none;
  -webkit-hyphens: none;
  widows: 2;
  orphans: 2;
  font-feature-settings: "kern" 1, "liga" 1, "clig" 1;
  text-rendering: optimizeLegibility;
}
p {
  margin: 0;
  text-indent: 1.25em;
  orphans: 2;
  widows: 2;
}
h1 + p, h2 + p, h3 + p, h4 + p,
.part + p, .chapter-title + p, .center + p,
p.noindent, .poem p, figcaption + p, .scene-break + p {
  text-indent: 0;
}
h1, h2, h3, h4 {
  font-family: ${fonts ? '"Tiro Bangla", "Noto Serif Bengali", ' : ""}"Noto Serif", Georgia, serif;
  font-weight: 600;
  line-height: 1.4;
  text-align: center;
  break-after: avoid;
  page-break-after: avoid;
  break-inside: avoid;
  page-break-inside: avoid;
}
h1.part {
  font-size: 1.55em;
  font-weight: 400;
  margin: 2.4em 0 1.5em;
  break-before: page;
  page-break-before: always;
  letter-spacing: 0.02em;
}
h2.chapter-title {
  font-size: 1.4em;
  font-weight: 600;
  margin: 0 0 1.6em;
  padding-top: 0.6em;
  break-before: page;
  page-break-before: always;
  line-height: 1.45;
}
h3.subtitle, h4 {
  font-size: 1.12em;
  font-weight: 600;
  margin: 1.8em 0 0.8em;
}
.center { text-align: center; text-indent: 0; }
.right { text-align: right; text-indent: 0; }
.larger { font-size: 1.12em; }
.smaller { font-size: 0.9em; }
.lead { font-size: 1.06em; }
.scene-break {
  text-align: center;
  text-indent: 0;
  margin: 1.4em 0;
  letter-spacing: 0.35em;
}
blockquote {
  margin: 1.2em 1.6em;
  font-size: 0.96em;
}
.poem, .verse {
  margin: 1.2em 0 1.2em 1.4em;
}
.poem p, .verse p {
  margin: 0 0 0.75em;
  padding-left: 1.4em;
  text-indent: -1.4em;
}
figure {
  margin: 1.4em 0;
  text-align: center;
  break-inside: avoid;
  page-break-inside: avoid;
}
figure img, img {
  max-width: 100%;
  max-height: 92vh;
  height: auto;
  object-fit: contain;
}
figcaption, .caption {
  font-size: 0.88em;
  font-style: italic;
  text-align: center;
  text-indent: 0;
  margin: 0.55em 0 1em;
  line-height: 1.5;
}
table {
  border-collapse: collapse;
  margin: 1.2em auto;
  font-size: 0.9em;
  max-width: 100%;
}
.table-wrap { overflow-x: auto; }
th, td {
  border: 1px solid currentColor;
  padding: 0.25em 0.55em;
  vertical-align: top;
  text-align: start;
}
th { font-weight: 600; }
caption { font-weight: 600; margin-bottom: 0.5em; }
a { color: inherit; text-decoration: underline; text-decoration-thickness: 0.05em; }
sup, sub { font-size: 0.72em; line-height: 0; }
.footnotes {
  margin-top: 2.4em;
  padding-top: 0.8em;
  border-top: 1px solid currentColor;
  font-size: 0.9em;
}
.footnotes h3 { text-align: start; font-size: 1em; margin: 0 0 0.8em; }
.footnote {
  margin: 0 0 0.8em;
  text-indent: 0;
  line-height: 1.6;
}
.footnote p { text-indent: 0; }
.fn-num {
  font-weight: 600;
  margin-inline-end: 0.35em;
}
.fn-back, .noteref {
  text-decoration: none;
  white-space: nowrap;
}
.page-anchor {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
}
.title-page {
  min-height: 80vh;
  padding-top: 16%;
  text-align: center;
}
.title-page .imprint {
  font-size: 0.82em;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  margin: 0 0 3.2em;
  text-indent: 0;
}
.title-page h1 {
  font-size: 2em;
  font-weight: 600;
  line-height: 1.45;
  margin: 0 0 0.7em;
}
.title-page .subtitle {
  font-size: 1.1em;
  font-style: italic;
  margin: 0 0 2.2em;
}
.title-page .author {
  font-size: 1.22em;
  margin: 0 0 3em;
  text-indent: 0;
}
.title-page .edition {
  font-size: 0.9em;
  margin: 0;
  text-indent: 0;
}
.colophon {
  font-size: 0.92em;
}
.colophon p { text-indent: 0; margin: 0 0 0.8em; }
.equation {
  margin: 1.2em 0;
  text-align: center;
  overflow-x: auto;
}
/* Cover and title pages should not acquire body margins. */
body.cover, body.titlepage { margin: 0; }
body.cover { background: #233b30; }
.cover-page {
  margin: 0;
  padding: 0;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #233b30;
}
.cover-page img {
  width: 100%;
  height: 100%;
  max-height: 100vh;
  object-fit: contain;
}
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
@page { margin: 5% 6%; }
`;
}
