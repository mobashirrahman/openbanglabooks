"use client";

import { clothOf } from "@/components/cover/cloths";
import { leafPaths, OPEN_ANGLE, openMarkOffset, PIVOT } from "@/components/brand/mark-geometry";

/**
 * Quote cards: a passage set as an image (1080×1350, the 4:5 portrait most
 * feeds show uncropped), drawn on a canvas. The browser shapes the Bengali
 * text itself, so conjuncts are always right – no server rendering involved,
 * nothing leaves the device until the reader shares it.
 */

export type CardStyle = "cloth" | "paper" | "night";
export type CardInput = { quote: string; title: string; author: string; variant: number; style: CardStyle };

export const CARD_W = 1080;
export const CARD_H = 1350;
const PAD = 116;
const MAX_QUOTE = 640;

const FONT_QUOTE = '"Noto Serif Bengali", "Tiro Bangla", serif';
const FONT_TITLE = '"Tiro Bangla", "Noto Serif Bengali", serif';
const FONT_UI = '"Hind Siliguri", sans-serif';

function palette(style: CardStyle, variant: number) {
  if (style === "paper") return { bg: "#F5EFE4", ink: "#282720", muted: "#5d5a4f", accent: "#A65D4E", title: "#233B30", weave: false };
  if (style === "night") return { bg: "#202423", ink: "#ECE6DA", muted: "#b9b2a4", accent: "#C2A06C", title: "#C2A06C", weave: false };
  const { cloth, foil } = clothOf(variant);
  // the turmeric cloth is light and stamped in ink: its text is dark too
  const light = luminance(cloth) > 0.18;
  return {
    bg: cloth,
    ink: light ? "#211a12" : "#F5EFE4",
    muted: light ? "rgba(33,26,18,0.78)" : "rgba(245,239,228,0.76)",
    accent: foil,
    title: foil,
    weave: true,
  };
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Wraps words to a width; a word longer than a line is split between letters. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    if (ctx.measureText(word).width <= width) {
      line = word;
      continue;
    }
    const seg = new Intl.Segmenter("bn", { granularity: "grapheme" });
    line = "";
    for (const { segment } of seg.segment(word)) {
      if (ctx.measureText(line + segment).width > width && line) {
        lines.push(line);
        line = segment;
      } else line += segment;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const { left, right } = leafPaths("default");
  const s = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.translate(0, openMarkOffset("default"));
  ctx.fillStyle = color;
  for (const [side, angle] of [
    [left, OPEN_ANGLE],
    [right, -OPEN_ANGLE],
  ] as const) {
    ctx.save();
    ctx.translate(PIVOT.x, PIVOT.y);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.translate(-PIVOT.x, -PIVOT.y);
    for (const d of [side.leaf, ...side.slivers]) ctx.fill(new Path2D(d), "evenodd");
    ctx.restore();
  }
  ctx.restore();
}

export async function renderQuoteCard(canvas: HTMLCanvasElement, input: CardInput) {
  const quoteText = input.quote.length > MAX_QUOTE ? `${input.quote.slice(0, MAX_QUOTE).replace(/\s+\S*$/, "")}…` : input.quote;
  // wait for the faces (canvas text never triggers a font load by itself)
  await Promise.all([
    document.fonts.load(`400 56px ${FONT_QUOTE}`, quoteText),
    document.fonts.load(`400 46px ${FONT_TITLE}`, input.title + "“"),
    document.fonts.load(`500 28px ${FONT_UI}`, input.author + "OpenBanglaBooks"),
  ]).catch(() => {});

  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d")!;
  const p = palette(input.style, input.variant);

  // ground
  ctx.fillStyle = p.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  if (p.weave) {
    // cloth weave and a soft light from the top left, as on the covers
    ctx.globalAlpha = 0.035;
    ctx.fillStyle = "#ffffff";
    for (let y = 0; y < CARD_H; y += 4) ctx.fillRect(0, y, CARD_W, 1);
    ctx.fillStyle = "#000000";
    ctx.globalAlpha = 0.05;
    for (let x = 0; x < CARD_W; x += 4) ctx.fillRect(x, 0, 1, CARD_H);
    ctx.globalAlpha = 1;
  }
  const light = ctx.createRadialGradient(CARD_W * 0.2, 0, 0, CARD_W * 0.2, 0, CARD_H);
  light.addColorStop(0, "rgba(255,255,255,0.10)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // foil double rule
  ctx.strokeStyle = p.accent;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = 3;
  ctx.strokeRect(44, 44, CARD_W - 88, CARD_H - 88);
  ctx.lineWidth = 1.2;
  ctx.strokeRect(58, 58, CARD_W - 116, CARD_H - 116);
  ctx.globalAlpha = 1;

  // opening quotation mark
  ctx.fillStyle = p.accent;
  ctx.font = `400 230px ${FONT_TITLE}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("“", PAD - 14, 330);

  // the passage: as large as fits (a short line is set big, like a pull quote)
  const top = 330;
  const bottom = 1020;
  const width = CARD_W - PAD * 2;
  let size = 84;
  let lines: string[] = [];
  for (; size >= 32; size -= 2) {
    ctx.font = `400 ${size}px ${FONT_QUOTE}`;
    lines = wrap(ctx, quoteText, width);
    if (lines.length * size * 1.62 <= bottom - top) break;
  }
  const lh = size * 1.62;
  const maxLines = Math.floor((bottom - top) / lh);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, "") + "…";
  }
  const blockH = lines.length * lh;
  let y = top + (bottom - top - blockH) / 2 + size * 1.05;
  ctx.fillStyle = p.ink;
  for (const l of lines) {
    ctx.fillText(l, PAD, y);
    y += lh;
  }

  // book, author, brand
  ctx.fillStyle = p.accent;
  ctx.fillRect(PAD, 1070, 72, 3);
  ctx.fillStyle = p.title;
  ctx.font = `400 50px ${FONT_TITLE}`;
  const title = wrap(ctx, input.title, width - 260)[0] ?? input.title;
  ctx.fillText(title, PAD, 1150);
  ctx.fillStyle = p.muted;
  ctx.font = `500 30px ${FONT_UI}`;
  ctx.fillText(input.author, PAD, 1202);

  ctx.font = `500 26px ${FONT_UI}`;
  const brand = "OpenBanglaBooks";
  const bw = ctx.measureText(brand).width;
  const bx = CARD_W - PAD - bw;
  ctx.fillStyle = p.muted;
  ctx.fillText(brand, bx, 1202);
  drawMark(ctx, bx - 62, 1158, 54, p.accent);
}

export function cardToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}
