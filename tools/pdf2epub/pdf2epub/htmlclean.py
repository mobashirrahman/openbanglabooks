"""Clean model/PDF HTML into the small XHTML vocabulary the EPUB uses.

Surya emits HTML from a constrained prompt, but PDF text extraction and the
model can still produce inline styles, data attributes, images with remote
sources, and malformed nesting. This module makes the fragment predictable;
the TypeScript whitelist serialiser is the security boundary.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup, NavigableString, Tag

from .textnorm import normalise_html_text, tidy_bengali

ALLOWED = {
    "p",
    "br",
    "hr",
    "div",
    "span",
    "h1",
    "h2",
    "h3",
    "h4",
    "b",
    "strong",
    "i",
    "em",
    "u",
    "sup",
    "sub",
    "small",
    "blockquote",
    "ol",
    "ul",
    "li",
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "td",
    "th",
    "caption",
    "a",
    "abbr",
    "section",
    "aside",
    "nav",
    "figure",
    "figcaption",
    "img",
    "code",
    "pre",
}

DROP = {
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
    "video",
    "audio",
    "canvas",
    "head",
    "title",
    "font",
    "center",
}

BLOCK_TAGS = {
    "p",
    "div",
    "h1",
    "h2",
    "h3",
    "h4",
    "blockquote",
    "ol",
    "ul",
    "li",
    "figure",
    "figcaption",
    "table",
    "pre",
    "section",
    "aside",
    "nav",
}


def _unwrap(el: Tag) -> None:
    el.unwrap()


def _clean_element(el: Tag) -> None:
    name = el.name.lower()

    if name in DROP:
        # <center> is common in PDF extraction; keep its content and mark it.
        if name == "center":
            el.name = "div"
            el["class"] = "center"
            return
        if name == "font":
            _unwrap(el)
            return
        el.decompose()
        return

    if name not in ALLOWED:
        _unwrap(el)
        return

    attrs = dict(el.attrs)
    el.attrs = {}
    if name == "img":
        src = str(attrs.get("src", ""))
        if not re.fullmatch(r"\.\./images/[A-Za-z0-9._-]+", src):
            el.decompose()
            return
        el["src"] = src
        alt = str(attrs.get("alt", "")).strip()
        el["alt"] = alt or "চিত্র"
        for k in ("width", "height"):
            if str(attrs.get(k, "")).isdigit():
                el[k] = str(attrs[k])
        return

    if name == "a":
        href = str(attrs.get("href", ""))
        if re.fullmatch(r"#[A-Za-z][\w.:-]*", href):
            el["href"] = href
        else:
            _unwrap(el)
            return

    if name in {"td", "th"}:
        for k in ("colspan", "rowspan"):
            v = str(attrs.get(k, ""))
            if v.isdigit() and 1 <= int(v) <= 100:
                el[k] = v

    cls = str(attrs.get("class", ""))
    kept = [c for c in cls.split() if c in ALLOWED_CLASSES]
    if kept:
        el["class"] = " ".join(kept)
    ident = str(attrs.get("id", ""))
    if re.fullmatch(r"[A-Za-z][\w.:-]*", ident):
        el["id"] = ident

    if name in {"b", "strong"}:
        el.name = "strong"
    elif name in {"i", "em"}:
        el.name = "em"
    elif name in {"h1", "h2", "h3", "h4"}:
        pass


ALLOWED_CLASSES = {
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
}


def clean_fragment(html: str) -> str:
    if not html or not html.strip():
        return ""
    soup = BeautifulSoup(f"<main>{html}</main>", "html.parser")
    main = soup.find("main")
    if main is None:
        return ""

    # Work on a snapshot: unwrapping mutates the tree.
    for el in list(main.find_all(True)):
        if el.parent is None:
            continue
        _clean_element(el)

    # Drop empty structural elements, but keep <br>, <hr>, images and anchors.
    for el in list(main.find_all(BLOCK_TAGS)):
        if el.name in {"img", "br", "hr", "a"}:
            continue
        if not el.get_text(strip=True) and not el.find(["img", "br", "hr", "table"]):
            el.decompose()

    # If the fragment has no block-level element, wrap the whole thing in one
    # paragraph. Wrapping only bare text nodes would push an inline <sup> or
    # <em> outside the paragraph the PDF intended.
    has_block = main.find(BLOCK_TAGS) is not None
    if not has_block:
        p = soup.new_tag("p")
        for child in list(main.contents):
            p.append(child.extract())
        main.append(p)
    else:
        for child in list(main.contents):
            if isinstance(child, NavigableString) and child.strip():
                last_paragraph = main.find_all("p")
                if last_paragraph:
                    last_paragraph[-1].append(child.extract())
                else:
                    p = soup.new_tag("p")
                    child.replace_with(p)
                    p.append(child)

    out = "".join(str(c) for c in main.contents)
    out = normalise_html_text(out)
    out = tidy_bengali(out)
    out = re.sub(r"\s+", " ", out)
    out = re.sub(r"\s*</(p|h1|h2|h3|h4|li|tr|div|figure|figcaption|blockquote)>\s*", r"</\1>", out)
    out = re.sub(r"\s*<(p|h1|h2|h3|h4|li|tr|div|figure|figcaption|blockquote)(\s[^>]*)?>\s*", r"<\1\2>", out)
    out = re.sub(r"<p>\s*</p>", "", out)
    return out.strip()


def plain_text(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "html.parser")
    return normalise_html_text(soup.get_text(" "))


def wrap_paragraphs(html: str) -> str:
    """Ensure prose is inside paragraphs (Surya sometimes returns bare text)."""
    html = clean_fragment(html)
    if not html:
        return ""
    if re.match(r"\s*<(p|div|h[1-4]|ul|ol|table|figure|blockquote|pre)\b", html):
        return html
    return f"<p>{html}</p>"
