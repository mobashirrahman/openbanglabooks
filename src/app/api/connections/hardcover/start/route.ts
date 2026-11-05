import { NextResponse, type NextRequest } from "next/server";
import { authorizeUrl, challengeFor, hardcoverConfigured, randomToken } from "@/lib/connections/hardcover";
import { back, OAUTH_COOKIE, OAUTH_MAX_AGE, OAUTH_PATH, redirectUriFor, safeNext, type PendingSignIn } from "@/lib/connections/oauth";
import { ConnectionError, reader, sealFor } from "@/lib/connections/store";

/**
 * Sends a signed-in reader to Hardcover to approve the connection
 * (authorization code with PKCE). The state and verifier wait in a
 * short-lived cookie, sealed to this reader.
 */
export async function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"), "/profile");
  if (!hardcoverConfigured()) return NextResponse.redirect(back(request, next, "unavailable"), 303);
  let uid: string;
  try {
    ({ uid } = await reader());
  } catch (e) {
    if (e instanceof ConnectionError && e.code === "signedOut") return NextResponse.redirect(new URL(`/signin?next=${encodeURIComponent(next)}`, request.nextUrl.origin), 303);
    throw e;
  }
  const state = randomToken(24);
  const verifier = randomToken(32);
  const redirectUri = redirectUriFor(request);
  const pending: PendingSignIn = { state, verifier, next, redirectUri, at: Date.now() };
  const res = NextResponse.redirect(authorizeUrl({ state, challenge: await challengeFor(verifier), redirectUri }), 303);
  res.cookies.set(OAUTH_COOKIE, await sealFor(uid, "hardcover-oauth", pending), {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: OAUTH_PATH,
    maxAge: OAUTH_MAX_AGE,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
