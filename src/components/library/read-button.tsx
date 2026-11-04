"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { BookOpen } from "lucide-react";
import { localDB } from "@/lib/local/db";
import { formatPercent } from "@/lib/i18n/format";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import { cn } from "@/lib/utils";

/**
 * Primary action on a book page. Becomes "Continue reading" with the saved
 * position when this device has progress for the book. A plain <a>: the
 * reader is its own document (strict CSP), so this is a full navigation.
 */
export function ReadButton({
  slug,
  locale,
  labels,
  className,
}: {
  slug: string;
  locale: Locale;
  labels: { start: string; resume: string; resumeAt: string };
  className?: string;
}) {
  const position = useLiveQuery(() => localDB().positions.get(slug), [slug]);
  const resuming = Boolean(position && !position.finished && position.fraction > 0.002);
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <a
        href={localizedPath(locale, `/read/${slug}`)}
        data-read-link={slug}
        className="inline-flex h-12 items-center justify-center gap-2 rounded-control bg-cloth px-6 text-base text-on-cloth transition-colors duration-200 hover:bg-cloth-raised"
      >
        <BookOpen aria-hidden className="size-5" />
        {resuming ? labels.resume : labels.start}
      </a>
      {resuming ? (
        <span className="text-center text-xs text-fg-subtle sm:text-left">
          {t(labels.resumeAt, { percent: formatPercent(position!.fraction, locale) })}
        </span>
      ) : null}
    </div>
  );
}
