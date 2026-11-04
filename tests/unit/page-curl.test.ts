import { describe, expect, it } from "vitest";
import { fold } from "@/lib/reader/page-curl";

const xs = (pts: [number, number][]) => pts.map((p) => Math.round(p[0])).sort((a, b) => a - b);
const area = (pts: [number, number][]) =>
  Math.abs(pts.reduce((s, p, i) => s + p[0] * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * p[1], 0)) / 2;

describe("page curl geometry", () => {
  const W = 100;
  const H = 150;
  const C: [number, number] = [W, H];

  it("an unmoved corner leaves the leaf flat", () => {
    const f = fold(0, W, H, C, C);
    expect(area(f.flat)).toBe(W * H);
    expect(f.flap).toEqual([]);
  });

  it("half a turn folds the leaf down the middle", () => {
    const f = fold(0, W, H, C, [0, H]);
    expect(Math.round(area(f.flat))).toBe((W * H) / 2);
    expect(Math.round(area(f.lifted))).toBe((W * H) / 2);
    // the flap is the lifted half, reflected onto the flat half
    expect(Math.min(...xs(f.flap))).toBe(0);
    expect(Math.max(...xs(f.flap))).toBe(50);
  });

  it("area is conserved: flat + lifted is always the whole leaf, and the flap is as large as the lifted part", () => {
    for (const P of [
      [80, 120],
      [40, 140],
      [10, 90],
      [60, 60],
    ] as [number, number][]) {
      const f = fold(0, W, H, C, P);
      expect(area(f.flat) + area(f.lifted)).toBeCloseTo(W * H, 6);
      expect(area(f.flap)).toBeCloseTo(area(f.lifted), 6);
    }
  });

  it("a corner at its mirror position has turned the whole leaf over", () => {
    const f = fold(0, W, H, C, [-W, H]);
    expect(Math.round(area(f.lifted))).toBe(W * H);
    expect(Math.min(...xs(f.flap))).toBe(-100);
  });

  it("keeps the leaf attached at the spine: an over-pulled corner never stretches the paper", () => {
    for (const P of [
      [-300, H],
      [-50, -200],
      [250, 400],
    ] as [number, number][]) {
      const f = fold(0, W, H, C, P);
      // every point of the flap stays within the leaf's reach from the spine's ends
      for (const q of f.flap) {
        expect(Math.hypot(q[0], q[1])).toBeLessThanOrEqual(Math.hypot(W, H) + 1e-6);
        expect(Math.hypot(q[0], q[1] - H)).toBeLessThanOrEqual(Math.hypot(W, H) + 1e-6);
      }
      expect(area(f.flat) + area(f.lifted)).toBeCloseTo(W * H, 6);
    }
  });

  it("works for the right leaf of a spread (spine in the middle)", () => {
    const f = fold(W, 2 * W, H, [2 * W, H], [W, H]);
    expect(Math.round(area(f.flat))).toBe((W * H) / 2);
    expect(Math.min(...xs(f.flat))).toBe(100);
  });
});
