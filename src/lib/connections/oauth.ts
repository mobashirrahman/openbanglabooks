import "server-only";
import type { NextRequest } from "next/server";

export const OAUTH_COOKIE = "obb_hc_oauth";
export const OAUTH_PATH = "/api/connections/hardcover";
export const OAUTH_MAX_AGE = 600;

export type PendingSignIn = { state: string; verifier: string; next: string; redirectUri: string; at: number };

/** Only same-site paths: `next` comes from a URL and must never send a reader elsewhere. */
export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}

/** The callback address registered with Hardcover: this site's own, unless set explicitly. */
export const redirectUriFor = (request: NextRequest) =>
  process.env.HARDCOVER_REDIRECT_URI || new URL(`${OAUTH_PATH}/callback`, request.nextUrl.origin).toString();

/** `next` with ?hardcover=<outcome>, on this site. */
export function back(request: NextRequest, next: string, outcome: string): URL {
  const url = new URL(next, request.nextUrl.origin);
  url.searchParams.set("hardcover", outcome);
  if (/\/profile$/.test(url.pathname)) url.hash = "connections";
  return url;
}
