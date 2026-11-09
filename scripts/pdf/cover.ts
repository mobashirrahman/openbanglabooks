/**
 * High-resolution EPUB covers in the OpenBanglaBooks visual language.
 *
 * When the PDF has a real cover we keep it: `enhanceCover` crops/upscales it
 * to 1600×2400 with Lanczos resampling and a light sharpen. When it does not,
 * `generateCover` draws a cloth-green, brass-ruled cover and shapes the
 * Bengali title with HarfBuzz, so conjuncts and vowel signs are correct even
 * on a machine with no Bengali fonts installed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import sharp from "sharp";
import * as hb from "harfbuzzjs";
import { woffToSfnt } from "../lib/woff.ts";
import { transformPath } from "../lib/svg-path.ts";
import { MARK_VIEWBOX, openMarkSvg } from "../../src/components/brand/mark-geometry.ts";

const root = resolve(import.meta.dirname, "../..");
const fontDir = join(root, "node_modules/@fontsource/tiro-bangla/files");
const BENGALI = "tiro-bangla-bengali-400-normal.woff";
const LATIN = "tiro-bangla-latin-400-normal.woff";

export const COVER_WIDTH = 1600;
export const COVER_HEIGHT = 2400;

const C = {
  green: "#233B30",
  greenDeep: "#182A22",
  ivory: "#F5EFE4",
  ivoryDim: "#DED4C2",
  brass: "#C2A06C",
  brassDim: "#8E7350",
};

type Font = { face: hb.Face; font: hb.Font };

function loadFont(file: string): Font {
  const face = new hb.Face(new hb.Blob(woffToSfnt(readFileSync(join(fontDir, file)))));
  return { face, font: new hb.Font(face) };
}

let fonts: { bn: Font; latin: Font } | null = null;
function getFonts() {
  fonts ??= { bn: loadFont(BENGALI), latin: loadFont(LATIN) };
  return fonts;
}

const hasBengali = (s: string) => /[\u0980-\u09FF]/u.test(s);

type Shaped = { d: string; width: number };

function shapeWord(word: string, file: "bn" | "latin", size: number, x: number, y: number): Shaped {
  const { face, font } = getFonts()[file];
  const buf = new hb.Buffer();
  buf.addText(word);
  buf.guessSegmentProperties();
  hb.shape(font, buf);
  const s = size / face.upem;
  let pen = 0;
  const parts: string[] = [];
  for (const g of buf.getGlyphInfosAndPositions()) {
    const d = font.glyphToPath(g.codepoint);
    if (d) parts.push(transformPath(d, s, x + (pen + (g.xOffset ?? 0)) * s, y - (g.yOffset ?? 0) * s));
    pen += g.xAdvance ?? 0;
  }
  return { d: parts.join(""), width: pen * s };
}

function fontFor(word: string): "bn" | "latin" {
  return hasBengali(word) ? "bn" : "latin";
}

function measure(text: string, size: number): number {
  const words = text.split(/\s+/).filter(Boolean);
  let width = 0;
  for (let i = 0; i < words.length; i++) {
    width += shapeWord(words[i], fontFor(words[i]), size, 0, 0).width;
    if (i < words.length - 1) width += shapeWord(" ", "latin", size, 0, 0).width;
  }
  return width;
}

function wrap(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, size) <= maxWidth) {
      line = candidate;
    } else {
      if (line) lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function fitTitle(title: string, maxWidth: number, maxLines: number, maxSize: number, minSize: number) {
  for (let size = maxSize; size >= minSize; size -= 2) {
    const lines = wrap(title.replace(/\s+/g, " ").trim(), size, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => measure(l, size) <= maxWidth)) {
      return { size, lines };
    }
  }
  return { size: minSize, lines: wrap(title, minSize, maxWidth).slice(0, maxLines) };
}

function linePath(line: string, size: number, x: number, y: number): { d: string; width: number } {
  const words = line.split(/\s+/).filter(Boolean);
  let pen = x;
  const parts: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const shaped = shapeWord(word, fontFor(word), size, pen, y);
    parts.push(shaped.d);
    pen += shaped.width;
    if (i < words.length - 1) pen += shapeWord(" ", "latin", size, 0, 0).width;
  }
  return { d: parts.join(""), width: pen - x };
}

function wrappedPaths(text: string, size: number, leading: number, centerY: number, maxWidth: number): string {
  const lines = wrap(text, size, maxWidth);
  const total = leading * (lines.length - 1);
  const start = centerY - total / 2;
  return lines
    .map((line, i) => {
      const width = measure(line, size);
      const x = (COVER_WIDTH - width) / 2;
      return linePath(line, size, x, start + i * leading).d;
    })
    .join("");
}

function centeredPath(text: string, size: number, y: number): string {
  const width = measure(text, size);
  return linePath(text, size, (COVER_WIDTH - width) / 2, y).d;
}

function mark(fill: string, size: number, cx: number, cy: number): string {
  return `<g transform="translate(${cx - size / 2} ${cy - size / 2}) scale(${size / MARK_VIEWBOX})">${openMarkSvg(fill)}</g>`;
}

export type CoverInput = {
  title: string;
  author: string;
  titleEn?: string;
  authorEn?: string;
  subtitle?: string;
  imprint?: string;
  edition?: string;
};

export async function generateCover(input: CoverInput, out: string): Promise<{ width: number; height: number }> {
  const title = input.title.trim() || "শিরোনামহীন";
  const author = input.author.trim() || "অজানা";
  const maxTitleWidth = COVER_WIDTH - 300;
  const fitted = fitTitle(title, maxTitleWidth, 4, 104, 56);
  const titleLeading = fitted.size * 1.28;
  const titleBlockHeight = titleLeading * (fitted.lines.length - 1);
  const titleCenterY = 980 - titleBlockHeight / 2 + 40;

  const subtitleSize = 38;
  const authorSize = 56;
  const englishSize = 30;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_WIDTH}" height="${COVER_HEIGHT}" viewBox="0 0 ${COVER_WIDTH} ${COVER_HEIGHT}">
<defs>
  <radialGradient id="cloth" cx="0.46" cy="0.34" r="0.78">
    <stop offset="0" stop-color="${C.green}" />
    <stop offset="0.62" stop-color="${C.green}" />
    <stop offset="1" stop-color="${C.greenDeep}" />
  </radialGradient>
  <filter id="grain" x="0" y="0" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.72" numOctaves="3" stitchTiles="stitch"/>
    <feColorMatrix type="saturate" values="0"/>
    <feComponentTransfer><feFuncA type="linear" slope="0.055"/></feComponentTransfer>
  </filter>
  <linearGradient id="brass" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${C.brassDim}"/>
    <stop offset="0.5" stop-color="${C.brass}"/>
    <stop offset="1" stop-color="${C.brassDim}"/>
  </linearGradient>
</defs>
<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" fill="url(#cloth)"/>
<rect width="${COVER_WIDTH}" height="${COVER_HEIGHT}" filter="url(#grain)" opacity="0.55"/>
<rect x="82" y="82" width="${COVER_WIDTH - 164}" height="${COVER_HEIGHT - 164}" fill="none" stroke="url(#brass)" stroke-width="2"/>
<rect x="96" y="96" width="${COVER_WIDTH - 192}" height="${COVER_HEIGHT - 192}" fill="none" stroke="${C.brass}" stroke-opacity="0.34" stroke-width="1"/>
<path d="M120 132 H${COVER_WIDTH - 120}" stroke="${C.brass}" stroke-opacity="0.2" stroke-width="1"/>
<path d="M120 ${COVER_HEIGHT - 132} H${COVER_WIDTH - 120}" stroke="${C.brass}" stroke-opacity="0.2" stroke-width="1"/>
${mark(C.brass, 74, COVER_WIDTH / 2, 300)}
<path fill="${C.brass}" d="${centeredPath((input.imprint ?? "OPENBANGLABOOKS").toUpperCase(), 21, 392)}"/>
<path d="M${COVER_WIDTH / 2 - 60} 424 H${COVER_WIDTH / 2 + 60}" stroke="url(#brass)" stroke-width="2"/>
${mark(C.brass, 30, COVER_WIDTH / 2, 470)}
<path fill="${C.ivory}" d="${wrappedPaths(title, fitted.size, titleLeading, titleCenterY, maxTitleWidth)}"/>
${
  input.subtitle
    ? `<path fill="${C.ivoryDim}" d="${wrappedPaths(input.subtitle, subtitleSize, subtitleSize * 1.4, titleCenterY + titleBlockHeight / 2 + 110, maxTitleWidth)}"/>`
    : ""
}
<path d="M${COVER_WIDTH / 2 - 34} 1504 H${COVER_WIDTH / 2 + 34}" stroke="${C.brass}" stroke-width="2"/>
<path fill="${C.ivory}" d="${wrappedPaths(author, authorSize, authorSize * 1.4, 1600, maxTitleWidth)}"/>
${
  input.titleEn
    ? `<path fill="${C.ivoryDim}" d="${centeredPath(input.titleEn, englishSize, 1704)}"/>`
    : ""
}
${
  input.authorEn
    ? `<path fill="${C.brass}" d="${centeredPath(input.authorEn.toUpperCase(), 24, input.titleEn ? 1752 : 1704)}"/>`
    : ""
}
<g transform="translate(${COVER_WIDTH / 2 - 150} ${COVER_HEIGHT - 250}) scale(0.55)">${openMarkSvg(C.brass)}</g>
<path fill="${C.ivoryDim}" d="${centeredPath("ওপেন বাংলা বুকস", 26, COVER_HEIGHT - 214)}"/>
<path fill="${C.brass}" d="${centeredPath((input.edition ?? "OPENBANGLABOOKS").toUpperCase(), 17, COVER_HEIGHT - 170)}"/>
</svg>`;

  await sharp(Buffer.from(svg))
    .flatten({ background: C.green })
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(out);
  if (process.env.PDF2EPUB_COVER_SVG) writeFileSync(process.env.PDF2EPUB_COVER_SVG, svg);
  return { width: COVER_WIDTH, height: COVER_HEIGHT };
}

/**
 * Crop/upscale an original cover to the EPUB canvas. Keeps the full cover
 * when it is close to 2:3; otherwise centres it on a cloth-green field.
 */
