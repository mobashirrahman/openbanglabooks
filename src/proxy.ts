import { NextResponse, type NextRequest } from "next/server";

/**
 * 1. Locale routing: Bengali is served without a prefix (rewritten to /bn/…),
 *    English lives under /en. Requests for /bn/… redirect to the canonical
 *    unprefixed URL.
 * 2. Content Security Policy:
 *    - catalog pages (static): a baseline policy
 *    - the reader (/read/…, dynamic): a strict nonce policy with no
 *      'unsafe-inline' scripts. EPUB sections render in blob: iframes, which
 *      inherit this policy, so scripts inside books cannot run.
 *    The reader is a separate root layout, so navigating into it is always a
 *    full document load and the strict policy is always the one in force.
 */

const isDev = process.env.NODE_ENV === "development";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

function baselineCsp() {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${supabase}${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function readerCsp(nonce: string) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // EPUB stylesheets are rewritten to blob: URLs and books use inline styles
    "style-src 'self' 'unsafe-inline' blob:",
    "img-src 'self' data: blob:",
    "font-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src 'self' ${supabase}${isDev ? " ws: wss:" : ""}`,
    "frame-src 'self' blob:",
    "child-src 'self' blob:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/bn" || pathname.startsWith("/bn/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(3) || "/";
    return NextResponse.redirect(url, 308);
  }

  const isEnglish = pathname === "/en" || pathname.startsWith("/en/");
  const bare = isEnglish ? pathname.slice(3) || "/" : pathname;
  const isReader = bare.startsWith("/read/");

  const requestHeaders = new Headers(request.headers);
  let csp: string;
  if (isReader) {
    const nonce = btoa(crypto.randomUUID());
    csp = readerCsp(nonce);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", csp);
  } else {
    csp = baselineCsp();
  }

  const response = isEnglish
    ? NextResponse.next({ request: { headers: requestHeaders } })
    : NextResponse.rewrite(new URL(`/bn${pathname === "/" ? "" : pathname}${search}`, request.url), {
        request: { headers: requestHeaders },
      });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // pages only: skip API routes, Next internals, metadata files and static assets
      source:
        "/((?!api|_next/static|_next/image|fonts|brand|icons|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|robots.txt|sitemap.xml|.*\\.[a-z0-9]+$).*)",
    },
  ],
};
