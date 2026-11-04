import type { Metadata } from "next";
import { NotFoundView } from "@/components/status/not-found-view";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";
import { notFoundMetadata } from "@/lib/seo/not-found";

export async function generateMetadata(): Promise<Metadata> {
  return notFoundMetadata();
}

/** 404 for unknown books, authors, genres and collections (inside the site layout). */
export default async function NotFound() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    <NotFoundView
      title={dict.common.notFoundTitle}
      body={dict.common.notFoundBody}
      english={locale === "bn" ? "This page could not be found." : undefined}
      action={{ href: localizedPath(locale, "/"), label: dict.common.goHome }}
    />
  );
}
