"use client";

import Link from "next/link";
import { useBarePathname } from "@/components/nav/use-locale-path";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";
import type { AdminLabels } from "./form-kit";

/** Sections of the admin: books (and their editions), authors, genres, collections. */
export function AdminNav({ locale, labels }: { locale: Locale; labels: AdminLabels }) {
  const path = useBarePathname();
  const items = [
    { href: "/admin", label: labels.works, active: path === "/admin" || path.startsWith("/admin/works") || path.startsWith("/admin/editions") },
    { href: "/admin/authors", label: labels.authors, active: path.startsWith("/admin/authors") },
    { href: "/admin/genres", label: labels.genres, active: path.startsWith("/admin/genres") },
    { href: "/admin/collections", label: labels.collections, active: path.startsWith("/admin/collections") },
  ];
  return (
    <nav aria-label={labels.sections} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex gap-1 border-b border-line">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={localizedPath(locale, it.href)}
              aria-current={it.active ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex h-11 items-center border-b-2 px-4 whitespace-nowrap transition-colors",
                it.active ? "border-cloth text-fg dark:border-foil" : "border-transparent text-fg-muted hover:text-fg",
              )}
            >
              {it.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
