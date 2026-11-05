import { NextResponse, type NextRequest } from "next/server";
import { exchangeCode, hardcoverIssuer, whoAmI, type HardcoverSecret } from "@/lib/connections/hardcover";
import { back, OAUTH_COOKIE, OAUTH_MAX_AGE, OAUTH_PATH, type PendingSignIn } from "@/lib/connections/oauth";
import { ConnectionError, openFor, reader, saveConnection } from "@/lib/connections/store";

/**
 * Hardcover sends the reader back here. The state must match the sealed
 * cookie (same reader, same browser, within ten minutes) and the issuer
 * must be Hardcover's (RFC 9207) before the code is exchanged.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const raw = request.cookies.get(OAUTH_COOKIE)?.value;
  const done = (url: URL) => {
    const res = NextResponse.redirect(url, 303);
    res.cookies.set(OAUTH_COOKIE, "", { path: OAUTH_PATH, maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  let uid: string;
  try {
    ({ uid } = await reader());
  } catch (e) {
    if (e instanceof ConnectionError && e.code === "signedOut") return done(new URL("/signin?next=%2Fprofile", request.nextUrl.origin));
    throw e;
  }
  const pending = raw ? await openFor<PendingSignIn>(uid, "hardcover-oauth", raw).catch(() => null) : null;
  if (!pending || Date.now() - pending.at > OAUTH_MAX_AGE * 1000 || q.get("state") !== pending.state) return done(back(request, "/profile", "failed"));
  if (q.get("error")) return done(back(request, pending.next, q.get("error") === "access_denied" ? "denied" : "failed"));
  const code = q.get("code");
  if (!code || q.get("iss") !== hardcoverIssuer()) return done(back(request, pending.next, "failed"));

  try {
    const tokens = await exchangeCode(code, pending.verifier, pending.redirectUri);
    const me = await whoAmI(tokens.access);
    const secret: HardcoverSecret = { ...tokens, userId: me.id, username: me.username };
    await saveConnection("hardcover", secret, me.username, tokens.expiresAt);
  } catch (e) {
    console.warn("[hardcover] connecting failed:", e instanceof Error ? e.message : e);
    return done(back(request, pending.next, "failed"));
  }
  return done(back(request, pending.next, "connected"));
}
