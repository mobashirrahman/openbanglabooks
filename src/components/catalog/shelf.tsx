import Link from "next/link";
import type { WorkSummary } from "@/lib/catalog/types";
import type { Locale } from "@/lib/i18n/config";
import { BookCard } from "./book-card";
import { cn } from "@/lib/utils";

/**
 * A horizontal shelf: covers stand on a thin brass rule and scroll sideways
 * with snap on touch. Native scrolling keeps it fast on mid-range phones.
 */
export function Shelf({
  title,
  description,
  href,
  hrefLabel,
  works,
  locale,
  id,
}: {
  title: string;
  description?: string | null;
  href?: string;
  hrefLabel?: string;
  works: WorkSummary[];
  locale: Locale;
  id?: string;
}) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section aria-labelledby={headingId} className="mx-auto max-w-7xl">
      <SectionHeading id={headingId} title={title} description={description} href={href} hrefLabel={hrefLabel} />
      <div className="relative">
        <ul
          className="shelf-scroll flex gap-5 overflow-x-auto px-4 pb-2 sm:gap-7 sm:px-6 lg:px-8 [--gutter:1rem] sm:[--gutter:1.5rem] lg:[--gutter:2rem]"
          role="list"
        >
          {works.map((w) => (
            <li key={w.slug} className="w-[38vw] max-w-44 shrink-0 snap-start sm:w-40 lg:w-44">
              <BookCard work={w} locale={locale} />
            </li>
          ))}
          <li aria-hidden className="w-px shrink-0" />
        </ul>
      </div>
    </section>
  );
}

export function SectionHeading({
  id,
  title,
  description,
  href,
  hrefLabel,
  className,
}: {
  id?: string;
  title: string;
  description?: string | null;
  href?: string;
  hrefLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex items-end justify-between gap-6 px-4 sm:px-6 lg:px-8", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-2xl leading-snug sm:text-[2.2rem]">
          {title}
        </h2>
        {description ? <p className="mt-1 max-w-prose text-sm text-fg-muted">{description}</p> : null}
      </div>
      {href && hrefLabel ? (
        <Link
          href={href}
          className="shrink-0 rounded-control py-1 text-sm text-link underline decoration-line-strong underline-offset-4 hover:decoration-current"
        >
          {hrefLabel}
        </Link>
      ) : null}
    </div>
  );
}
