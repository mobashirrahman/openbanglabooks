"use client";

import { WifiOff, TriangleAlert } from "lucide-react";
import type { WorkSnapshot } from "@/lib/local/db";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { t } from "@/lib/i18n/t";
import { Mark } from "@/components/brand/logo";

/** Error, offline and end-of-book screens. Errors explain what happened and what to do next. */
export function ReaderStatus({
  phase,
  ended,
  labels,
  work,
  bookHref,
  next,
  onRetry,
  onBackToBook,
}: {
  phase: "loading" | "ready" | "error" | "offline";
  ended: boolean;
  labels: Dictionary["reader"] & { back: string; retry: string };
  work: WorkSnapshot;
  bookHref: string;
  next: { slug: string; title_bn: string; href: string }[];
  onRetry: () => void;
  onBackToBook: () => void;
}) {
  if (phase === "error" || phase === "offline") {
    const Icon = phase === "offline" ? WifiOff : TriangleAlert;
    return (
      <div role="alert" className="fixed inset-0 z-40 flex items-center justify-center bg-[var(--desk)] px-6">
        <div className="max-w-sm text-center">
          <Icon aria-hidden className="mx-auto size-8 text-[var(--ink-muted)]" />
          <h1 className="mt-4 font-display text-2xl">{phase === "offline" ? labels.offlineTitle : labels.errorTitle}</h1>
          <p className="mt-2 text-[var(--ink-muted)]">{phase === "offline" ? labels.offlineBody : labels.errorBody}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button type="button" onClick={onRetry} className="h-11 rounded-[10px] bg-[var(--ink)] px-5 text-[var(--paper)]">
              {labels.retry}
            </button>
            <a href={bookHref} className="inline-flex h-11 items-center rounded-[10px] border border-[var(--ink-muted)] px-5">
              {labels.exit}
            </a>
          </div>
        </div>
      </div>
    );
  }
  if (!ended) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="end-title"
      className="fixed inset-0 z-40 flex animate-in fade-in-0 items-center justify-center bg-[var(--paper)] px-6 duration-500"
    >
      <div className="max-w-md text-center">
        <Mark className="mx-auto size-12 text-accent" />
        <h1 id="end-title" className="mt-5 font-display text-4xl">
          {labels.endTitle}
        </h1>
        <p className="mt-3 text-lg text-[var(--ink-muted)]">{t(labels.endBody, { title: work.title_bn })}</p>
        {next.length ? (
          <div className="mt-8">
            <p className="text-sm text-[var(--ink-muted)]">{labels.endNext}</p>
            <ul className="mt-3 space-y-2">
              {next.map((n) => (
                <li key={n.slug}>
                  <a href={n.href} className="font-display text-xl underline decoration-[var(--color-accent)] underline-offset-4">
                    {n.title_bn}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="mt-10 flex justify-center gap-3">
          <button type="button" onClick={onBackToBook} className="h-11 rounded-[10px] border border-[var(--ink-muted)] px-5">
            {labels.back}
          </button>
          <a href={bookHref} className="inline-flex h-11 items-center rounded-[10px] bg-[var(--ink)] px-5 text-[var(--paper)]">
            {labels.exit}
          </a>
        </div>
      </div>
    </div>
  );
}
