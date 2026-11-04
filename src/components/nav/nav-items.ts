import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

export type NavKey = "discover" | "library" | "profile";

/**
 * Primary destinations. A destination is listed only once it works:
 * "My Notes" joins in Phase 2 together with highlights and annotations.
 */
export const NAV_ITEMS: { key: NavKey; href: string; match: (p: string) => boolean }[] = [
  {
    key: "discover",
    href: "/",
    match: (p) =>
      p === "/" || /^\/(books|authors|genres|collections|search)(\/|$)/.test(p),
  },
  { key: "library", href: "/library", match: (p) => p.startsWith("/library") },
  { key: "profile", href: "/profile", match: (p) => p.startsWith("/profile") },
];

export type NavLabels = Pick<Dictionary["nav"], NavKey | "mainNav">;
