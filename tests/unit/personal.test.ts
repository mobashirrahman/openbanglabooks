import { beforeAll, describe, expect, it } from "vitest";
import { DOMParser } from "linkedom";
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { bookOf, fromServer, staysOnDevice, toChange } from "@/lib/sync/tables";
import { validateEpub } from "@/lib/epub/validate";
import { coverVariantFor, isPersonal, personalIdFor, PERSONAL_ID } from "@/lib/personal/ids";
import type { PersonalBook } from "@/lib/local/db";

const device = { id: "dev1", label: "Test" };
const ID = "mine-0123456789abcdef01234567";

describe("own books in sync", () => {
  const deviceOnly = new Set([ID]);

  it("knows which book a row is about", () => {
    expect(bookOf("library", ID, null)).toBe(ID);
    expect(bookOf("positions", ID, null)).toBe(ID);
    expect(bookOf("annotations", "a1", { workSlug: ID })).toBe(ID);
    expect(bookOf("shelfItems", "s:x", { workSlug: "devdas" })).toBe("devdas");
    expect(bookOf("days", "2026-11-05", null)).toBeNull();
  });

  it("keeps every row of a device-only book on the device", () => {
    expect(staysOnDevice("annotations", "a1", { workSlug: ID }, deviceOnly)).toBe(true);
    expect(staysOnDevice("bookmarks", "b1", { workSlug: ID }, deviceOnly)).toBe(true);
    expect(staysOnDevice("library", ID, null, deviceOnly)).toBe(true);
    expect(staysOnDevice("personalBooks", ID, null, deviceOnly)).toBe(true);
    // catalogue books and books kept in the account sync as always
    expect(staysOnDevice("annotations", "a2", { workSlug: "devdas" }, deviceOnly)).toBe(false);
    expect(staysOnDevice("annotations", "a3", { workSlug: "mine-ffffffffffffffffffffffff" }, deviceOnly)).toBe(false);
    expect(staysOnDevice("settings", "goal-minutes", null, deviceOnly)).toBe(false);
  });

  const book: PersonalBook = {
    id: ID,
    fileSha: "a".repeat(64),
    title: "আমার বই",
    author: "কেউ",
    language: "bn",
    bytes: 1234,
    addedAt: 1000,
    cloud: false,
    uploadedAt: null,
    updatedAt: 2000,
  };

  it("never sends the record of a device-only book, and sends a kept one", () => {
    expect(toChange("personalBooks", book, ID, device)).toBeNull();
    const change = toChange("personalBooks", { ...book, cloud: true, uploadedAt: 1500 }, ID, device);
    expect(change).toMatchObject({ t: "personal_books", id: ID, u: 2000, r: { file_sha: "a".repeat(64), title: "আমার বই", author: "কেউ", bytes: 1234, uploaded_at: 1500 } });
  });

  it("a book from the account arrives as kept in the account", () => {
    const target = fromServer("personal_books", { id: ID, updated_at: 3000, deleted: false, version: 4, file_sha: "b".repeat(64), title: "বই", author: null, language: null, bytes: 10, added_at: 100, uploaded_at: 200 }, device);
    expect(target).toMatchObject({ table: "personalBooks", pk: ID, row: { id: ID, cloud: true, fileSha: "b".repeat(64), uploadedAt: 200 } });
    expect(fromServer("personal_books", { id: ID, updated_at: 3000, deleted: true, version: 5 }, device)).toEqual({ table: "personalBooks", pk: ID, row: null });
  });

  it("ids are stable and never look like catalogue slugs", () => {
    const id = personalIdFor("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef");
    expect(id).toBe(ID);
    expect(PERSONAL_ID.test(id)).toBe(true);
    expect(isPersonal(id)).toBe(true);
    expect(isPersonal("devdas")).toBe(false);
    expect(coverVariantFor(id)).toBe(coverVariantFor(id));
    expect(coverVariantFor(id)).toBeGreaterThanOrEqual(0);
    expect(coverVariantFor(id)).toBeLessThan(36);
  });
});

// ── importing a file ─────────────────────────────────────────────────────

const PNG_1PX = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

