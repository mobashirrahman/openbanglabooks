"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudAlert, CloudCheck, CloudOff, CloudUpload } from "lucide-react";
import { useAccount } from "@/lib/account/session";
import { requestSyncNow, useSyncStatus, type SyncStatus } from "@/lib/sync/status";
import { formatNumber } from "@/lib/i18n/format";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { cn } from "@/lib/utils";

type Labels = Dictionary["sync"];

export function syncText(s: SyncStatus, labels: Labels, locale: Locale): string {
  if (s.phase === "syncing") return labels.syncing;
  if (s.phase === "offline") return s.pending ? t(labels.offlinePending, { count: formatNumber(s.pending, locale) }) : labels.offline;
  if (s.phase === "error") return labels.error;
  if (s.pending) return t(labels.pending, { count: formatNumber(s.pending, locale) });
  return labels.synced;
}

function Icon({ s, className }: { s: SyncStatus; className?: string }) {
  if (s.phase === "offline") return <CloudOff aria-hidden className={className} />;
  if (s.phase === "error") return <CloudAlert aria-hidden className={className} />;
  if (s.phase === "syncing" || s.pending) return <CloudUpload aria-hidden className={cn(className, s.phase === "syncing" && "animate-pulse")} />;
  return <CloudCheck aria-hidden className={className} />;
}

/** A quiet cloud in the header while signed in; links to the account. */
export function SyncIndicator({ locale, labels }: { locale: Locale; labels: Labels }) {
  const account = useAccount();
  const s = useSyncStatus();
  if (account.status !== "signed-in") return null;
  const text = syncText(s, labels, locale);
  return (
    <Link
      href={localizedPath(locale, "/profile")}
      title={text}
      aria-label={`${labels.status}: ${text}`}
      data-sync={s.phase}
      className="inline-flex size-10 items-center justify-center rounded-control text-on-cloth-muted transition-colors hover:bg-cloth-raised hover:text-on-cloth"
    >
      <Icon s={s} className="size-5" />
    </Link>
  );
}

/** The sync line on the profile page, with "sync now". */
export function SyncStatusLine({ locale, labels }: { locale: Locale; labels: Labels }) {
  const s = useSyncStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const when =
    s.lastSyncedAt && s.phase === "idle" && !s.pending
      ? new Intl.RelativeTimeFormat(locale === "bn" ? "bn-BD" : "en", { numeric: "auto" }).format(
          -Math.max(0, Math.round((Math.max(now, s.lastSyncedAt) - s.lastSyncedAt) / 60_000)),
          "minute",
        )
      : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-control bg-sunken px-4 py-3">
      <Icon s={s} className="size-5 shrink-0 text-fg-muted" />
      <p role="status" className="min-w-0 flex-1 text-sm" data-testid="sync-status">
        {syncText(s, labels, locale)}
        {when ? <span className="text-fg-subtle"> · {when}</span> : null}
      </p>
      <button
        type="button"
        onClick={requestSyncNow}
        disabled={s.phase === "syncing"}
        className="h-9 rounded-control px-3 text-sm text-link hover:bg-surface disabled:opacity-60"
      >
        {labels.syncNow}
      </button>
    </div>
  );
}
