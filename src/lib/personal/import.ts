"use client";

import { strFromU8, strToU8, zipSync, type Zippable } from "fflate";
import { validateEpub, LIMITS } from "@/lib/epub/validate";
import { cleanCss, cleanMarkup } from "@/lib/epub/clean";
import { personalIdFor } from "./ids";

/**
 * Adding a reader's own EPUB, entirely in the browser: check the archive,
 * refuse DRM-protected files, read the title, author and cover, clean every
 * page and stylesheet (src/lib/epub/clean.ts), and pack a new, deterministic
 * EPUB. Its SHA-256 is the book's identity. Nothing is sent anywhere.
 */

export type ImportStep = "reading" | "checking" | "cleaning" | "packing";
export type ImportErrorCode = "notEpub" | "tooBig" | "drm" | "broken" | "insecure";

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    detail?: string,
  ) {
    super(detail ?? code);
  }
}

export type BookMetadata = {
  title: string | null;
  author: string | null;
  language: string | null;
  cover: { data: ArrayBuffer; type: string } | null;
};

export type PreparedBook = BookMetadata & {
  id: string;
  sha256: string;
  data: Uint8Array;
  title: string;
  warnings: string[];
};

const OPF_DC = "http://purl.org/dc/elements/1.1/";
const FONT_OBFUSCATION = new Set(["http://www.idpf.org/2008/embedding", "http://ns.adobe.com/pdf/enc#RC"]);
const MARKUP = /^(application\/xhtml\+xml|text\/html|image\/svg\+xml)$/;
const MARKUP_EXT = /\.(xhtml|html|htm|xht|svg)$/i;

const yieldToBrowser = () => new Promise<void>((r) => setTimeout(r, 0));
const tidy = (s: string | null | undefined, max = 500) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** Text of a file, honouring a BOM or an XML encoding declaration (output is always UTF-8). */
function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  const head = strFromU8(bytes.subarray(0, 200), true);
  const label = head.match(/<\?xml[^>]*encoding=["']([\w.-]+)["']/i)?.[1]?.toLowerCase();
  if (label && label !== "utf-8" && label !== "utf8") {
    try {
      return new TextDecoder(label).decode(bytes);
    } catch {
      /* unknown label: read as UTF-8 */
    }
  }
  return new TextDecoder().decode(bytes);
}

/** Elements by local name, whatever their prefix (a plain tree walk: works in every DOM). */
function elements(doc: Document, localName: string): Element[] {
  const out: Element[] = [];
  const walk = (el: Element) => {
    if ((el.localName ?? el.tagName).split(":").pop() === localName) out.push(el);
    for (const child of Array.from(el.children)) walk(child);
  };
  if (doc.documentElement) walk(doc.documentElement);
  return out;
}

function resolve(base: string, href: string): string {
  const parts = (base + decodeURIComponent(href.split("#")[0])).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "..") out.pop();
    else if (p !== "." && p !== "") out.push(p);
  }
  return out.join("/");
}

/** DRM-protected books cannot be opened by any reader but the vendor's. */
function isProtected(files: Record<string, Uint8Array>): boolean {
  if (files["META-INF/rights.xml"] || files["META-INF/sinf.xml"]) return true;
  const enc = files["META-INF/encryption.xml"];
  if (!enc) return false;
  const methods = [...decode(enc).matchAll(/<(?:[\w-]+:)?EncryptionMethod\b[^>]*\bAlgorithm\s*=\s*["']([^"']+)["']/g)].map((m) => m[1]);
  // font obfuscation is not DRM (the reader undoes it); any other encrypted file is
  return methods.some((a) => !FONT_OBFUSCATION.has(a));
}

type Manifest = { opfPath: string; base: string; items: { id: string; href: string; path: string; type: string; properties: string }[]; opf: Document };

function readManifest(files: Record<string, Uint8Array>, parser: DOMParser): Manifest {
  const container = files["META-INF/container.xml"];
  if (!container) throw new ImportError("broken", "no container");
  const opfPath = decode(container).match(/full-path\s*=\s*["']([^"']+)["']/)?.[1];
  if (!opfPath || !files[opfPath]) throw new ImportError("broken", "no package document");
  const opf = parser.parseFromString(decode(files[opfPath]), "application/xml");
  if (opf.getElementsByTagName("parsererror").length) throw new ImportError("broken", "unreadable package document");
  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const items = elements(opf, "item").map((e) => {
    const href = e.getAttribute("href") ?? "";
    return { id: e.getAttribute("id") ?? "", href, path: resolve(base, href), type: (e.getAttribute("media-type") ?? "").toLowerCase(), properties: e.getAttribute("properties") ?? "" };
  });
  return { opfPath, base, items, opf };
}

