import Link from "next/link";
import { Mark } from "@/components/brand/logo";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { localizedPath, type Locale } from "@/lib/i18n/config";

export function SiteFooter({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  const href = (p: string) => localizedPath(locale, p);
  return (
    <footer className="mt-24 border-t border-line bg-sunken/60 pb-24 lg:pb-0">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="max-w-md">
          <div className="flex items-center gap-3 text-mark">
            <Mark className="size-9" />
            <span className="font-display text-xl">{dict.meta.siteNameLocal}</span>
          </div>
          <p className="mt-4 text-sm text-fg-muted">{dict.footer.about}</p>
        </div>
        <nav aria-label={dict.nav.discover} className="text-sm">
          <ul className="space-y-2.5">
            <li>
              <Link className="text-fg-muted hover:text-fg hover:underline" href={href("/books")}>
                {dict.nav.allBooks}
              </Link>
            </li>
            <li>
              <Link className="text-fg-muted hover:text-fg hover:underline" href={href("/authors")}>
                {dict.nav.authors}
              </Link>
            </li>
            <li>
              <Link className="text-fg-muted hover:text-fg hover:underline" href={href("/about/sources")}>
                {dict.footer.rightsPolicy}
              </Link>
            </li>
          </ul>
        </nav>
        <div className="text-sm">
          <h2 className="font-sans text-sm text-fg">{dict.footer.sources}</h2>
          <p className="mt-2.5 text-fg-muted">{dict.footer.sourcesBody}</p>
        </div>
      </div>
    </footer>
  );
}