function epub({ extra = {}, mimetypeFirst = true }: { extra?: Zippable; mimetypeFirst?: boolean } = {}) {
  const files: Zippable = {
    "META-INF/container.xml": strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
    "OEBPS/content.opf": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">x</dc:identifier><dc:title>  আমার   নিজের বই </dc:title><dc:creator>লেখক নাম</dc:creator><dc:language>bn</dc:language></metadata>` +
        `<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="cover" href="images/cover.png" media-type="image/png" properties="cover-image"/></manifest>` +
        `<spine><itemref idref="c1"/></spine></package>`,
    ),
    "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>nav</title></head><body><nav epub:type="toc"><ol><li><a href="text/c1.xhtml">এক</a></li></ol></nav></body></html>`),
    "OEBPS/text/c1.xhtml": strToU8(
      `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>c1</title><link rel="stylesheet" href="../style.css"/></head><body><h1 onclick="steal()">প্রথম অধ্যায়</h1><p>লেখা<script>window.pwned=1</script></p><img src="https://tracker.example/p.gif" alt=""/><img src="../images/cover.png" alt="ছবি"/></body></html>`,
    ),
    "OEBPS/style.css": strToU8(`@import url(https://evil.example/x.css); body { background: url(https://t.example/p.png) }`),
    "OEBPS/images/cover.png": PNG_1PX,
    ...extra,
  };
  const mimetype: Zippable = { mimetype: [strToU8("application/epub+zip"), { level: mimetypeFirst ? 0 : 9 }] };
  return zipSync(mimetypeFirst ? { ...mimetype, ...files } : { ...files, ...mimetype });
}

describe("prepareEpub (in the browser; linkedom here)", () => {
  let mod: typeof import("@/lib/personal/import");
  beforeAll(async () => {
    (globalThis as { DOMParser?: unknown }).DOMParser = DOMParser;
    mod = await import("@/lib/personal/import");
  });

  it("reads the metadata, cleans every page and packs a valid EPUB", async () => {
    const steps: string[] = [];
    const book = await mod.prepareEpub(new Blob([epub()]), (s) => steps.push(s));
    expect(steps).toEqual(["reading", "checking", "cleaning", "packing"]);
    expect(book.title).toBe("আমার নিজের বই");
    expect(book.author).toBe("লেখক নাম");
    expect(book.language).toBe("bn");
    expect(book.cover?.type).toBe("image/png");
    expect(book.id).toBe(`mine-${book.sha256.slice(0, 24)}`);

    // the new file passes the strict check catalogue files must pass
    const report = validateEpub(book.data);
    expect(report.errors).toEqual([]);
    const files = unzipSync(book.data);
    const chapter = strFromU8(files["OEBPS/text/c1.xhtml"]);
    expect(chapter).not.toMatch(/script|pwned|onclick|tracker\.example/);
    expect(chapter).toContain("প্রথম অধ্যায়");
    expect(chapter).toContain('src="../images/cover.png"');
    expect(strFromU8(files["OEBPS/style.css"])).not.toMatch(/evil\.example|t\.example/);
    expect(files["OEBPS/images/cover.png"]).toEqual(PNG_1PX);
  });

  it("packs the same file to the same bytes, so a book has one id everywhere", async () => {
    const a = await mod.prepareEpub(new Blob([epub()]));
    const b = await mod.prepareEpub(new Blob([epub()]));
    expect(a.sha256).toBe(b.sha256);
  });

  it("repairs packaging slips instead of refusing the book", async () => {
    const book = await mod.prepareEpub(new Blob([epub({ mimetypeFirst: false })]));
    expect(book.warnings.join(" ")).toMatch(/mimetype/);
    expect(validateEpub(book.data).ok).toBe(true);
  });

  it("falls back to the file name for an untitled book", async () => {
    const bytes = epub();
    const files = unzipSync(bytes);
    files["OEBPS/content.opf"] = strToU8(strFromU8(files["OEBPS/content.opf"]).replace(/<dc:title>[^<]*<\/dc:title>/, ""));
    const { mimetype, ...rest } = files;
    const untitled = zipSync({ mimetype: [mimetype, { level: 0 }], ...rest });
    const file = Object.assign(new Blob([untitled]), { name: "pather_panchali.epub" });
    expect((await mod.prepareEpub(file)).title).toBe("pather panchali");
  });

  it("refuses DRM-protected books, but not obfuscated fonts", async () => {
    const enc = (alg: string) =>
      strToU8(
        `<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="${alg}"/><enc:CipherData><enc:CipherReference URI="OEBPS/text/c1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>`,
      );
    await expect(mod.prepareEpub(new Blob([epub({ extra: { "META-INF/encryption.xml": enc("http://www.w3.org/2001/04/xmlenc#aes128-cbc") } })]))).rejects.toMatchObject({ code: "drm" });
    await expect(mod.prepareEpub(new Blob([epub({ extra: { "META-INF/rights.xml": strToU8("<rights/>") } })]))).rejects.toMatchObject({ code: "drm" });
    await expect(mod.prepareEpub(new Blob([epub({ extra: { "META-INF/encryption.xml": enc("http://www.idpf.org/2008/embedding") } })]))).resolves.toBeTruthy();
  });

  it("explains files that are not books", async () => {
    await expect(mod.prepareEpub(new Blob([strToU8("%PDF-1.7 not an epub")]))).rejects.toMatchObject({ code: "notEpub" });
    const noOpf = zipSync({ mimetype: [strToU8("application/epub+zip"), { level: 0 }], "META-INF/container.xml": strToU8("<container/>") });
    await expect(mod.prepareEpub(new Blob([noOpf]))).rejects.toMatchObject({ code: "broken" });
  });
});
