import { describe, expect, it } from "vitest";
import { DOMParser } from "linkedom";
import { cleanCss, cleanMarkup } from "@/lib/epub/clean";

const parser = new DOMParser() as unknown as { parseFromString(text: string, type: string): Document };
const clean = (text: string, type = "application/xhtml+xml") => cleanMarkup(text, type, parser);
const page = (body: string, head = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>t</title>${head}</head><body>${body}</body></html>`;

/** Cleaning is stable: cleaning the output again changes nothing (linkedom's XML parser is not strict). */
const wellFormed = (xml: string) => clean(xml) === xml;
/** Like a browser given markup that is not well-formed XML: an error document. */
const strictParser = {
  parseFromString: (text: string, type: string) =>
    type === "application/xhtml+xml" ? parser.parseFromString("<parsererror>not XML</parsererror>", type) : parser.parseFromString(text, type),
};

describe("cleanMarkup (a reader's own EPUB)", () => {
  it("removes scripts, handlers, frames, forms and javascript: links", () => {
    const out = clean(
      page(
        `<p onclick="steal()">হ্যালো<script>alert(1)</script></p><iframe src="https://evil.example"/>` +
          `<form action="https://evil.example"><input value="x"/></form><a href="javascript:alert(1)">লিংক</a>` +
          `<object data="x.swf"/><embed src="x.swf"/>`,
      ),
    );
    expect(out).not.toMatch(/script|onclick|iframe|<form|<input|javascript|<object|<embed/i);
    expect(out).toContain("<p>হ্যালো</p>");
    expect(out).toContain("<a>লিংক</a>");
    expect(wellFormed(out)).toBe(true);
  });

  it("keeps the book's own structure, namespaces, epub:type and local resources", () => {
    const out = clean(
      page(
        `<section epub:type="chapter" id="c1" class="chap"><h1>অধ্যায়</h1><img src="../images/a.jpg" alt="ছবি"/>` +
          `<a href="c2.xhtml#n1">পরে</a><a href="https://bn.wikisource.org/">উৎস</a></section>`,
        `<link rel="stylesheet" href="../styles/book.css"/>`,
      ),
    );
    expect(out).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(out).toContain('epub:type="chapter"');
    expect(out).toContain('<img src="../images/a.jpg" alt="ছবি"/>');
    expect(out).toContain('<a href="c2.xhtml#n1">পরে</a>');
    expect(out).toContain('<a href="https://bn.wikisource.org/">উৎস</a>'); // links out are followed outside the book
    expect(out).toContain('<link rel="stylesheet" href="../styles/book.css"/>');
  });

  it("never loads anything from the web: remote images, stylesheets, srcset, preloads", () => {
    const out = clean(
      page(
        `<img src="https://tracker.example/pixel.gif" alt="x"/><img srcset="https://x.example/a.jpg 2x" src="a.jpg"/>` +
          `<video poster="//cdn.example/p.jpg" src="v.mp4"/>`,
        `<link rel="stylesheet" href="https://fonts.example/css"/><link rel="preload" href="a.woff2"/><meta http-equiv="refresh" content="0;url=https://evil.example"/><base href="https://evil.example/"/>`,
      ),
    );
    expect(out).not.toMatch(/tracker|srcset|cdn\.example|fonts\.example|preload|refresh|<base/);
    expect(out).toContain('<img alt="x"/>');
    expect(out).toContain('src="a.jpg"');
  });

  it("allows small inline images but no inline documents", () => {
    const out = clean(page(`<img src="data:image/png;base64,iVBORw0KGgo="/><img src="data:text/html;base64,PHNjcmlwdD4="/>`));
    expect(out).toContain('src="data:image/png;base64,iVBORw0KGgo="');
    expect(out).not.toContain("data:text/html");
  });

  it("cleans inline styles and style elements", () => {
    const out = clean(page(`<p style="background:url(https://t.example/x.png);color:red">x</p>`, `<style>@import url("https://evil.example/a.css"); p { width: expression(alert(1)) }</style>`));
    expect(out).toContain('style="background:none;color:red"');
    expect(out).not.toMatch(/evil\.example|expression\(/);
  });

  it("repairs markup that is not well-formed XML", () => {
    const out = cleanMarkup(`<html><head><title>x</title></head><body><p>এক<br><p>দুই &nbsp; <b>তিন</p><script>alert(1)</script></body></html>`, "application/xhtml+xml", strictParser);
    expect(wellFormed(out)).toBe(true);
    expect(out).toContain("<p>এক<br/></p><p>দুই \u00a0 <b>তিন</b></p>");
    expect(out).toContain('xmlns="http://www.w3.org/1999/xhtml"');
    expect(out).toContain("<br/>");
    expect(out).toContain("দুই");
    expect(out).not.toContain("script");
  });

  it("cleans SVG: no scripts, animation or remote references", () => {
    const out = clean(
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">` +
        `<script>alert(1)</script><a xlink:href="#x"><animate attributeName="href" to="javascript:alert(1)"/><rect width="5" height="5"/></a>` +
        `<use xlink:href="https://evil.example/s.svg#a"/><image xlink:href="cover.jpg" width="10" height="10"/></svg>`,
      "image/svg+xml",
    );
    expect(out).not.toMatch(/script|animate|evil\.example/);
    expect(out).toContain('xlink:href="cover.jpg"');
    expect(out).toContain('viewBox="0 0 10 10"');
  });
});

describe("cleanCss", () => {
  it("keeps the book's own resources and drops remote ones", () => {
    expect(cleanCss(`@import "local.css"; @import url(https://evil.example/x.css); a { background: url('../img/a.png') }`)).toBe(
      `@import "local.css";  a { background: url('../img/a.png') }`,
    );
    expect(cleanCss(`@font-face { src: url(https://fonts.example/f.woff2) }`)).toBe(`@font-face { src: none }`);
  });

  it("blocks legacy script hooks, even escaped", () => {
    expect(cleanCss(`p { width: expression(alert(1)); behavior: url(x.htc) }`)).not.toMatch(/expression\(|behavior:/);
    expect(cleanCss(`p { background: u\\72l(https://t.example/p.gif) }`)).not.toContain("t.example");
  });
});
