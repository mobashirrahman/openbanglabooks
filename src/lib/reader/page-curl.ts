"use client";

/**
 * A page curl, drawn over the live book with the View Transitions API.
 *
 * The browser snapshots the outgoing page (text, highlights, shadows: exact
 * pixels) and shows the incoming page live underneath. Each frame we clip the
 * snapshots to the geometry of a folding leaf – the flat part still lying on
 * the book, and the lifted part folded over as a shaded "flap" (the back of
 * the paper) – so text is never re-laid out or distorted, it is only revealed.
 *
 * The geometry is the classic flat fold: with the page's corner C dragged to
 * P, the fold line is the perpendicular bisector of CP, the lifted part is
 * the corner's side of it, and the flap is that part reflected across the
 * fold. Timed turns move P along a gentle arc; a drag puts P under the finger.
 */

type Pt = [number, number];
type Box = { w: number; h: number };
export type CurlLayout = { box: Box; spread: boolean };

const STYLE_ID = "obb-curl-frame";

// ── geometry ──────────────────────────────────────────────────────────────

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Pt, b: Pt) => a[0] * b[0] + a[1] * b[1];

/** Sutherland–Hodgman: the part of a convex polygon on the side where f(p) ≥ 0. */
function clipHalf(poly: Pt[], f: (p: Pt) => number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const fa = f(a);
    const fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

export type Fold = {
  /** the turning leaf's part still lying flat */
  flat: Pt[];
  /** the leaf's part that has been lifted (where the page beneath shows) */
  lifted: Pt[];
  /** the lifted part folded over: the back of the paper */
  flap: Pt[];
  /** a point on the fold line and its unit normal (pointing towards the flap) */
  m: Pt;
  n: Pt;
};

/**
 * The fold of a leaf spanning x0…x1 (the spine at x0) whose corner C has been
 * moved to P. P is first kept physically possible: the leaf stays attached at
 * the spine, so P can never be further from the spine's ends than C is.
 */
export function fold(x0: number, x1: number, h: number, C: Pt, P: Pt): Fold {
  const leaf = rect(x0, 0, x1, h);
  for (const S of [
    [x0, 0],
    [x0, h],
  ] as Pt[]) {
    const r = Math.hypot(C[0] - S[0], C[1] - S[1]);
    const d = Math.hypot(P[0] - S[0], P[1] - S[1]);
    if (d > r) P = [S[0] + ((P[0] - S[0]) * r) / d, S[1] + ((P[1] - S[1]) * r) / d];
  }
  const cp = sub(P, C);
  const len = Math.hypot(cp[0], cp[1]);
  if (len < 0.5) return { flat: leaf, lifted: [], flap: [], m: C, n: [-1, 0] };
  const n: Pt = [cp[0] / len, cp[1] / len];
  const m: Pt = [(C[0] + P[0]) / 2, (C[1] + P[1]) / 2];
  const side = (p: Pt) => dot(sub(p, m), n);
  const flat = clipHalf(leaf, side);
  const lifted = clipHalf(leaf, (p) => -side(p));
  const flap = lifted.map((p): Pt => {
    const d = 2 * side(p);
    return [p[0] - d * n[0], p[1] - d * n[1]];
  });
  return { flat, lifted, flap, m, n };
}

// ── drawing ───────────────────────────────────────────────────────────────

const poly = (pts: Pt[]) => (pts.length < 3 ? "polygon(0 0, 0 0, 0 0)" : `polygon(${pts.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(",")})`);
const sub_path = (pts: Pt[]) => (pts.length < 3 ? "" : `M${pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`);

/** Moves the coordinates of a polygon()/path() clip by (dx, dy). */
function shift(clip: string, dx: number, dy: number) {
  if (clip.startsWith("polygon(")) return clip.replace(/(-?[\d.]+)px (-?[\d.]+)px/g, (_, x, y) => `${(+x + dx).toFixed(1)}px ${(+y + dy).toFixed(1)}px`);
  return clip.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `${(+x + dx).toFixed(1)} ${(+y + dy).toFixed(1)}`);
}

