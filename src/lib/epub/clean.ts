/**
 * Cleaning a reader's own EPUB (personal import), in the browser.
 *
 * Catalogue books are rebuilt from a whitelist (xhtml.ts). A reader's own
 * book is someone else's markup, so it is kept as written, minus everything
 * active or remote:
 *
 * - elements that run code, load other documents or take input (script,
 *   iframe, object, embed, form…), SVG animation (it can rewrite links), and
 *   <base> / <meta http-equiv>
 * - event handler attributes, and `style` values with remote URLs or legacy
 *   script hooks (expression(), behavior, -moz-binding)
 * - URLs: resources must be inside the book (relative), or small inline
 *   images; links may also go to the web (http, https, mailto), which the
 *   reader opens outside the book
 * - CSS: remote @import and url() are removed
 *
 * The result is serialised as well-formed XML. Markup that is not valid XML
 * is parsed as HTML and written out as XHTML, which repairs it. Comments and
 * processing instructions are dropped. Works with any DOM implementation
 * (the browser's, or linkedom in tests).
 */

type DomParserLike = { parseFromString(text: string, type: string): Document };

const XHTML_NS = "http://www.w3.org/1999/xhtml";
const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const MATHML_NS = "http://www.w3.org/1998/Math/MathML";
const EPUB_NS = "http://www.idpf.org/2007/ops";

/** Removed with everything inside them. Names are compared without a namespace prefix, lower-cased. */
const DROP = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "base",
  "portal",
  "template",
  "noscript",
  "animate",
  "animatemotion",
  "animatetransform",
  "animatecolor",
  "set",
  "handler",
  "listener",
]);

const VOID_HTML = new Set(["area", "br", "col", "hr", "img", "wbr", "source", "track", "link", "meta"]);

/** Attributes holding a URL that loads something (vs. a link the reader follows). */
const RESOURCE_ATTRS = new Set(["src", "poster", "background", "data", "codebase", "longdesc", "lowsrc", "dynsrc", "manifest", "cite", "icon"]);
const LINK_ATTRS = new Set(["href", "xlink:href"]);
const DROP_ATTRS = new Set(["srcset", "imagesrcset", "ping", "action", "formaction", "xml:base", "integrity", "nonce", "autofocus", "contenteditable"]);

const local = (name: string) => name.slice(name.indexOf(":") + 1).toLowerCase();

/** A URL inside the book: relative, no scheme, no protocol-relative host. */
function isInBook(url: string): boolean {
  const u = url.trim();
  if (!u) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return false;
  if (u.startsWith("//") || u.startsWith("\\\\")) return false;
  return true;
}
const SAFE_IMAGE_DATA = /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;
const WEB_LINK = /^(https?:\/\/|mailto:)/i;

function cleanResourceUrl(url: string): string | null {
  if (isInBook(url)) return url;
  if (SAFE_IMAGE_DATA.test(url.trim())) return url;
  return null;
}
function cleanLinkUrl(url: string, element: string, attr: string): string | null {
  if (isInBook(url)) return url;
  // links the reader can follow out of the book; never on <use>, <image>, <link>…
  if (element === "a" && WEB_LINK.test(url.trim())) return url.trim();
  if (attr === "href" && element !== "a" && element !== "area") return null;
  return SAFE_IMAGE_DATA.test(url.trim()) && element === "image" ? url : null;
}

