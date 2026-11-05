import type { Metadata } from "next";
import Link from "next/link";
import { LibraryView } from "@/components/library/library-view";
import { ReadingGoal } from "@/components/library/reading-goal";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.library.title, robots: { index: false, follow: false } };
}

export default async function LibraryPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    <div className="mx-auto max-w-6xl px-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <h1 className="text-4xl sm:text-5xl">{dict.library.title}</h1>
      <p className="mt-2 text-fg-muted">{dict.library.description}</p>
      <p className="mt-1 mb-8 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <Link href={localizedPath(locale, "/library/goodreads")} className="text-link underline-offset-4 hover:underline">
          {dict.transfer.link}
        </Link>
        <Link href={localizedPath(locale, "/library/hardcover")} className="text-link underline-offset-4 hover:underline">
          {dict.connections.hcLink}
        </Link>
      </p>
      <div className="mb-12">
        <ReadingGoal locale={locale} labels={dict.library} />
      </div>
      <LibraryView
        locale={locale}
        labels={{
          ...dict.library,
          want: dict.library.statusWant,
          remove: dict.actions.removeFromLibrary,
          continueReading: dict.actions.continueReading,
          signIn: dict.account.signIn,
          cancel: dict.account.cancel,
        }}
        personal={dict.personal}
      />
    </div>
  );
}
