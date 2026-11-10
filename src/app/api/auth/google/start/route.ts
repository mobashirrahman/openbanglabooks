import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/account/next";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { siteUrl } from "@/lib/seo/site";

/** Holds the OAuth state, PKCE verifier and where to return; HttpOnly and short-lived. */
const COOKIE = "obb-google-oauth";
const MAX_AGE = 10 * 60;

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

function signInError(locale: Locale) {
  const url = new URL(localizedPath(locale, "/signin"), siteUrl());
  url.searchParams.set("error", "google");
  return NextResponse.redirect(url);
}

/**
 * Starts a first-party Google sign-in. The browser goes to Google with our own
 * callback (/api/auth/google/callback), so the consent screen shows
 * openbanglabooks.com rather than the Supabase project domain.
 */
export async function GET(request: NextRequest) {
  const locale: Locale = request.nextUrl.searchParams.get("locale") === "en" ? "en" : "bn";
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) return signInError(locale);

  const next = safeNext(request.nextUrl.searchParams.get("next"), localizedPath(locale, "/library"));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const redirectUri = new URL("/api/auth/google/callback", siteUrl()).toString();

  const authorize = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", await challenge(verifier));
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("prompt", "select_account");

  const response = NextResponse.redirect(authorize);
  response.cookies.set(COOKIE, encodeURIComponent(JSON.stringify({ state, verifier, next, locale })), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: MAX_AGE,
  });
  return response;
}