export async function enhanceCover(source: string, out: string): Promise<{ width: number; height: number; cropped: boolean }> {
  const meta = await sharp(source).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const ratio = h > 0 ? w / h : 0;
  const target = COVER_WIDTH / COVER_HEIGHT;
  const close = ratio > 0 && Math.abs(ratio - target) / target < 0.1;

  if (close) {
    await sharp(source)
      .rotate()
      .flatten({ background: C.green })
      .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "cover", position: "top", kernel: "lanczos3" })
      .sharpen({ sigma: 0.55, m1: 0.4, m2: 0.8 })
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
      .toFile(out);
    return { width: COVER_WIDTH, height: COVER_HEIGHT, cropped: false };
  }

  const background = await sharp(source)
    .rotate()
    .flatten({ background: C.green })
    .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "cover", kernel: "lanczos3" })
    .blur(36)
    .modulate({ brightness: 0.38, saturation: 0.8 })
    .toBuffer();
  const foreground = await sharp(source)
    .rotate()
    .flatten({ background: C.green })
    .resize(COVER_WIDTH, COVER_HEIGHT, { fit: "contain", background: C.green, kernel: "lanczos3" })
    .sharpen({ sigma: 0.5 })
    .toBuffer();
  await sharp(background)
    .composite([{ input: foreground, gravity: "centre" }])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4", mozjpeg: true })
    .toFile(out);
  return { width: COVER_WIDTH, height: COVER_HEIGHT, cropped: true };
}
