/**
 * pnpm pdf:epub -- input.pdf --out dist/book.epub
 *
 * One command: Python extraction (text layer or Surya OCR) → book bundle →
 * sanitised EPUB 3.3 → structural validation → sidecar report.
 */
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "../..");
const tools = join(root, "tools/pdf2epub");
const tsx = join(root, "node_modules/.bin/tsx");

const { values: args, positionals } = parseArgs({
  // pnpm forwards literal `--` separators from commands such as
  // `pnpm pdf:craft -- book.pdf`. Drop all of them so flags after the path or
  // after a package-script-supplied flag are still parsed as options.
  args: process.argv.slice(2).filter((value) => value !== "--"),
  allowPositionals: true,
  options: {
    out: { type: "string" },
    work: { type: "string" },
    engine: { type: "string", default: "surya" },
    ocr: { type: "string", default: "auto" },
    "ocr-json": { type: "string" },
    model: { type: "string" },
    backend: { type: "string" },
    tesseract: { type: "string" },
    "pdfcraft-language": { type: "string" },
    tessdata: { type: "string" },
    metadata: { type: "string" },
    "pdfcraft-recover-structure": { type: "boolean", default: false },
    dpi: { type: "string", default: "300" },
    cover: { type: "string", default: "auto" },
    "no-fonts": { type: "boolean", default: false },
    "keep-raw": { type: "boolean", default: false },
    "max-pages": { type: "string" },
    inspect: { type: "boolean", default: false },
    "check-ocr": { type: "boolean", default: false },
    "check-engine": { type: "string", default: "all" },
    strict: { type: "boolean", default: false },
    clean: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    title: { type: "string" },
    "title-en": { type: "string" },
    subtitle: { type: "string" },
    author: { type: "string" },
    "author-en": { type: "string" },
    "author-sort": { type: "string" },
    language: { type: "string" },
    publisher: { type: "string" },
    "first-published": { type: "string" },
    "source-name": { type: "string" },
    "source-url": { type: "string" },
    rights: { type: "string" },
    license: { type: "string" },
    "license-url": { type: "string" },
    description: { type: "string" },
    subject: { type: "string", multiple: true },
    modified: { type: "string" },
  },
});

const nativePython =
  process.env.PDF2EPUB_PYTHON ??
  (existsSync(join(tools, ".venv/bin/python")) ? join(tools, ".venv/bin/python") : "python3");

if (args["check-ocr"]) {
  const checkArgs = ["-m", "pdf2epub", "check-ocr", "--engine", args["check-engine"] ?? "all"];
  if (args.tesseract) checkArgs.push("--tesseract", args.tesseract);
  if (args.tessdata) checkArgs.push("--tessdata", resolve(args.tessdata));
  if (args.strict) checkArgs.push("--strict");
  if (args.json) checkArgs.push("--json");
  process.exit(run(nativePython, checkArgs, tools, false));
}

const input = positionals[0];
if (!input) {
  console.error(
    "usage: pnpm pdf:epub -- input.pdf [--out dist/book.epub] [--engine surya|tesseract] " +
      "[--ocr auto|always|never] [--cover auto|original|generate|none]",
  );
  process.exit(2);
}
if (!["surya", "tesseract"].includes(args.engine)) {
  console.error(`error: --engine must be surya or tesseract (got ${args.engine})`);
  process.exit(2);
}
const engine = args.engine === "tesseract" ? "pdf-craft" : "native";
const pdf = resolve(input);
if (!existsSync(pdf)) {
  console.error(`error: no such PDF: ${pdf}`);
  process.exit(2);
}

const stem = basename(pdf).replace(/\.[^.]+$/, "");
const work = resolve(args.work ?? join(root, ".work/pdf", stem));
const out = resolve(args.out ?? join(root, "dist", `${stem}.epub`));
const python = engine === "pdf-craft" ? process.env.PDFCRAFT_PYTHON ?? nativePython : nativePython;

if (args.inspect) {
  const status = run(nativePython, ["-m", "pdf2epub", "inspect", pdf, "--json"], tools, false);
  process.exit(status);
}

const extractArgs = ["-m", "pdf2epub", "extract", pdf, "--out", work, "--engine", args.engine];
if (args.ocr) extractArgs.push("--ocr", args.ocr);
if (args["ocr-json"]) extractArgs.push("--ocr-json", resolve(args["ocr-json"]));
if (args.model) extractArgs.push("--model", args.model);
if (args.backend) extractArgs.push("--backend", args.backend);
if (args.tesseract) extractArgs.push("--tesseract", args.tesseract);
if (args["pdfcraft-language"]) extractArgs.push("--pdfcraft-language", args["pdfcraft-language"]);
if (args.tessdata) extractArgs.push("--tessdata", resolve(args.tessdata));
if (args.metadata) extractArgs.push("--metadata", resolve(args.metadata));
if (args["pdfcraft-recover-structure"]) extractArgs.push("--pdfcraft-recover-structure");
if (args.dpi) extractArgs.push("--dpi", args.dpi);
if (args.cover) extractArgs.push("--cover", args.cover);
if (args["keep-raw"]) extractArgs.push("--keep-raw");
if (args["max-pages"]) extractArgs.push("--max-pages", args["max-pages"]);
for (const key of [
  "title",
  "title-en",
  "subtitle",
  "author",
  "author-en",
  "author-sort",
  "language",
  "publisher",
  "first-published",
  "source-name",
  "source-url",
  "rights",
  "license",
  "license-url",
  "description",
  "modified",
] as const) {
  const value = args[key];
  if (typeof value === "string" && value) extractArgs.push(`--${key}`, value);
}
for (const subject of args.subject ?? []) extractArgs.push("--subject", subject);
if (args.json) extractArgs.push("--quiet");

const extracted = run(python, extractArgs, tools, args.json);
if (extracted !== 0) process.exit(extracted);

const buildArgs = [join(root, "scripts/pdf/build.ts"), "--work", work, "--out", out];
if (args.cover) buildArgs.push("--cover", args.cover);
if (args["no-fonts"]) buildArgs.push("--no-fonts");
if (args.json) buildArgs.push("--json");
for (const key of ["title", "title-en", "subtitle", "author", "author-en"] as const) {
  const value = args[key];
  if (typeof value === "string" && value) buildArgs.push(`--${key}`, value);
}

const built = run(tsx, buildArgs, root, false);
if (built !== 0) process.exit(built);

if (args.clean && !args.json) {
  rmSync(work, { recursive: true, force: true });
  console.log(`removed bundle ${work}`);
} else if (!args.json) {
  console.log(`bundle kept at ${work} (pass --clean to remove it)`);
}

function run(command: string, argv: string[], cwd: string, quiet: boolean): number {
  const result = spawnSync(command, argv, {
    cwd,
    stdio: quiet ? ["ignore", "ignore", "inherit"] : "inherit",
    env: { ...process.env, PYTHONPATH: tools },
  });
  if (result.error) {
    console.error(`error running ${command}: ${result.error.message}`);
    return 2;
  }
  return result.status ?? 0;
}
