/**
 * Generates every OpenBanglaBooks brand asset from one source of truth:
 *  - the mark geometry (src/components/brand/mark-geometry.ts)
 *  - the wordmark, shaped with HarfBuzz from Tiro Bangla and outlined to paths
 *    so Bengali conjuncts and vowel signs are correct without any font present.
 *
 * Outputs SVG logos (light/dark, horizontal/compact), favicon (SVG + ICO),
 * Apple touch icon, PWA icons and a TS module with the outlined wordmark for
 * the inline React logo.
 *
 * Run: pnpm brand
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import * as hb from "harfbuzzjs";
import { woffToSfnt } from "../lib/woff.ts";
import { transformPath } from "../lib/svg-path.ts";
import { MARK_VIEWBOX, openMarkSvg } from "../../src/components/brand/mark-geometry.ts";

const root = resolve(import.meta.dirname, "../..");
const fontDir = join(root, "node_modules/@fontsource/tiro-bangla/files");

const C = {
  green: "#233B30",
  ivory: "#F5EFE4",
  ink: "#282720",
  brass: "#C2A06C",
  charcoal: "#202423",
};

function loadFont(file: string) {
  const face = new hb.Face(new hb.Blob(woffToSfnt(readFileSync(join(fontDir, file)))));
  return { face, font: new hb.Font(face) };
}

/** Shape `text` and return one outlined path positioned with its baseline at (x, y). */
function outline(file: string, text: string, size: number, x: number, y: number, tracking = 0) {
  const { face, font } = loadFont(file);
  const buf = new hb.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  hb.shape(font, buf);
  const s = size / face.upem;
  let pen = 0;
  const parts: string[] = [];
  for (const g of buf.getGlyphInfosAndPositions()) {
    const d = font.glyphToPath(g.codepoint);
    if (d) parts.push(transformPath(d, s, x + (pen + (g.xOffset ?? 0)) * s, y - (g.yOffset ?? 0) * s));
    pen += (g.xAdvance ?? 0) + tracking;
  }
  return { d: parts.join(""), width: (pen - tracking) * s };
}

// ── Lockup layout (units ≈ px at 1×) ─────────────────────────────────────────
const H = 64;
const MARK = 60; // rendered mark box
const TEXT_X = MARK + 6;
const latin = outline("tiro-bangla-latin-400-normal.woff", "OpenBanglaBooks", 29, TEXT_X, 31, 6);
const bengali = outline("tiro-bangla-bengali-400-normal.woff", "ওপেন বাংলা বুকস", 18.5, TEXT_X + 1, 54);
const W = Math.ceil(TEXT_X + Math.max(latin.width, bengali.width) + 2);
const compactW = Math.ceil(TEXT_X + latin.width + 2);

const markAt = (fill: string, size = MARK, x = 0, y = (H - MARK) / 2, variant: "default" | "small" = "default") =>
  `<g transform="translate(${x} ${y}) scale(${size / MARK_VIEWBOX})">${openMarkSvg(fill, variant)}</g>`;

const svg = (w: number, h: number, body: string, title = "OpenBanglaBooks") =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}"><title>${title}</title>${body}</svg>\n`;

function lockup(theme: "light" | "dark", withBengali: boolean) {
  const mark = theme === "light" ? C.green : C.brass;
  const word = theme === "light" ? C.green : C.ivory;
  const sub = theme === "light" ? C.ink : C.ivory;
  const compactY = withBengali ? 0 : 10; // vertically centre a single line
  const h = withBengali ? H : 44;
  return svg(
    withBengali ? W : compactW,
    h,
    markAt(mark, withBengali ? MARK : 44, 0, withBengali ? (H - MARK) / 2 : 0) +
      `<path fill="${word}" transform="translate(${withBengali ? 0 : -16} ${-compactY + (withBengali ? 0 : 1)})" d="${latin.d}"/>` +
      (withBengali ? `<path fill="${sub}" fill-opacity="0.78" d="${bengali.d}"/>` : ""),
    withBengali ? "OpenBanglaBooks — ওপেন বাংলা বুকস" : "OpenBanglaBooks",
  );
}

/** Square tile icon: cloth-green field with the ivory mark. */
function tile(size: number, { maskable = false, radius = 0, variant = "default" as "default" | "small" } = {}) {
  const markSize = size * (maskable ? 0.62 : 0.84);
  const offset = (size - markSize) / 2;
  return svg(
    size,
    size,
    `<rect width="${size}" height="${size}" rx="${radius}" fill="${C.green}"/>` +
      markAt(C.ivory, markSize, offset, offset, variant),
  );
}

function ico(pngs: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + pngs.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4); // planes
    header.writeUInt16LE(32, e + 6); // bpp
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

const png = (markup: string, size: number) =>
  sharp(Buffer.from(markup), { density: 72 * (size / Number(markup.match(/width="(\d+)/)![1])) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

async function main() {
  const brandDir = join(root, "public/brand");
  const iconDir = join(root, "public/icons");
  mkdirSync(brandDir, { recursive: true });
  mkdirSync(iconDir, { recursive: true });

  const files: Record<string, string> = {
    "logo.svg": lockup("light", true),
    "logo-dark.svg": lockup("dark", true),
    "logo-compact.svg": lockup("light", false),
    "logo-compact-dark.svg": lockup("dark", false),
    "mark.svg": svg(MARK_VIEWBOX, MARK_VIEWBOX, openMarkSvg(C.green)),
    "mark-dark.svg": svg(MARK_VIEWBOX, MARK_VIEWBOX, openMarkSvg(C.brass)),
    "app-icon.svg": tile(512),
  };
  for (const [name, content] of Object.entries(files)) writeFileSync(join(brandDir, name), content);

  // Favicon: rounded tile, small-variant mark (larger holes survive 16px).
  const favicon = tile(64, { radius: 14, variant: "small" });
  writeFileSync(join(root, "src/app/icon.svg"), favicon);
  const icoPngs = await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(favicon, size) })));
  writeFileSync(join(root, "src/app/favicon.ico"), ico(icoPngs));
  writeFileSync(join(root, "src/app/apple-icon.png"), await png(tile(180), 180));

  writeFileSync(join(iconDir, "icon-192.png"), await png(tile(192), 192));
  writeFileSync(join(iconDir, "icon-512.png"), await png(tile(512), 512));
  writeFileSync(join(iconDir, "icon-maskable-512.png"), await png(tile(512, { maskable: true }), 512));
  writeFileSync(join(brandDir, "logo.png"), await sharp(Buffer.from(lockup("light", true)), { density: 72 * 4 }).png().toBuffer());

  // Outlined wordmark for the inline React logo (themeable via currentColor).
  writeFileSync(
    join(root, "src/components/brand/wordmark.generated.ts"),
    `/* Generated by scripts/render/brand.ts – do not edit. */\n` +
      `export const LOCKUP = ${JSON.stringify({ width: W, compactWidth: compactW, height: H, mark: MARK, textX: TEXT_X })} as const;\n` +
      `export const WORDMARK_LATIN = ${JSON.stringify(latin.d)};\n` +
      `export const WORDMARK_BENGALI = ${JSON.stringify(bengali.d)};\n`,
  );
  console.log(`brand: lockup ${W}×${H}, compact ${compactW}×44 → public/brand, public/icons, src/app`);
}

main();
