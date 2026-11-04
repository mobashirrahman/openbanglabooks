/**
 * Minimal transformer for the absolute SVG path data HarfBuzz emits
 * (M, L, Q, C, Z with "x,y" pairs). Applies scale + translate and flips the
 * y axis (font units are y-up, SVG is y-down).
 */
export function transformPath(d: string, s: number, tx: number, ty: number, precision = 2): string {
  const f = (n: number) => {
    const v = Number(n.toFixed(precision));
    return Object.is(v, -0) ? "0" : String(v);
  };
  return d.replace(/([MLQCZ])([^MLQCZ]*)/g, (_, cmd: string, args: string) => {
    if (cmd === "Z") return "Z";
    const nums = args.split(/[ ,]+/).filter(Boolean).map(Number);
    const out: string[] = [];
    for (let i = 0; i < nums.length; i += 2) {
      out.push(`${f(tx + nums[i] * s)},${f(ty - nums[i + 1] * s)}`);
    }
    return cmd + out.join(" ");
  });
}
