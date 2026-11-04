/**
 * Geometry of the OpenBanglaBooks mark: a punthi (palm-leaf manuscript) folio
 * whose two halves hinge open into a shallow open book. Each half keeps one
 * of the folio's two string holes – the identifying detail.
 *
 * Shared by the brand asset generator (scripts/render/brand.ts) and the
 * inline/animated React mark, so every rendition is the same drawing.
 * Coordinates are in a 64×64 grid.
 */

export const MARK_VIEWBOX = 64;
/** Spine (hinge) point both leaves rotate around. */
export const PIVOT = { x: 32, y: 44 } as const;
/** Opening angle of each leaf in degrees, when the book is open. */
export const OPEN_ANGLE = 14;

export type MarkVariant = "default" | "small";

const SPEC = {
  // two slivers under each leaf suggest the stacked folios of a punthi bundle
  default: { length: 25, thickness: 10, gap: 0.8, radius: 2.4, hole: 2.1, slivers: 2, sliver: 1.7, sliverGap: 1.2 },
  // favicon sizes: chunkier leaves, larger holes, one sliver – survives 16px
  small: { length: 25, thickness: 12, gap: 1.2, radius: 2.6, hole: 2.9, slivers: 1, sliver: 2.6, sliverGap: 2 },
} as const;

function roundedRect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  hole?: { cx: number; cy: number; r: number },
): string {
  const n = (v: number) => Number(v.toFixed(2));
  return (
    `M${n(x + r)},${n(y)}H${n(x + w - r)}A${r},${r} 0 0 1 ${n(x + w)},${n(y + r)}` +
    `V${n(y + h - r)}A${r},${r} 0 0 1 ${n(x + w - r)},${n(y + h)}` +
    `H${n(x + r)}A${r},${r} 0 0 1 ${n(x)},${n(y + h - r)}` +
    `V${n(y + r)}A${r},${r} 0 0 1 ${n(x + r)},${n(y)}Z` +
    (hole
      ? `M${n(hole.cx - hole.r)},${n(hole.cy)}a${hole.r},${hole.r} 0 1 0 ${n(hole.r * 2)},0` +
        `a${hole.r},${hole.r} 0 1 0 ${n(-hole.r * 2)},0Z`
      : "")
  );
}

function stackHeight(variant: MarkVariant) {
  const s = SPEC[variant];
  return s.thickness + s.slivers * (s.sliver + s.sliverGap);
}

/**
 * Unrotated paths (closed folio). Each side = leaf with string hole + page slivers.
 * Rotate the left side by +angle and the right by −angle around PIVOT.
 */
export function leafPaths(variant: MarkVariant = "default") {
  const s = SPEC[variant];
  const top = PIVOT.y - stackHeight(variant);
  const cy = top + s.thickness / 2;
  const side = (x: number) => {
    const leaf = roundedRect(x, top, s.length, s.thickness, s.radius, {
      cx: x + s.length / 2,
      cy,
      r: s.hole,
    });
    const slivers: string[] = [];
    for (let i = 0; i < s.slivers; i++) {
      const y = top + s.thickness + s.sliverGap + i * (s.sliver + s.sliverGap);
      const inset = (i + 1) * 1.6; // each lower folio is a touch shorter
      const w = s.length - inset;
      const sx = x < PIVOT.x ? x + inset : x;
      slivers.push(roundedRect(sx, y, w, s.sliver, s.sliver / 2));
    }
    return { leaf, slivers };
  };
  return { left: side(PIVOT.x - s.gap - s.length), right: side(PIVOT.x + s.gap) };
}

/** Vertical offset that centres the open mark inside the 64 grid. */
export function openMarkOffset(variant: MarkVariant = "default"): number {
  const s = SPEC[variant];
  const a = (OPEN_ANGLE * Math.PI) / 180;
  const reach = s.gap + s.length;
  const topY = PIVOT.y - (reach * Math.sin(a) + stackHeight(variant) * Math.cos(a));
  return MARK_VIEWBOX / 2 - (topY + PIVOT.y) / 2;
}

/** Static SVG markup (group contents) for the open mark. */
export function openMarkSvg(fill: string, variant: MarkVariant = "default"): string {
  const { left, right } = leafPaths(variant);
  const dy = Number(openMarkOffset(variant).toFixed(2));
  const { x, y } = PIVOT;
  const side = (p: { leaf: string; slivers: string[] }, angle: number) =>
    `<g transform="rotate(${angle} ${x} ${y})"><path d="${p.leaf}"/>` +
    p.slivers.map((d) => `<path d="${d}"/>`).join("") +
    `</g>`;
  return (
    `<g transform="translate(0 ${dy})" fill="${fill}" fill-rule="evenodd">` +
    side(left, OPEN_ANGLE) +
    side(right, -OPEN_ANGLE) +
    `</g>`
  );
}
