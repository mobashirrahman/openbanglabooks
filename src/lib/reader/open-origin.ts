/**
 * Hand-off for the book-opening transition. The reader is a separate document
 * (strict CSP), so the position of the tapped cover is passed through
 * sessionStorage and read on the reader's first frame.
 */
const KEY = "obb:open-origin";
const MAX_AGE_MS = 6000;

export type OpenOrigin = { slug: string; left: number; top: number; width: number; height: number; t: number };

export function recordOpenOrigin(slug: string, el: Element) {
  const r = el.getBoundingClientRect();
  if (!r.width) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ slug, left: r.left, top: r.top, width: r.width, height: r.height, t: Date.now() }));
  } catch {}
}

export function readOpenOrigin(slug: string): OpenOrigin | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as OpenOrigin;
    if (o.slug !== slug || Date.now() - o.t > MAX_AGE_MS) return null;
    return o;
  } catch {
    return null;
  }
}
