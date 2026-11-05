import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const KEY = Buffer.alloc(32, 7).toString("base64");

describe("sealing connection secrets", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CONNECTIONS_KEY = KEY;
  });
  afterEach(() => {
    delete process.env.CONNECTIONS_KEY;
  });

  it("opens what it sealed, for the same reader and purpose only", async () => {
    const { seal, open } = await import("@/lib/connections/crypto");
    const value = { access: "a".repeat(40), refresh: "r".repeat(40), expiresAt: 1_800_000_000_000, userId: 7, username: "reader" };
    const sealed = await seal(value, "connection:uid-1:hardcover");
    // what the database accepts (connections_secret_sealed)
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+$/);
    expect(sealed.length).toBeGreaterThanOrEqual(23);
    expect(sealed).not.toContain("reader");
    expect(await open(sealed, "connection:uid-1:hardcover")).toEqual(value);
    // copied to another reader's row, or used for another service: it does not open
    await expect(open(sealed, "connection:uid-2:hardcover")).rejects.toThrow();
    await expect(open(sealed, "connection:uid-1:readwise")).rejects.toThrow();
  });

  it("never seals the same value the same way twice, and refuses tampering", async () => {
    const { seal, open } = await import("@/lib/connections/crypto");
    const a = await seal({ token: "x" }, "c");
    const b = await seal({ token: "x" }, "c");
    expect(a).not.toBe(b);
    const bytes = Buffer.from(a.slice(3), "base64url");
    bytes[bytes.length - 1] ^= 1;
    await expect(open(`v1.${bytes.toString("base64url")}`, "c")).rejects.toThrow();
    await expect(open("v0.abc", "c")).rejects.toThrow();
  });

  it("is off without a 32-byte key", async () => {
    process.env.CONNECTIONS_KEY = Buffer.alloc(16).toString("base64");
    const { connectionsConfigured, seal } = await import("@/lib/connections/crypto");
    expect(connectionsConfigured()).toBe(false);
    await expect(seal({}, "c")).rejects.toThrow(/32 bytes/);
    delete process.env.CONNECTIONS_KEY;
    expect(connectionsConfigured()).toBe(false);
  });
});

describe("the OAuth round trip", () => {
  const request = (origin: string) => ({ nextUrl: new URL(origin) }) as unknown as Parameters<typeof import("@/lib/connections/oauth").back>[0];

  it("only returns to paths on this site", async () => {
    const { safeNext } = await import("@/lib/connections/oauth");
    expect(safeNext("/en/profile", "/profile")).toBe("/en/profile");
    for (const bad of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "profile"]) expect(safeNext(bad, "/profile")).toBe("/profile");
  });

  it("brings the reader back to the Connections section with the outcome", async () => {
    const { back } = await import("@/lib/connections/oauth");
    expect(back(request("http://localhost:3000/api/x"), "/en/profile", "connected").toString()).toBe("http://localhost:3000/en/profile?hardcover=connected#connections");
    expect(back(request("https://openbanglabooks.com/api/x"), "/library/hardcover", "denied").toString()).toBe("https://openbanglabooks.com/library/hardcover?hardcover=denied");
  });
});

describe("Hardcover sign-in", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.CONNECTIONS_KEY = KEY;
    process.env.HARDCOVER_CLIENT_ID = "client";
    process.env.HARDCOVER_CLIENT_SECRET = "secret";
  });
  afterEach(() => {
    for (const k of ["CONNECTIONS_KEY", "HARDCOVER_CLIENT_ID", "HARDCOVER_CLIENT_SECRET"]) delete process.env[k];
  });

  it("asks for code + PKCE (S256) with the scopes it needs, and nothing more", async () => {
    vi.doMock("@/lib/connections/store", () => ({}));
    const { authorizeUrl, challengeFor, hardcoverConfigured, randomToken } = await import("@/lib/connections/hardcover");
    expect(hardcoverConfigured()).toBe(true);
    const verifier = randomToken(32);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // RFC 7636, appendix B
    expect(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    const url = new URL(authorizeUrl({ state: "s", challenge: "c", redirectUri: "https://openbanglabooks.com/api/connections/hardcover/callback" }));
    expect(url.origin + url.pathname).toBe("https://hardcover.app/oauth2/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: "code",
      client_id: "client",
      redirect_uri: "https://openbanglabooks.com/api/connections/hardcover/callback",
      state: "s",
      code_challenge: "c",
      code_challenge_method: "S256",
      scope: "read:me:content read:library write:library read:catalog:search",
    });
  });

  it("is off without the client or the sealing key", async () => {
    vi.doMock("@/lib/connections/store", () => ({}));
    delete process.env.CONNECTIONS_KEY;
    const { hardcoverConfigured } = await import("@/lib/connections/hardcover");
    expect(hardcoverConfigured()).toBe(false);
  });
});
