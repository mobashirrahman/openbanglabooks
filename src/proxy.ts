import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

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
 * 3. Admin pages (/admin…, server-rendered as the signed-in editor): the
 *    session is refreshed here, where cookies can still be written, so the
 *    page never works with an expired token. Elsewhere the browser keeps
 *    its own session fresh.
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
    // not 'none': the chapter iframes are blob: documents that inherit this
    // policy, and WebKit applies the inherited frame-ancestors to them – with
    // 'none' Safari refuses to load the book. 'self' still blocks every other
    // site from framing the reader.
    "frame-ancestors 'self'",
  ].join("; ");
}

type CookieToSet = { name: string; value: string; options?: Parameters<NextResponse["cookies"]["set"]>[2] };

/** Refreshes an expiring Supabase session; returns the cookies to send back. */
async function refreshSession(request: NextRequest): Promise<CookieToSet[]> {
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"))) return [];
  const out: CookieToSet[] = [];
  const client = createServerClient(supabase, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "", {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const c of list) {
          request.cookies.set(c.name, c.value);
          out.push(c);
        }
      },
    },
  });
  try {
    await client.auth.getUser();
  } catch {
    // auth server unreachable: the page reports it
  }
  return out;
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (pathname === "/bn" || pathname.startsWith("/bn/")) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(3) || "/";
    return NextResponse.redirect(url, 308);
  }

  const isEnglish = pathname === "/en" || pathname.startsWith("/en/");
  const bare = isEnglish ? pathname.slice(3) || "/" : pathname;
  const isReader = bare.startsWith("/read/");
  const isAdmin = bare === "/admin" || bare.startsWith("/admin/");
  // before the request headers are copied: refreshed cookies reach the page
  const refreshed = isAdmin ? await refreshSession(request) : [];

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
  for (const c of refreshed) response.cookies.set(c.name, c.value, c.options);
  if (isAdmin) response.headers.set("Cache-Control", "private, no-store");
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