/** Title, author, language and cover from the package document. */
export async function readMetadata(files: Record<string, Uint8Array>, parser: DOMParser = new DOMParser()): Promise<BookMetadata> {
  const { items, opf } = readManifest(files, parser);
  const dc = (name: string) => elements(opf, name).filter((e) => e.namespaceURI === OPF_DC || e.tagName.startsWith("dc:"));
  const creators = dc("creator");
  // an author over an editor or translator, when roles are given
  const author = creators.find((c) => /aut/.test(c.getAttribute("opf:role") ?? c.getAttribute("role") ?? "aut")) ?? creators[0];
  const coverId = elements(opf, "meta").find((m) => m.getAttribute("name") === "cover")?.getAttribute("content");
  const coverItem =
    items.find((i) => /(^|\s)cover-image(\s|$)/.test(i.properties)) ??
    items.find((i) => i.id === coverId && i.type.startsWith("image/")) ??
    items.find((i) => i.type.startsWith("image/") && /cover/i.test(i.id + i.href));
  const coverBytes = coverItem ? files[coverItem.path] : undefined;
  return {
    title: tidy(dc("title")[0]?.textContent),
    author: tidy(author?.textContent),
    language: tidy(dc("language")[0]?.textContent, 35),
    cover: coverBytes && coverItem ? await smallCover(coverBytes, coverItem.type) : null,
  };
}

/** A small copy of the cover for the library (at most 480 px wide). */
async function smallCover(bytes: Uint8Array, type: string): Promise<{ data: ArrayBuffer; type: string } | null> {
  const copy = () => bytes.slice().buffer as ArrayBuffer;
  if (!/^image\/(png|jpeg|jpg|gif|webp)$/.test(type)) return null; // SVG covers: the generated cover instead
  try {
    const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
    // a placeholder pixel or a tiny icon is no cover: the generated one looks better
    if (bitmap.width < 64 || bitmap.height < 64) {
      bitmap.close();
      return null;
    }
    const scale = Math.min(1, 480 / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.86));
    if (blob) return { data: await blob.arrayBuffer(), type: "image/jpeg" };
  } catch {
    /* fall back to the original, if small */
  }
  return bytes.byteLength < 600_000 ? { data: copy(), type } : null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new ImportError("insecure", "WebCrypto needs HTTPS");
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes as BufferSource));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// a fixed local time: the same file packs to the same bytes in every time zone
const PACKED_AT = () => new Date(2000, 0, 1, 0, 0, 0);

/** Checks, cleans and repacks an EPUB. Throws ImportError with a reason a reader can act on. */
export async function prepareEpub(file: Blob & { name?: string }, onStep: (s: ImportStep) => void = () => {}): Promise<PreparedBook> {
  onStep("reading");
  if (file.size > LIMITS.maxBytes) throw new ImportError("tooBig");
  const original = new Uint8Array(await file.arrayBuffer());
  await yieldToBrowser();

  onStep("checking");
  const report = validateEpub(original, { lenient: true, keepFiles: true });
  if (!report.ok || !report.files) {
    const first = report.errors[0] ?? "";
    throw new ImportError(/ZIP/.test(first) ? "notEpub" : /larger/.test(first) ? "tooBig" : "broken", first);
  }
  const files = report.files;
  if (isProtected(files)) throw new ImportError("drm");
  const parser = new DOMParser();
  const manifest = readManifest(files, parser);
  if (!elements(manifest.opf, "itemref").length) throw new ImportError("broken", "empty spine");
  const meta = await readMetadata(files, parser);
  await yieldToBrowser();

  onStep("cleaning");
  const typeOf = new Map(manifest.items.map((i) => [i.path, i.type]));
  const cleaned: Record<string, Uint8Array> = {};
  let n = 0;
  for (const [name, data] of Object.entries(files)) {
    if (name.endsWith("/") || name === "mimetype") continue;
    if (name === "META-INF/rights.xml" || name === "META-INF/sinf.xml") continue;
    const type = typeOf.get(name) ?? "";
    if (MARKUP.test(type) || (!type && MARKUP_EXT.test(name))) cleaned[name] = strToU8(cleanMarkup(decode(data), type || (name.endsWith(".svg") ? "image/svg+xml" : "application/xhtml+xml"), parser));
    else if (type === "text/css" || name.toLowerCase().endsWith(".css")) cleaned[name] = strToU8(cleanCss(decode(data)));
    else cleaned[name] = data;
    if (++n % 8 === 0) await yieldToBrowser();
  }

  onStep("packing");
  const mtime = PACKED_AT();
  const zip: Zippable = { mimetype: [strToU8("application/epub+zip"), { level: 0, mtime }] };
  for (const name of Object.keys(cleaned).sort()) zip[name] = [cleaned[name], { level: 6, mtime }];
  const data = zipSync(zip);
  const sha256 = await sha256Hex(data);
  const fallbackTitle = tidy(file.name?.replace(/\.epub$/i, "").replace(/[_]+/g, " ")) ?? "বই";
  return {
    ...meta,
    id: personalIdFor(sha256),
    sha256,
    data,
    title: meta.title ?? fallbackTitle,
    warnings: report.warnings,
  };
}
