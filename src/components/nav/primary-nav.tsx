"use client";

import Link from "next/link";
import { Compass, LibraryBig, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/config";
import { NAV_ITEMS, type NavKey, type NavLabels } from "./nav-items";
import { useBarePathname, useLocalizedHref } from "./use-locale-path";

const ICONS: Record<NavKey, typeof Compass> = {
  discover: Compass,
  library: LibraryBig,
  profile: UserRound,
};

/** Desktop navigation inside the cloth header band. */
export function HeaderNav({ locale, labels }: { locale: Locale; labels: NavLabels }) {
  const pathname = useBarePathname();
  const href = useLocalizedHref(locale);
  return (
    <nav aria-label={labels.mainNav} className="hidden lg:block">
      <ul className="flex items-center gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          return (
            <li key={item.key}>
              <Link
                href={href(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative inline-flex h-10 items-center rounded-control px-3 text-[0.98rem] transition-colors duration-200",
                  "text-on-cloth-muted hover:text-on-cloth focus-visible:outline-on-cloth",
                  active && "text-on-cloth",
                )}
              >
                {labels[item.key]}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-3 -bottom-px h-px origin-left bg-foil transition-transform duration-300 ease-paper",
                    active ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Mobile bottom navigation – native-app style, safe-area aware, 56px targets. */
export function BottomNav({ locale, labels }: { locale: Locale; labels: NavLabels }) {
  const pathname = useBarePathname();
  const href = useLocalizedHref(locale);
  return (
    <nav
      aria-label={labels.mainNav}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 pb-safe backdrop-blur-sm lg:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-3">
        {NAV_ITEMS.map((item) => {
          const active = item.match(pathname);
          const Icon = ICONS[item.key];
          return (
            <li key={item.key}>
              <Link
                href={href(item.href)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-14 flex-col items-center justify-center gap-0.5 text-xs transition-colors duration-200",
                  active ? "text-cloth dark:text-fg" : "text-fg-subtle",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-0 h-0.5 w-8 rounded-full bg-foil transition-opacity duration-200",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <Icon aria-hidden className="size-[22px]" strokeWidth={active ? 2 : 1.6} />
                <span className="leading-none">{labels[item.key]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
