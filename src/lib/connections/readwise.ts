import "server-only";
import { ConnectionError } from "./store";

/**
 * Readwise's highlights API (v2, https://readwise.io/api_deets), checked
 * 2026-11-05. Readwise has no OAuth: a reader copies their access token
 * from readwise.io/access_token, which is the way Readwise documents.
 */

const base = () => (process.env.READWISE_API_URL || "https://readwise.io/api/v2").replace(/\/$/, "");
const headers = (token: string) => ({
  Authorization: `Token ${token}`,
  "Content-Type": "application/json",
  "User-Agent": "OpenBanglaBooks (+https://openbanglabooks.com)",
});

/** True for a working token (204), false for one Readwise refuses. */
export async function readwiseCheck(token: string): Promise<boolean> {
  const res = await fetch(`${base()}/auth/`, { headers: headers(token), cache: "no-store" }).catch(() => null);
  if (!res) throw new ConnectionError("upstream");
  if (res.status === 204) return true;
  if (res.status === 401 || res.status === 403) return false;
  throw new ConnectionError(res.status === 429 ? "rateLimited" : "upstream", retryAfter(res));
}

export type ReadwiseHighlight = {
  text: string;
  title: string;
  author: string;
  note?: string;
  /** the order of the highlight in the book */
  location: number;
  location_type: "order";
  highlighted_at: string;
  /** unique per highlight: sending it again updates the highlight instead of adding another */
  highlight_url: string;
  source_url?: string;
  category: "books";
  source_type: string;
};

function retryAfter(res: Response): number {
  const s = Number(res.headers.get("Retry-After"));
  return Number.isFinite(s) && s > 0 ? Math.min(s, 300) : 30;
}

/** Creates (or, by highlight_url, updates) highlights. */
export async function readwiseCreate(token: string, highlights: ReadwiseHighlight[]): Promise<void> {
  const res = await fetch(`${base()}/highlights/`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ highlights }),
    cache: "no-store",
  }).catch(() => null);
  if (!res) throw new ConnectionError("upstream");
  if (res.status === 429) throw new ConnectionError("rateLimited", retryAfter(res));
  if (res.status === 401 || res.status === 403) throw new ConnectionError("reconnect");
  if (!res.ok) throw new ConnectionError("upstream", undefined, `readwise ${res.status}: ${(await res.text()).slice(0, 300)}`);
}
