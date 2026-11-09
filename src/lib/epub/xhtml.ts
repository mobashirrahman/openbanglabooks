/**
 * Whitelist XHTML serializer. Walks a DOM tree and emits only allowed elements
 * and attributes, which makes it the sanitizer for ingested book content:
 * scripts, iframes, forms, event handlers, inline styles, external resources
 * and javascript: URLs can never appear in the output because nothing outside
 * the whitelist is serialized. Output is well-formed XHTML.
 */

type AttrRule = (value: string) => string | null;

const keepClass: AttrRule = (v) => {
  const allowed = v
    .split(/\s+/)
    .filter((c) => ALLOWED_CLASSES.has(c))
    .join(" ");
  return allowed || null;
};
const keepId: AttrRule = (v) => (/^[A-Za-z][\w.:-]*$/.test(v) ? v : null);
const keepFragmentHref: AttrRule = (v) => (/^#[\w.:%-]+$/.test(v) ? v : null);
const keepExternalHref: AttrRule = (v) =>
  /^(?:#[\w.:%-]+|https?:\/\/[^\s"'<>]+|mailto:[^\s"'<>]+)$/.test(v) ? v : null;
const keepSpan: AttrRule = (v) => (/^\d{1,2}$/.test(v) ? v : null);
const keepDimension: AttrRule = (v) => (/^\d{1,5}$/.test(v) ? v : null);
const keepText: AttrRule = (v) => (v.trim() ? v : null);
const keepLocalImage: AttrRule = (v) => (/^(?:\.\.\/)?images\/[A-Za-z0-9._-]+$/.test(v) ? v : null);
const keepRole: AttrRule = (v) =>
  /^(?:doc-pagebreak|doc-footnote|doc-endnote|doc-toc|doc-bibliography|presentation|img)$/.test(v) ? v : null;
const keepEpubType: AttrRule = (v) =>
  /^(?:cover|titlepage|frontmatter|bodymatter|chapter|part|colophon|toc|landmarks|pagebreak|footnote|endnotes|dedication|epigraph|preface|introduction|bibliography|index|appendix|afterword|foreword|acknowledgments|contributors|copyright-page|halftitlepage|imprint|other-credits|revision-history|title-page)$/.test(
    v,
  )
    ? v
    : null;

const GLOBAL_ATTRS: Record<string, AttrRule> = {
  class: keepClass,
  id: keepId,
  role: keepRole,
  title: keepText,
  "aria-label": keepText,
  "aria-hidden": (v) => (v === "true" ? v : null),
  "epub:type": keepEpubType,
};

const ELEMENTS: Record<string, Record<string, AttrRule>> = {
  p: {},
  br: {},
  hr: {},
  div: {},
  span: {},
  h1: {},
  h2: {},
  h3: {},
  h4: {},
  b: {},
  strong: {},
  i: {},
  em: {},
  u: {},
  sup: {},
  sub: {},
  small: {},
  blockquote: {},
  ol: {},
  ul: {},
  li: {},
  table: {},
  caption: {},
  thead: {},
  tbody: {},
  tfoot: {},
  tr: {},
  td: { colspan: keepSpan, rowspan: keepSpan },
  th: { colspan: keepSpan, rowspan: keepSpan },
  figure: {},
  figcaption: {},
  img: { src: keepLocalImage, alt: keepText, width: keepDimension, height: keepDimension },
  a: { href: keepFragmentHref },
  abbr: {},
  section: {},
  aside: {},
  nav: {},
};

/** Classes the book stylesheet understands. Everything else is dropped. */
export const ALLOWED_CLASSES = new Set([
  "center",
  "right",
  "poem",
  "stanza",
  "verse",
  "indent",
  "noindent",
  "part",
  "chapter-title",
  "subtitle",
  "small-caps",
  "larger",
  "smaller",
  "footnotes",
  "footnote",
  "noteref",
  "scene-break",
  "title-page",
  "imprint",
  "author",
  "edition",
  "cover-page",
  "colophon",
  "dedication",
  "epigraph",
  "table-wrap",
  "equation",
  "page-anchor",
  "fn-num",
  "fn-back",
  "toc",
  "caption",
  "figure",
]);

const VOID = new Set(["br", "hr", "img"]);
/** Elements whose content is dropped entirely, not just unwrapped. */
const DROP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "iframe",
  "object",
  "embed",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "link",
  "meta",
  "svg",
  "math",
  "picture",
  "video",
  "audio",
  "canvas",
  "head",
  "title",
]);

/** Removes characters that are illegal in XML 1.0. */
const stripInvalidXml = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

export function escapeText(s: string): string {
  return stripInvalidXml(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

type NodeLike = {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<NodeLike>;
  attributes?: ArrayLike<{ name: string; value: string }>;
};

export type SerializeOptions = {
  /**
   * Keep http(s) and mailto links. Off by default: ingested Wikisource text
   * drops external links, while our own generated colophons need them.
   */
  allowExternalLinks?: boolean;
};

export function serializeXhtml(node: NodeLike, options: SerializeOptions = {}): string {
  let out = "";
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) out += serializeNode(children[i], options);
  return out;
}

function serializeNode(node: NodeLike, options: SerializeOptions): string {
  if (node.nodeType === 3) return escapeText(stripInvalidXml(node.nodeValue ?? ""));
  if (node.nodeType !== 1) return ""; // comments, processing instructions…
  const name = node.nodeName.toLowerCase();
  if (DROP.has(name)) return "";
  const rules = ELEMENTS[name];
  if (!rules) return serializeXhtml(node, options); // unknown element: keep its text, drop the tag
  let attrs = "";
  const list = node.attributes ?? [];
  for (let i = 0; i < list.length; i++) {
    const { name: a, value } = list[i];
    let rule = rules[a] ?? GLOBAL_ATTRS[a];
    if (name === "a" && a === "href" && options.allowExternalLinks) rule = keepExternalHref;
    const kept = rule?.(value);
    if (kept != null) attrs += ` ${a}="${escapeAttr(kept)}"`;
  }
  // An image whose src was rejected (remote URL, traversal, javascript:) has
  // nothing left to show; keep its alt text out rather than a broken <img/>.
  if (name === "img" && !/(?:^| )src="/.test(attrs)) return "";
  if (VOID.has(name)) return `<${name}${attrs}/>`;
  const inner = serializeXhtml(node, options);
  if (name === "a" && !/href=/.test(attrs) && !/id=/.test(attrs)) return inner; // plain wiki links → text
  if (name === "span" && !attrs) return inner;
  return `<${name}${attrs}>${inner}</${name}>`;
}
