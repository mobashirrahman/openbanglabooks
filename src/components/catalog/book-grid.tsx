import type { WorkSummary } from "@/lib/catalog/types";
import type { Locale } from "@/lib/i18n/config";
import { BookCard } from "./book-card";

export function BookGrid({ works, locale }: { works: WorkSummary[]; locale: Locale }) {
  return (
    <ul className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 sm:gap-x-7 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
      {works.map((w) => (
        <li key={w.slug}>
          <BookCard work={w} locale={locale} headingLevel={2} />
        </li>
      ))}
    </ul>
  );
}

export function ListingHeader({ title, description, children }: { title: string; description?: string | null; children?: React.ReactNode }) {
  return (
    <header className="mx-auto max-w-7xl px-4 pt-10 pb-8 sm:px-6 sm:pt-14 lg:px-8">
      <h1 className="text-4xl leading-tight sm:text-5xl">{title}</h1>
      {description ? <p className="mt-3 max-w-2xl text-lg text-fg-muted">{description}</p> : null}
      {children}
    </header>
  );
}
