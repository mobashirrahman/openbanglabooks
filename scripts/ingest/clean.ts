/**
 * Turns MediaWiki-rendered Wikisource chapter HTML into clean book XHTML.
 * Wikisource-specific removals happen here; the final whitelist serialization
 * (src/lib/epub/xhtml.ts) guarantees nothing unsafe survives.
 */
import { parseHTML } from "linkedom";
import { serializeXhtml } from "../../src/lib/epub/xhtml.ts";

const REMOVE = [
  "style",
  "link",
  "script",
  ".ws-noexport",
  ".noprint",
  ".mw-editsection",
  "#headertemplate",
  ".wikisource-header-template",
  ".footertemplate",
  ".ws-pagenum",
  ".pagenum",
  ".mw-cite-backlink",
  ".reference-text > .mw-cite-backlink",
  "#toc",
  ".toc",
  ".mw-empty-elt",
  "figure",
  "img",
  ".thumb",
  ".mw-references-wrap > h2",
];

const norm = (s: string) =>
  s
    .normalize("NFC")
    .replace(/[​-‍﻿]/g, "")
    .replace(/[\s।.,:;!?\-–—‘’“”"'()[\]]+/g, "")
    .trim();

export type CleanResult = {
  /** XHTML body content (no <body> wrapper), heading first */
  xhtml: string;
  /** plain text, for excerpts and length stats */
  text: string;
};

export function cleanChapter(html: string, label: string, opts: { part?: string } = {}): CleanResult {
  const { document } = parseHTML(`<!doctype html><html><body><main>${html}</main></body></html>`);
  const main = document.querySelector("main")!;

  for (const sel of REMOVE) for (const el of [...main.querySelectorAll(sel)]) el.remove();

  // centred blocks (templates use classes or inline styles)
  for (const el of [...main.querySelectorAll("[style], [class], center")] as HTMLElement[]) {
    const style = (el.getAttribute("style") ?? "").replace(/\s+/g, "");
    const cls = el.getAttribute("class") ?? "";
    const classes: string[] = [];
    if (el.tagName === "CENTER" || /text-align:center/.test(style) || /\b(wst-center|wst-block-center|center)\b/.test(cls))
      classes.push("center");
    if (/text-align:right/.test(style) || /\bwst-right\b/.test(cls)) classes.push("right");
    if (/\bpoem\b/.test(cls)) classes.push("poem");
    if (/font-size:(1[2-9]\d|[2-9]\d\d)%|font-size:(1\.[2-9]|[2-9])em|x+-large|\blarger\b/.test(style + cls)) classes.push("larger");
    if (/font-size:([5-8]\d)%|smaller|\bsmall\b/.test(style + cls)) classes.push("smaller");
    if (/\breference\b/.test(cls)) classes.push("noteref");
    if (/\breferences\b/.test(cls)) classes.push("footnotes");
    if (classes.length) el.setAttribute("class", classes.join(" "));
    else el.removeAttribute("class");
    el.removeAttribute("style");
  }

  // gap/indent spacer spans ({{gap}}) carry only whitespace – CSS indents paragraphs instead
  for (const span of [...main.querySelectorAll("span")]) {
    if (!span.children.length && !/\S/.test((span.textContent ?? "").replace(/ /g, " "))) span.remove();
  }

  // drop paragraphs and divs left empty
  for (const el of [...main.querySelectorAll("p, div")]) {
    if (!el.querySelector("br, hr, table") && !/\S/.test((el.textContent ?? "").replace(/[ ​]/g, " "))) el.remove();
  }

  // Chapter heading: reuse the first block if it repeats the label, otherwise add one.
  const target = norm(label);
  const firstBlocks = [...main.querySelectorAll("p, div, h1, h2, h3, h4, b, strong, span")].slice(0, 6);
  const existing = firstBlocks.find((el) => {
    const t = norm(el.textContent ?? "");
    return t === target || (t.length > 0 && t.length < 60 && t.endsWith(target));
  });
  let headingText = label;
  if (existing) {
    headingText = (existing.textContent ?? label).replace(/\s+/g, " ").trim();
    // remove the block (and an emptied wrapper) – we render our own heading
    const wrapper = existing.closest("p, div") ?? existing;
    if (norm(wrapper.textContent ?? "") === norm(existing.textContent ?? "")) wrapper.remove();
    else existing.remove();
  }

  const body = serializeXhtml(main as unknown as Parameters<typeof serializeXhtml>[0])
    .replace(/(<br\/>\s*){3,}/g, "<br/><br/>")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const partHeading = opts.part ? `<h1 class="part">${esc(opts.part)}</h1>\n` : "";
  const xhtml = `${partHeading}<h2 class="chapter-title">${esc(headingText)}</h2>\n${body}`;
  const text = (main.textContent ?? "").replace(/\s+/g, " ").trim();
  return { xhtml, text };
}
