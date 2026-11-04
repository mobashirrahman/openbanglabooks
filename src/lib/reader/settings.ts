/** Reader preferences: pure data + validation (no DOM), shared by reader and profile. */

export const READER_SETTINGS_KEY = "obb:reader-settings";

export type ReaderFont = "noto-serif" | "tiro" | "hind" | "anek";
export type ReaderTheme = "light" | "sepia" | "dark";
export type ReaderLayout = "auto" | "single" | "spread";
export type ReaderFlow = "paginated" | "scrolled";
export type ReaderMargin = "narrow" | "medium" | "wide";
/** How a page turns: a curling leaf, a slide, a crossfade, or instantly. */
export type ReaderTurn = "curl" | "slide" | "fade" | "none";

export type ReaderSettings = {
  font: ReaderFont;
  /** percent of the base reading size */
  fontSize: number;
  lineHeight: number;
  margin: ReaderMargin;
  theme: ReaderTheme;
  layout: ReaderLayout;
  flow: ReaderFlow;
  justify: boolean;
  turn: ReaderTurn;
};

export const DEFAULT_SETTINGS: ReaderSettings = {
  font: "noto-serif",
  fontSize: 100,
  lineHeight: 1.85,
  margin: "medium",
  theme: "light",
  layout: "auto",
  flow: "paginated",
  justify: false,
  turn: "curl",
};

export const FONT_SIZES = [80, 90, 100, 110, 120, 135, 150, 170, 190] as const;
export const LINE_HEIGHTS = [1.6, 1.75, 1.85, 2.0, 2.2] as const;

export const FONTS: Record<ReaderFont, { family: string; label: string }> = {
  "noto-serif": { family: `"Noto Serif Bengali", "Tiro Bangla", serif`, label: "নোটো সেরিফ" },
  tiro: { family: `"Tiro Bangla", "Noto Serif Bengali", serif`, label: "তিরো বাংলা" },
  hind: { family: `"Hind Siliguri", "Noto Serif Bengali", sans-serif`, label: "হিন্দ শিলিগুড়ি" },
  anek: { family: `"Anek Bangla", "Hind Siliguri", sans-serif`, label: "অনেক বাংলা" },
};

/** Page colours. Text never pure black on white or pure white on black. */
export const THEMES: Record<ReaderTheme, { paper: string; ink: string; muted: string; desk: string; link: string; selection: string }> = {
  light: { paper: "#FBF8F2", ink: "#282720", muted: "#6B665A", desk: "#E9E0CF", link: "#2A4639", selection: "rgba(194,160,108,.38)" },
  sepia: { paper: "#F1E5CC", ink: "#3B2F22", muted: "#6E5E48", desk: "#D9C9A8", link: "#5B3A1E", selection: "rgba(166,93,78,.28)" },
  dark: { paper: "#202423", ink: "#D8D1C2", muted: "#9C9586", desk: "#151817", link: "#B5C9BE", selection: "rgba(194,160,108,.32)" },
};

const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  typeof v === "string" && (options as readonly string[]).includes(v) ? (v as T) : fallback;

const nearest = (v: unknown, options: readonly number[], fallback: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? options.reduce((best, o) => (Math.abs(o - v) < Math.abs(best - v) ? o : best), options[0])
    : fallback;

/** Coerces untrusted stored data into valid settings (schema-versioned by shape). */
export function normalizeSettings(input: unknown): ReaderSettings {
  const s = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof ReaderSettings, unknown>>;
  return {
    font: oneOf(s.font, Object.keys(FONTS) as ReaderFont[], DEFAULT_SETTINGS.font),
    fontSize: nearest(s.fontSize, FONT_SIZES, DEFAULT_SETTINGS.fontSize),
    lineHeight: nearest(s.lineHeight, LINE_HEIGHTS, DEFAULT_SETTINGS.lineHeight),
    margin: oneOf(s.margin, ["narrow", "medium", "wide"] as const, DEFAULT_SETTINGS.margin),
    theme: oneOf(s.theme, ["light", "sepia", "dark"] as const, DEFAULT_SETTINGS.theme),
    layout: oneOf(s.layout, ["auto", "single", "spread"] as const, DEFAULT_SETTINGS.layout),
    flow: oneOf(s.flow, ["paginated", "scrolled"] as const, DEFAULT_SETTINGS.flow),
    justify: typeof s.justify === "boolean" ? s.justify : DEFAULT_SETTINGS.justify,
    // older settings had an on/off switch for page-turn animation
    turn: oneOf(s.turn, ["curl", "slide", "fade", "none"] as const, (s as { animations?: unknown }).animations === false ? "none" : DEFAULT_SETTINGS.turn),
  };
}

export function stepFontSize(current: number, dir: 1 | -1): number {
  const i = FONT_SIZES.indexOf(current as (typeof FONT_SIZES)[number]);
  const next = Math.min(FONT_SIZES.length - 1, Math.max(0, (i < 0 ? 2 : i) + dir));
  return FONT_SIZES[next];
}
