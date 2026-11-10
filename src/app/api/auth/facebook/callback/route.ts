import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/account/next";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { siteUrl } from "@/lib/seo/site";

const COOKIE = "obb-facebook-oauth";

type Saved = { state: string; next: string; locale: Locale };

function clearOAuthCookie(response: NextResponse) {
  response.cookies.set(COOKIE, "", { path: "/api/auth/facebook", maxAge: 0 });
  return response;
}

function signInError(locale: Locale, error = "facebook") {
  const url = new URL(localizedPath(locale, "/signin"), siteUrl());
  url.searchParams.set("error", error);
  return clearOAuthCookie(NextResponse.redirect(url));
}

function savedState(raw: string | undefined): Saved | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw)) as Partial<Saved> | null;
    if (!value || typeof value.state !== "string" || typeof value.next !== "string") return null;
    return { state: value.state, next: value.next, locale: value.locale === "en" ? "en" : "bn" };
  } catch {
    return null;
  }
}

/**
 * Facebook sends the browser here after the reader consents. The code is
 * exchanged server-side with the app secret, then Supabase verifies the
 * Facebook access token and its session cookies are set on the redirect.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const saved = savedState(request.cookies.get(COOKIE)?.value);
  const locale: Locale = saved?.locale === "en" ? "en" : "bn";

  if (params.get("error")) return signInError(locale, params.get("error") === "access_denied" ? "access_denied" : "facebook");

  const code = params.get("code");
  const state = params.get("state");
  const clientId = process.env.FACEBOOK_CLIENT_ID;
  const clientSecret = process.env.FACEBOOK_CLIENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!code || !state || !saved || saved.state !== state || !clientId || !clientSecret || !supabaseUrl || !supabaseKey) {
    return signInError(locale);
  }

  let accessToken: string | undefined;
  try {
    const tokenResponse = await fetch("https://graph.facebook.com/v22.0/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: new URL("/api/auth/facebook/callback", siteUrl()).toString(),
        code,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const tokens = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenResponse.ok || !tokens.access_token) return signInError(locale);
    accessToken = tokens.access_token;
  } catch {
    return signInError(locale);
  }

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

  const { error } = await supabase.auth.signInWithIdToken({ provider: "facebook", token: accessToken });
  if (error) return signInError(locale);
  return response;
}
