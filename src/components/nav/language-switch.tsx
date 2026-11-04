"use client";

import Link from "next/link";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { useBarePathname } from "./use-locale-path";
import { cn } from "@/lib/utils";

/** Links to the same page in the other UI language. */
export function LanguageSwitch({
  locale,
  label,
  title,
  className,
}: {
  locale: Locale;
  label: string;
  title: string;
  className?: string;
}) {
  const path = useBarePathname();
  const other: Locale = locale === "bn" ? "en" : "bn";
  return (
    <Link
      href={localizedPath(other, path)}
      hrefLang={other}
      lang={other}
      title={title}
      className={cn(
        "inline-flex h-10 items-center rounded-control px-3 text-sm text-on-cloth-muted transition-colors duration-200 hover:bg-cloth-raised hover:text-on-cloth focus-visible:outline-on-cloth",
        className,
      )}
    >
      {label}
    </Link>
  );
}
