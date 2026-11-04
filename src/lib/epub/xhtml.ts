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
const keepSpan: AttrRule = (v) => (/^\d{1,2}$/.test(v) ? v : null);

const GLOBAL_ATTRS: Record<string, AttrRule> = { class: keepClass, id: keepId };

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
  thead: {},
  tbody: {},
  tr: {},
  td: { colspan: keepSpan, rowspan: keepSpan },
  th: { colspan: keepSpan, rowspan: keepSpan },
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
  "colophon",
  "dedication",
  "epigraph",
]);

const VOID = new Set(["br", "hr"]);
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
  "img",
  "picture",
  "video",
  "audio",
  "canvas",
  "head",
  "title",
]);

export function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

/** Removes characters that are illegal in XML 1.0. */
const stripInvalidXml = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "");

export function serializeXhtml(node: NodeLike): string {
  let out = "";
  const children = node.childNodes;
  for (let i = 0; i < children.length; i++) out += serializeNode(children[i]);
  return out;
}

function serializeNode(node: NodeLike): string {
  if (node.nodeType === 3) return escapeText(stripInvalidXml(node.nodeValue ?? ""));
  if (node.nodeType !== 1) return ""; // comments, processing instructions…
  const name = node.nodeName.toLowerCase();
  if (DROP.has(name)) return "";
  const rules = ELEMENTS[name];
  if (!rules) return serializeXhtml(node); // unknown element: keep its text, drop the tag
  let attrs = "";
  const list = node.attributes ?? [];
  for (let i = 0; i < list.length; i++) {
    const { name: a, value } = list[i];
    const rule = rules[a] ?? GLOBAL_ATTRS[a];
    const kept = rule?.(value);
    if (kept != null) attrs += ` ${a}="${escapeAttr(kept)}"`;
  }
  if (VOID.has(name)) return `<${name}${attrs}/>`;
  const inner = serializeXhtml(node);
  if (name === "a" && !/href=/.test(attrs) && !/id=/.test(attrs)) return inner; // plain wiki links → text
  if (name === "span" && !attrs) return inner;
  return `<${name}${attrs}>${inner}</${name}>`;
}
