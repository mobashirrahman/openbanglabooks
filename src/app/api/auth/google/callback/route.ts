import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/account/next";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { siteUrl } from "@/lib/seo/site";

const COOKIE = "obb-google-oauth";

type Saved = { state: string; verifier: string; next: string; locale: Locale };

function clearOAuthCookie(response: NextResponse) {
  response.cookies.set(COOKIE, "", { path: "/api/auth/google", maxAge: 0 });
  return response;
}

function signInError(locale: Locale, error = "google") {
  const url = new URL(localizedPath(locale, "/signin"), siteUrl());
  url.searchParams.set("error", error);
  return clearOAuthCookie(NextResponse.redirect(url));
}

function savedState(raw: string | undefined): Saved | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<Saved> | null;
    if (!value || typeof value.state !== "string" || typeof value.verifier !== "string" || typeof value.next !== "string") return null;
    return { state: value.state, verifier: value.verifier, next: value.next, locale: value.locale === "en" ? "en" : "bn" };
  } catch {
    return null;
  }
}

/**
 * Google sends the browser here after the reader consents. The code is
 * exchanged server-side (the client secret never reaches the browser), then
 * Supabase verifies the Google ID token and its session cookies are set on the
 * redirect response.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = savedState(request.cookies.get(COOKIE)?.value);
  const locale: Locale = saved?.locale === "en" ? "en" : "bn";

  if (params.get("error")) return signInError(locale, params.get("error") === "access_denied" ? "access_denied" : "google");

  const code = params.get("code");
  const state = params.get("state");
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!code || !state || !saved || saved.state !== state || !clientId || !clientSecret || !supabaseUrl || !supabaseKey) {
    return signInError(locale);
  }

  let idToken: string | undefined;
  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: new URL("/api/auth/google/callback", siteUrl()).toString(),
        grant_type: "authorization_code",
        code_verifier: saved.verifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenResponse.ok) return signInError(locale);
    idToken = ((await tokenResponse.json()) as { id_token?: string }).id_token;
  } catch {
    return signInError(locale);
  }
  if (!idToken) return signInError(locale);

  const target = safeNext(saved.next, localizedPath(locale, "/library"));
  const response = clearOAuthCookie(NextResponse.redirect(new URL(target, siteUrl())));

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });

  const { error } = await supabase.auth.signInWithIdToken({ provider: "google", token: idToken });
  if (error) return signInError(locale);
  return response;
}
