import Link from "next/link";
import { BookCover } from "@/components/cover/book-cover";
import type { WorkSummary } from "@/lib/catalog/types";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

/** Cover + title + author, linking to the book page. */
export function BookCard({
  work,
  locale,
  className,
  showAuthor = true,
  headingLevel = 3,
}: {
  work: WorkSummary;
  locale: Locale;
  className?: string;
  showAuthor?: boolean;
  headingLevel?: 2 | 3 | 4;
}) {
  const H = `h${headingLevel}` as "h3";
  return (
    <Link
      href={localizedPath(locale, `/books/${work.slug}`)}
      className={cn("group block rounded-[3px] outline-offset-4", className)}
    >
      <BookCover work={work} interactive />
      <H className="mt-3 font-display text-lg leading-snug text-fg group-hover:text-link">
        {work.title_bn}
        {work.subtitle_bn ? <span className="text-fg-muted"> ({work.subtitle_bn})</span> : null}
      </H>
      {showAuthor ? (
        <p className="mt-0.5 truncate text-sm text-fg-muted">{work.authors.map((a) => a.name_bn).join(", ")}</p>
      ) : null}
    </Link>
  );
}