/** A CSS linear-gradient whose stops are measured from a line through `m` along direction `u`, in a w×h box. */
function gradientAlong(box: Box, m: Pt, u: Pt, stops: [number, string][]) {
  const angle = (Math.atan2(u[0], -u[1]) * 180) / Math.PI; // CSS: 0deg points up, 90deg right
  const L = Math.abs(box.w * u[0]) + Math.abs(box.h * u[1]);
  const t0 = dot(sub(m, [box.w / 2, box.h / 2]), u) + L / 2;
  return `linear-gradient(${angle.toFixed(2)}deg, ${stops.map(([d, c]) => `${c} ${(t0 + d).toFixed(1)}px`).join(", ")})`;
}

type Frame = {
  /** which snapshot turns: the outgoing page (forward), or the incoming one swinging back */
  moving: "old" | "new";
  clip: string;
  /** the same, with the flap's shape cut out too (where live layers must show through: root mode) */
  clipOpen: string;
  flapClip: string;
  flapBackground: string;
  shadeClip: string;
  shadeBackground: string;
  /** the shadow the lifting paper throws on the part of the page still flat */
  creaseClip: string;
  creaseBackground: string;
};

/**
 * One frame of a turn. `p` is where the corner is, in page-box coordinates
 * (for a spread's backward turn the box is mirrored: the left leaf turns).
 */
function frame(layout: CurlLayout, mirror: boolean, reversed: boolean, C: Pt, P: Pt, paper: string): Frame {
  const { box, spread } = layout;
  const mx = (pts: Pt[]) => (mirror ? pts.map(([x, y]): Pt => [box.w - x, y]) : pts);
  const mp = (p: Pt): Pt => (mirror ? [box.w - p[0], p[1]] : p);
  const x0 = spread ? box.w / 2 : 0;
  const f = fold(x0, box.w, box.h, mp(C), mp(P));
  const m = mp(f.m);
  const n: Pt = mirror ? [-f.n[0], f.n[1]] : f.n;
  const flat = mx(f.flat);
  const lifted = mx(f.lifted);
  const flap = mx(f.flap);

  // the back of the paper is drawn only over its own leaf; on a spread, where it
  // lands on the other page, the incoming page shows through it instead
  const flapOnLeaf = spread ? clipHalf(flap, (p) => (mirror ? box.w / 2 - p[0] : p[0] - box.w / 2)) : flap;
  const otherPage = spread ? mx(rect(0, 0, box.w / 2, box.h)) : [];

  // forward (and every spread turn): the outgoing page keeps its flat part and the
  // other page, minus where the flap lies (evenodd cuts it out)
  const clip =
    reversed
      ? poly(flat) // backward on one page: the incoming page swings back in, flat part showing
      : `path(evenodd, "${sub_path(flat)}${sub_path(otherPage)}${spread ? sub_path(flap) : ""}")`;

  const fx = (d: number, a: number) => [d, `rgba(0,0,0,${a})`] as [number, string];
  return {
    moving: reversed ? "new" : "old",
    clip,
    clipOpen: `path(evenodd, "${sub_path(flat)}${sub_path(otherPage)}${sub_path(flap)}")`,
    flapClip: poly(flapOnLeaf),
    // the back of the paper: a dark crease at the fold, a narrow specular band
    // where the sheet rolls, then the paper's own colour with a soft falloff
    flapBackground: `${gradientAlong(box, m, n, [
      fx(0, 0.26),
      [2.5, "rgba(255,255,255,0.18)"],
      fx(9, 0.1),
      [30, "rgba(255,255,255,0.08)"],
      fx(80, 0.02),
      fx(300, 0.05),
    ])}, ${paper}`,
    shadeClip: poly(lifted),
    // the shadow the curling leaf casts on the page it uncovers
    shadeBackground: gradientAlong(box, m, [-n[0], -n[1]], [fx(0, 0.34), fx(14, 0.16), fx(52, 0.07), fx(170, 0)]),
    creaseClip: poly(flat),
    // …and the shadow its still-flat part carries just before the fold (n
    // points into the flat side, so the shading fades as the distance grows)
    creaseBackground: gradientAlong(box, m, n, [fx(0, 0.2), fx(16, 0.09), fx(70, 0)]),
  };
}

// ── the turn ──────────────────────────────────────────────────────────────

export function curlSupported() {
  return turnMode() !== null;
}

/**
 * How this engine can show the incoming page during a transition.
 * - "named" (Blink): the page is its own transition layer; its live image
 *   includes the book's iframe.
 * - "root" (WebKit – Safari, and every browser on iPhone and iPad): a named
 *   element's live image leaves out iframe content, but the live document
 *   itself shows through wherever the screen snapshot is clipped away.
 * Other engines (not verified): no transition-based turns.
 */
