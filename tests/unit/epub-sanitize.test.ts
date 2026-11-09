import { describe, expect, it } from "vitest";
import { parseHTML } from "linkedom";
import { zipSync, strToU8 } from "fflate";
import { serializeXhtml } from "@/lib/epub/xhtml";
import { validateEpub } from "@/lib/epub/validate";

const cleanWith = (html: string, options: Parameters<typeof serializeXhtml>[1] = {}) => {
  const { document } = parseHTML(`<!doctype html><html><body><main>${html}</main></body></html>`);
  return serializeXhtml(document.querySelector("main") as never, options);
};
const clean = (html: string) => cleanWith(html);

describe("serializeXhtml (sanitizer)", () => {
  it("drops scripts, handlers, iframes, forms and javascript: links", () => {
    const out = clean(
      `<p onclick="steal()">হ্যালো<script>alert(1)</script></p>` +
        `<iframe src="https://evil"></iframe><form><input value="x"></form>` +
        `<a href="javascript:alert(1)">লিংক</a><img src="x" onerror="alert(1)">`,
    );
    expect(out).toBe("<p>হ্যালো</p>লিংক");
    expect(out).not.toMatch(/script|onclick|iframe|form|javascript|onerror|img/);
  });

  it("keeps fragment links and whitelisted classes, drops styles and unknown classes", () => {
    const out = clean(`<p class="center evil" style="color:red"><a href="#cite_note-1" id="cite_ref-1">১</a></p>`);
    expect(out).toBe(`<p class="center"><a href="#cite_note-1" id="cite_ref-1">১</a></p>`);
  });

  it("drops external links but keeps their text", () => {
    expect(clean(`<a href="https://bn.wikisource.org/wiki/X">উৎস</a>`)).toBe("উৎস");
  });

  it("can keep external links for generated colophons", () => {
    expect(cleanWith(`<a href="https://example.org/book">উৎস</a>`, { allowExternalLinks: true })).toBe(
      `<a href="https://example.org/book">উৎস</a>`,
    );
    expect(cleanWith(`<a href="javascript:alert(1)">x</a>`, { allowExternalLinks: true })).toBe("x");
  });

  it("keeps local figures and drops remote or traversal images", () => {
    expect(clean(`<figure><img src="../images/img-001.jpg" alt="চিত্র" width="900" height="600"/></figure>`)).toBe(
      `<figure><img src="../images/img-001.jpg" alt="চিত্র" width="900" height="600"/></figure>`,
    );
    expect(clean(`<img src="https://evil.example/x.png" alt="x"/>`)).toBe("");
    expect(clean(`<img src="../images/../../etc/passwd" alt="x"/>`)).toBe("");
  });

  it("emits well-formed XHTML: escapes text and closes void elements", () => {
    expect(clean(`<p>a &lt; b &amp; c<br>d</p>`)).toBe("<p>a &lt; b &amp; c<br/>d</p>");
  });

  it("preserves Bengali text exactly, including ZWJ/ZWNJ and hasanta", () => {
    const text = "র‍্যাব ক্‌ষ বৎসর য়";
    expect(clean(`<p>${text}</p>`)).toBe(`<p>${text}</p>`);
  });
});

function epub(files: Record<string, string>, opts: { mimetypeFirst?: boolean; compressMimetype?: boolean } = {}) {
  const entries: Record<string, [Uint8Array, { level: 0 | 9 }]> = {};
  const mimetype: [Uint8Array, { level: 0 | 9 }] = [strToU8("application/epub+zip"), { level: opts.compressMimetype ? 9 : 0 }];
  if (opts.mimetypeFirst !== false) entries.mimetype = mimetype;
  for (const [k, v] of Object.entries(files)) entries[k] = [strToU8(v), { level: 9 }];
  if (opts.mimetypeFirst === false) entries.mimetype = mimetype;
  return zipSync(entries);
}

const minimal = {
  "META-INF/container.xml": `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
  "OEBPS/content.opf": `<package version="3.0"><metadata><dc:title>বই</dc:title><dc:language>bn</dc:language></metadata><manifest><item href="c1.xhtml"/></manifest><spine/></package>`,
  "OEBPS/c1.xhtml": "<html><body><p>লেখা</p></body></html>",
};

describe("validateEpub", () => {
  it("accepts a minimal well-formed EPUB", () => {
    const r = validateEpub(epub(minimal));
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.title).toBe("বই");
  });

  it("rejects non-zip data", () => {
    expect(validateEpub(strToU8("not a zip")).ok).toBe(false);
  });

  it("requires a stored mimetype as the first entry", () => {
    expect(validateEpub(epub(minimal, { mimetypeFirst: false })).ok).toBe(false);
    expect(validateEpub(epub(minimal, { compressMimetype: true })).ok).toBe(false);
  });

  it("reports missing manifest items", () => {
    const { ["OEBPS/c1.xhtml"]: _omitted, ...withoutChapter } = minimal;
    const r = validateEpub(epub(withoutChapter));
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toContain("c1.xhtml");
  });

  it("rejects path traversal entries", () => {
    const r = validateEpub(epub({ ...minimal, "../evil.txt": "x" }));
    expect(r.ok).toBe(false);
  });

  it("warns about active content (blocked at render time by CSP)", () => {
    const r = validateEpub(epub({ ...minimal, "OEBPS/c1.xhtml": `<html><body><script>alert(1)</script></body></html>` }));
    expect(r.warnings.some((w) => w.includes("Active content"))).toBe(true);
  });
});
