"use client";

import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Download } from "lucide-react";
import { promptInstall, useInstallState } from "@/lib/offline/install";
import { readableOffline } from "@/lib/offline/books";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

/** Profile: install the app, and how many books open without a connection. */
export function AppSection({ locale, labels }: { locale: Locale; labels: Dictionary["profile"] }) {
  const state = useInstallState();
  const [busy, setBusy] = useState(false);
  const books = useLiveQuery(() => readableOffline(locale), [locale]);

  return (
    <div className="space-y-4">
      <p className="text-fg-muted">{labels.appNote}</p>
      {state === "installed" ? (
        <p className="text-sm text-fg-muted">{labels.installed}</p>
      ) : state === "available" ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await promptInstall().finally(() => setBusy(false));
          }}
          className="inline-flex h-11 items-center gap-2 rounded-control bg-cloth px-4 text-sm text-on-cloth hover:bg-cloth-raised disabled:opacity-60"
        >
          <Download aria-hidden className="size-4" />
          {labels.install}
        </button>
      ) : (
        <p className="text-sm text-fg-muted">{state === "ios" ? labels.installIos : labels.installOther}</p>
      )}
      {books ? (
        <p className="text-sm text-fg-subtle" data-testid="offline-count">
          {books.length ? t(labels.offlineBooks, { count: formatNumber(books.length, locale) }) : labels.offlineNone}
        </p>
      ) : null}
    </div>
  );
}
