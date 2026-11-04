import type { Metadata } from "next";
import { NotFoundView } from "@/components/status/not-found-view";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: `${dict.common.notFoundTitle} | ${dict.meta.siteName}` };
}

/** 404 for /read/<unknown>; the reader layout has no site chrome, so this links back to the library. */
export default async function NotFound() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    <div className="h-dvh overflow-y-auto bg-bg text-fg">
      <NotFoundView
        as="main"
        title={dict.common.notFoundTitle}
        body={dict.common.notFoundBody}
        english={locale === "bn" ? "This page could not be found." : undefined}
        action={{ href: localizedPath(locale, "/books"), label: dict.nav.allBooks }}
      />
    </div>
  );
}