export function turnMode(): "named" | "root" | null {
  if (typeof document === "undefined" || typeof document.startViewTransition !== "function") return null;
  const ua = navigator.userAgent;
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return "named";
  if (/AppleWebKit\//.test(ua)) return "root";
  return null;
}

// A page set in motion leaves quickly and settles: the corner's speed peaks
// early, like a sheet of paper let go, instead of the symmetric ease-in-out
// that made the timed turn feel mechanical.
const ease = (t: number) => 1 - (1 - t) ** 4;

export type CurlElements = { page: HTMLElement; flap: HTMLElement; shade: HTMLElement; crease: HTMLElement };

/** Where the corner rests, and where it goes when the leaf has turned over. */
function endpoints(layout: CurlLayout, corner: "bottom" | "top") {
  const { box, spread } = layout;
  const y = corner === "bottom" ? box.h : 0;
  const x0 = spread ? box.w / 2 : 0;
  const C: Pt = [box.w, y];
  const D: Pt = [2 * x0 - box.w, y];
  return { C, D };
}

export type CurlTurn = {
  /** the finger moved (page coordinates) – for drags */
  moveTo(finger: Pt): void;
  /** the finger was lifted: finishes the turn if it went far or fast enough, otherwise lays the page back */
  release(): Promise<boolean>;
  /** the gesture was interrupted (a pinch, a system gesture): always lays the page back */
  cancel(): Promise<boolean>;
};

/**
 * Starts a turn. `change` performs the actual page change (instantly) while
 * the old page is frozen on screen; `revert` undoes it if a drag is let go
 * early. A timed turn (no drag) plays on its own and resolves when done.
 */
export function startCurl(opts: {
  els: CurlElements;
  layout: CurlLayout;
  dir: 1 | -1;
  paper: string;
  change: () => Promise<void>;
  revert: () => Promise<void>;
  drag?: { start: Pt };
  duration?: number;
}): CurlTurn & { done: Promise<boolean> } {
  const { els, layout, dir, paper } = opts;
  const mode = turnMode() ?? "named";
  const corner = opts.drag && opts.drag.start[1] < layout.box.h / 2 ? "top" : "bottom";
  const { C, D } = endpoints(layout, corner);
  // forward turns move the corner C → D. Backward: on a spread the left leaf turns (mirrored);
  // on one page the previous page swings back in (D → C) – or, where the live page can only
  // show beneath the snapshot (root mode), the current page peels away to the right (mirrored)
  const reversed = !layout.spread && dir === -1 && mode === "named";
  const mirror = dir === -1 && !reversed;
  const mirrorX = (p: Pt): Pt => (mirror ? [layout.box.w - p[0], p[1]] : p);
  const from = reversed ? D : C;
  const to = reversed ? C : D;
  let current: Pt = from;
  // the finger's recent positions (canonical coordinates), for its speed at release
  const trail: { p: Pt; t: number }[] = [];

  const root = document.documentElement;
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }
  // root mode clips the whole-screen snapshot: page geometry moves to screen coordinates
  const at = mode === "root" ? els.page.getBoundingClientRect() : null;
  const draw = (P: Pt) => {
    current = P;
    const f = frame(layout, mirror, reversed, mirrorX(C), mirrorX(P), paper);
    els.flap.style.background = f.flapBackground;
    els.shade.style.background = f.shadeBackground;
    els.crease.style.background = f.creaseBackground;
    if (at) {
      // root mode: the paper layers are live above the page, seen through
      // holes cut in the screen snapshot (WebKit's live images miss their per-frame changes)
      els.flap.style.clipPath = f.flapClip;
      els.shade.style.clipPath = f.shadeClip;
      els.crease.style.clipPath = f.creaseClip;
      style!.textContent = `html[data-curl]::view-transition-old(root){clip-path:${shift(f.clipOpen, at.left, at.top)}}`;
    } else {
      style!.textContent = `html[data-curl]::view-transition-${f.moving}(obb-page){clip-path:${f.clip}}
html[data-curl]::view-transition-new(obb-flap){clip-path:${f.flapClip}}
html[data-curl]::view-transition-new(obb-shade){clip-path:${f.shadeClip}}
html[data-curl]::view-transition-new(obb-crease){clip-path:${f.creaseClip}}`;
    }
  };

  if (mode === "named") {
    els.page.style.viewTransitionName = "obb-page";
    els.flap.style.viewTransitionName = "obb-flap";
    els.shade.style.viewTransitionName = "obb-shade";
    els.crease.style.viewTransitionName = "obb-crease";
  }
  root.dataset.curl = mode === "root" ? "root" : reversed ? "new-top" : "old-top";
  draw(from);

  const vt = document.startViewTransition(() => opts.change());
  let resolveDone!: (v: boolean) => void;
  const done = new Promise<boolean>((r) => (resolveDone = r));

  const cleanup = () => {
    els.page.style.viewTransitionName = "";
    els.flap.style.viewTransitionName = "";
    els.shade.style.viewTransitionName = "";
    els.crease.style.viewTransitionName = "";
    els.flap.style.clipPath = "";
    els.shade.style.clipPath = "";
    els.crease.style.clipPath = "";
    delete root.dataset.curl;
    style!.textContent = "";
  };

  const animate = (target: Pt, ms: number) =>
    new Promise<void>((resolve) => {
      const start = current;
      const t0 = performance.now();
      // a shallow arc: the corner travels, it does not leap off the book
      const lift = layout.box.h * 0.075 * (corner === "bottom" ? 1 : -1);
      const step = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const e = ease(t);
        const x = start[0] + (target[0] - start[0]) * e;
        // timed turns lift the corner in a soft arc; drags already carry the finger's height
        const arc = opts.drag ? 0 : Math.sin(Math.PI * e) * lift;
        const y = start[1] + (target[1] - start[1]) * e - arc;
        draw([x, y]);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

  let finished = false;
  const finish = async (complete: boolean) => {
    if (finished) return complete;
    finished = true;
    try {
      await vt.ready;
    } catch {
      cleanup();
      resolveDone(true);
      return true;
    }
    const dist = Math.hypot(current[0] - (complete ? to : from)[0], current[1] - (complete ? to : from)[1]);
    const full = Math.hypot(to[0] - from[0], to[1] - from[1]);
    await animate(complete ? to : from, Math.max(140, (opts.duration ?? 460) * (dist / full)));
    if (!complete) await opts.revert().catch(() => {});
    vt.skipTransition();
    await vt.finished.catch(() => {});
    cleanup();
    resolveDone(complete);
    return complete;
  };

  if (!opts.drag) void finish(true);
  const start = opts.drag ? mirrorX(opts.drag.start) : from;
  return {
    done,
    moveTo: (finger) => {
      if (finished) return;
      const f = mirrorX(finger);
      trail.push({ p: f, t: performance.now() });
      if (trail.length > 5) trail.shift();
      // forward: the corner follows the finger; backward on one page: the fold line does
      const k = reversed ? 2 : 1;
      const P: Pt = [from[0] + k * (f[0] - start[0]), from[1] + (f[1] - start[1])];
      // remember the finger's place even before the transition is ready to draw:
      // a very fast flick can be let go while the snapshot is still being taken
      current = P;
      void vt.ready.then(() => !finished && draw(P)).catch(() => {});
    },
    release: () => {
      const span: Pt = sub(to, from);
      const progress = dot(sub(current, from), span) / dot(span, span);
      let speed = 0; // px per ms along the turn
      if (trail.length >= 2) {
        const a = trail[0];
        const b = trail[trail.length - 1];
        const along = dot(sub(b.p, a.p), span) / Math.hypot(span[0], span[1]);
        speed = along / Math.max(1, b.t - a.t);
      }
      // A finger only has to travel about a quarter of the page, or flick it
      // with intent: needing nearly half the page made ordinary swipes fall back.
      return finish(progress > 0.26 || (speed > 0.22 && progress > 0.02));
    },
    cancel: () => finish(false),
  };
}

/** A plain crossfade (reduced motion, or the "fade" style). */
export async function fadeTurn(page: HTMLElement, change: () => Promise<void>) {
  const mode = turnMode();
  if (!mode) return change();
  if (mode === "named") page.style.viewTransitionName = "obb-page";
  document.documentElement.dataset.fade = mode;
  const vt = document.startViewTransition(() => change());
  await vt.finished.catch(() => {});
  page.style.viewTransitionName = "";
  delete document.documentElement.dataset.fade;
}