/** Cleans a stylesheet (a .css file, a <style> element or a style attribute). */
export function cleanCss(css: string): string {
  return (
    css
      // CSS escapes could hide the patterns below: decode them first
      .replace(/\\([0-9a-f]{1,6})\s?/gi, (_, hex: string) => {
        const cp = parseInt(hex, 16);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
      })
      .replace(/\\(.)/g, "$1")
      .replace(/@import\s+(url\()?\s*(["']?)([^"')\s;]+)\2\s*\)?[^;]*;?/gi, (m, _u, _q, href: string) => (isInBook(href) ? m : ""))
      .replace(/url\(\s*(["']?)([^"')]*)\1\s*\)/gi, (m, _q, href: string) => (cleanResourceUrl(href) !== null ? m : "none"))
      .replace(/expression\s*\(/gi, "invalid(")
      .replace(/(behavior|-moz-binding|-ms-behavior)\s*:/gi, "x-blocked:")
  );
}

function escapeText(s: string) {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
const escapeAttr = (s: string) => escapeText(s).replace(/"/g, "&quot;");

type Options = { html: boolean };

function serializeNode(node: Node, out: string[], opts: Options, inStyle: boolean) {
  switch (node.nodeType) {
    case 1: {
      const el = node as Element;
      // HTML parsing already gives lower-case HTML names and camel-cased SVG ones (viewBox)
      const name = opts.html ? el.localName : el.tagName;
      const bare = local(name);
      if (DROP.has(bare)) return;
      if (bare === "meta" && el.getAttribute("http-equiv")) return;
      if (bare === "link" && !/(^|\s)stylesheet(\s|$)/i.test(el.getAttribute("rel") ?? "")) return;
      out.push("<", name);
      if (opts.html) {
        // namespaces an HTML parse leaves implicit
        const parentNs = (el.parentNode as Element | null)?.namespaceURI;
        if (name === "html") {
          if (!el.hasAttribute("xmlns")) out.push(` xmlns="${XHTML_NS}"`);
          if (!el.hasAttribute("xmlns:epub")) out.push(` xmlns:epub="${EPUB_NS}"`);
        } else if (el.namespaceURI === SVG_NS && parentNs !== SVG_NS) out.push(` xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"`);
        else if (el.namespaceURI === MATHML_NS && parentNs !== MATHML_NS) out.push(` xmlns="${MATHML_NS}"`);
      }
      for (const attr of Array.from(el.attributes)) {
        const a = attr.name;
        const al = a.toLowerCase();
        if (al.startsWith("on") || DROP_ATTRS.has(al)) continue;
        if (opts.html && (al === "xmlns" || al.startsWith("xmlns:"))) continue; // declared above
        if (opts.html && al.includes(":") && !/^(xml|xlink|epub):/.test(al)) continue; // stray prefixes in tag soup
        let value: string | null = attr.value;
        if (al === "style") value = cleanCss(value);
        else if (RESOURCE_ATTRS.has(local(al))) value = cleanResourceUrl(value);
        else if (LINK_ATTRS.has(al)) value = cleanLinkUrl(value, bare, al);
        else if (/^\s*(javascript|vbscript|data):/i.test(value) && !al.startsWith("xmlns")) value = null;
        if (value === null) continue;
        out.push(" ", a, '="', escapeAttr(value), '"');
      }
      const children = Array.from(el.childNodes);
      if (!children.length && (!opts.html || VOID_HTML.has(bare))) {
        out.push("/>");
        return;
      }
      out.push(">");
      if (opts.html && VOID_HTML.has(bare)) {
        out.push(`</${name}>`);
        return;
      }
      const style = bare === "style";
      for (const c of children) serializeNode(c, out, opts, style);
      out.push(`</${name}>`);
      return;
    }
    case 3: // text
    case 4: // CDATA
      out.push(escapeText(inStyle ? cleanCss(node.nodeValue ?? "") : (node.nodeValue ?? "")));
      return;
    default:
      return; // comments, processing instructions, doctypes
  }
}

function parsedOk(doc: Document | null): doc is Document {
  return Boolean(doc?.documentElement) && !doc!.getElementsByTagName("parsererror").length;
}

/**
 * Cleans one markup document (XHTML, HTML or SVG). Returns well-formed XML.
 * `parser` defaults to the browser's DOMParser.
 */
export function cleanMarkup(text: string, mediaType: string, parser: DomParserLike = new DOMParser()): string {
  const svg = /svg/.test(mediaType);
  let doc: Document | null = null;
  try {
    doc = parser.parseFromString(text, svg ? "image/svg+xml" : "application/xhtml+xml");
  } catch {
    doc = null;
  }
  const out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>\n'];
  if (parsedOk(doc)) {
    if (!svg && doc.doctype) out.push("<!DOCTYPE html>\n");
    serializeNode(doc.documentElement, out, { html: false }, false);
    return out.join("");
  }
  if (svg) return `${out[0]}<svg xmlns="http://www.w3.org/2000/svg"/>`; // unreadable SVG: an empty picture
  // not well-formed XML: read it as HTML (forgiving), write it back as XHTML
  const html = parser.parseFromString(text, "text/html");
  out.push("<!DOCTYPE html>\n");
  serializeNode(html.documentElement, out, { html: true }, false);
  return out.join("");
}
