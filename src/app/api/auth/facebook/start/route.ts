import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/account/next";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { siteUrl } from "@/lib/seo/site";

/** Holds the OAuth state and where to return; HttpOnly and short-lived. */
const COOKIE = "obb-facebook-oauth";
const MAX_AGE = 10 * 60;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function signInError(locale: Locale) {
  const url = new URL(localizedPath(locale, "/signin"), siteUrl());
  url.searchParams.set("error", "facebook");
  return NextResponse.redirect(url);
}

/**
 * Starts a first-party Facebook sign-in. The browser goes to Facebook with our
 * own callback (/api/auth/facebook/callback), so the OAuth redirect domain is
 * openbanglabooks.com and the app only needs that domain in App Domains.
 */
export async function GET(request: NextRequest) {
  const locale: Locale = request.nextUrl.searchParams.get("locale") === "en" ? "en" : "bn";
  const clientId = process.env.FACEBOOK_CLIENT_ID;
  if (!clientId) return signInError(locale);

  const next = safeNext(request.nextUrl.searchParams.get("next"), localizedPath(locale, "/library"));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const redirectUri = new URL("/api/auth/facebook/callback", siteUrl()).toString();

  const authorize = new URL("https://www.facebook.com/v22.0/dialog/oauth");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "email");
  authorize.searchParams.set("state", state);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(COOKIE, encodeURIComponent(JSON.stringify({ state, next, locale })), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/facebook",
    maxAge: MAX_AGE,
  });
  return response;
}
