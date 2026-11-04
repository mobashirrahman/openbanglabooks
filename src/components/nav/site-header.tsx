import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { HeaderNav } from "./primary-nav";
import { SearchDialog } from "@/components/search/search-dialog";
import { LanguageSwitch } from "./language-switch";

/**
 * The cloth band: Deep Forest Green carries the identity across the top of
 * every catalog page. On the home page it continues into the featured volume.
 */
export function SiteHeader({ locale, dict }: { locale: Locale; dict: Dictionary }) {
  return (
    <header className="pt-safe relative z-30 bg-cloth text-on-cloth">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:h-16 lg:px-8">
        <Link
          href={localizedPath(locale, "/")}
          className="-ml-1 flex shrink-0 items-center rounded-control p-1 text-on-cloth focus-visible:outline-on-cloth"
          aria-label={`${dict.meta.siteName} — ${dict.nav.home}`}
        >
          <Logo variant="compact" className="h-7 w-auto lg:hidden" markClassName="text-foil" />
          <Logo variant="full" className="hidden h-10 w-auto lg:block" markClassName="text-foil" />
        </Link>
        <div className="ml-4 hidden lg:block">
          <HeaderNav
            locale={locale}
            labels={{ discover: dict.nav.discover, library: dict.nav.library, notes: dict.nav.notes, profile: dict.nav.profile, mainNav: dict.nav.mainNav }}
          />
        </div>
        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <SearchDialog
            locale={locale}
            labels={{
              search: dict.nav.search,
              placeholder: dict.nav.searchPlaceholder,
              hint: dict.search.hint,
              books: dict.search.books,
              authors: dict.search.authors,
              noResults: dict.search.noResults,
              shortcut: dict.search.shortcut,
              close: dict.actions.close,
              seeAll: dict.actions.seeAll,
            }}
          />
          <LanguageSwitch locale={locale} label={dict.nav.language} title={dict.nav.languageSwitch} />
        </div>
      </div>
    </header>
  );
}
