import { describe, expect, it } from "vitest";
import { checkPublicDomain } from "@/lib/rights";

describe("checkPublicDomain", () => {
  it("accepts Tagore's Gora (died 1941, published 1910)", () => {
    const v = checkPublicDomain({ authorDiedYears: [1941], firstPublished: 1910, year: 2026 });
    expect(v.ok).toBe(true);
  });

  it("accepts a 1929 work in 2026 (US cut-off is 1931)", () => {
    expect(checkPublicDomain({ authorDiedYears: [1941], firstPublished: 1929, year: 2026 }).ok).toBe(true);
  });

  it("rejects Nazrul (died 1976) – protected in BD/IN until 2036", () => {
    const v = checkPublicDomain({ authorDiedYears: [1976], firstPublished: 1922, year: 2026 });
    expect(v).toMatchObject({ ok: false });
    if (!v.ok) expect(v.reason).toContain("2036");
  });

  it("rejects works first published in or after the US cut-off", () => {
    expect(checkPublicDomain({ authorDiedYears: [1950], firstPublished: 1939, year: 2026 }).ok).toBe(false);
    expect(checkPublicDomain({ authorDiedYears: [1950], firstPublished: 1931, year: 2026 }).ok).toBe(false);
  });

  it("uses the latest death year among co-authors", () => {
    expect(checkPublicDomain({ authorDiedYears: [1900, 1970], firstPublished: 1920, year: 2026 }).ok).toBe(false);
  });

  it("requires known dates", () => {
    expect(checkPublicDomain({ authorDiedYears: [null], firstPublished: 1900 }).ok).toBe(false);
    expect(checkPublicDomain({ authorDiedYears: [1900], firstPublished: null }).ok).toBe(false);
    expect(checkPublicDomain({ authorDiedYears: [], firstPublished: 1900 }).ok).toBe(false);
  });

  it("the life+60 boundary is exclusive of the 60th year", () => {
    // died 1965 → protected through 2025, free from 2026
    expect(checkPublicDomain({ authorDiedYears: [1965], firstPublished: 1920, year: 2026 }).ok).toBe(true);
    expect(checkPublicDomain({ authorDiedYears: [1966], firstPublished: 1920, year: 2026 }).ok).toBe(false);
  });
});
