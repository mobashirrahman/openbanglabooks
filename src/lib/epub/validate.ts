/**
 * Structural EPUB validation for files we accept (ingestion, admin upload,
 * personal import). Guards against malformed and hostile archives before
 * anything is stored or rendered. Not a replacement for EPUBCheck.
 */
import { unzipSync, strFromU8 } from "fflate";

export type EpubReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  version?: string;
  title?: string;
  language?: string;
  entries: number;
  uncompressedBytes: number;
};

export const LIMITS = {
  maxBytes: 50 * 1024 * 1024,
  maxUncompressedBytes: 200 * 1024 * 1024,
  maxEntries: 5000,
  maxRatio: 100, // zip-bomb guard: uncompressed / compressed
};

const SCRIPT_PATTERNS = [/<script\b/i, /\son[a-z]+\s*=/i, /javascript:/i, /<iframe\b/i, /<object\b/i, /<embed\b/i];

export type ValidateOptions = {
  /**
   * For a reader's own files (personal import), which are repacked anyway:
   * packaging slips (mimetype not first or compressed, a manifest item
   * missing) are warnings, not errors.
   */
  lenient?: boolean;
  /** also return the unpacked entries (never stored with the report) */
  keepFiles?: boolean;
};

export function validateEpub(bytes: Uint8Array, options: ValidateOptions = {}): EpubReport & { files?: Record<string, Uint8Array> } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const report: EpubReport & { files?: Record<string, Uint8Array> } = { ok: false, errors, warnings, entries: 0, uncompressedBytes: 0 };
  const slip = options.lenient ? warnings : errors;

  if (bytes.byteLength > LIMITS.maxBytes) {
    errors.push(`File is larger than ${LIMITS.maxBytes / 1024 / 1024} MB`);
    return report;
  }
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) {
    errors.push("Not a ZIP archive");
    return report;
  }
  // mimetype must be the first entry, stored (uncompressed), with exact content
  const nameLen = bytes[26] | (bytes[27] << 8);
  const extraLen = bytes[28] | (bytes[29] << 8);
  const method = bytes[8] | (bytes[9] << 8);
  const firstName = strFromU8(bytes.subarray(30, 30 + nameLen));
  if (firstName !== "mimetype") slip.push("First entry must be 'mimetype'");
  else {
    if (method !== 0) slip.push("'mimetype' must be stored without compression");
    const start = 30 + nameLen + extraLen;
    const content = strFromU8(bytes.subarray(start, start + 20));
    if (method === 0 && content !== "application/epub+zip") slip.push("'mimetype' must be application/epub+zip");
  }

  let total = 0;
  let count = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        count++;
        total += f.originalSize;
        if (count > LIMITS.maxEntries) throw new Error("Too many entries");
        if (total > LIMITS.maxUncompressedBytes) throw new Error("Archive expands too much");
        if (f.name.includes("..") || f.name.startsWith("/") || f.name.includes("\\"))
          throw new Error(`Unsafe path: ${f.name}`);
        return true;
      },
    });
  } catch (e) {
    errors.push(`Archive could not be read: ${(e as Error).message}`);
    return report;
  }
  report.entries = count;
  report.uncompressedBytes = total;
  if (total / bytes.byteLength > LIMITS.maxRatio) errors.push("Compression ratio is suspiciously high");

  const container = files["META-INF/container.xml"];
  if (!container) {
    errors.push("Missing META-INF/container.xml");
    return report;
  }
  const opfPath = strFromU8(container).match(/full-path="([^"]+)"/)?.[1];
  const opf = opfPath ? files[opfPath] : undefined;
  if (!opfPath || !opf) {
    errors.push("Package document (OPF) not found");
    return report;
  }
  const opfText = strFromU8(opf);
  report.version = opfText.match(/<package[^>]*\sversion="([^"]+)"/)?.[1];
  report.title = opfText.match(/<dc:title[^>]*>([^<]+)</)?.[1];
  report.language = opfText.match(/<dc:language[^>]*>([^<]+)</)?.[1];
  if (!report.title) warnings.push("No dc:title");
  if (!report.language) warnings.push("No dc:language");

  const base = opfPath.includes("/") ? opfPath.slice(0, opfPath.lastIndexOf("/") + 1) : "";
  const hrefs = [...opfText.matchAll(/<item\b[^>]*\shref="([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
  for (const href of hrefs) if (!files[base + href]) slip.push(`Manifest item missing: ${href}`);
  if (!/<spine\b/.test(opfText)) errors.push("No spine");

  for (const [name, data] of Object.entries(files)) {
    if (!/\.(x?html?|svg|xml)$/i.test(name)) continue;
    const text = strFromU8(data);
    if (SCRIPT_PATTERNS.some((p) => p.test(text))) warnings.push(`Active content in ${name} (will be blocked by the reader)`);
  }

  report.ok = errors.length === 0;
  if (options.keepFiles) Object.defineProperty(report, "files", { value: files, enumerable: false });
  return report;
}
