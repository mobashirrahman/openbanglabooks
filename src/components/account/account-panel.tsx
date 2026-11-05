"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LibraryBig, LogIn, LogOut, UserRound } from "lucide-react";
import { accountsEnabled, getSupabase, useAccount } from "@/lib/account/session";
import { SyncStatusLine } from "@/components/sync/sync-indicator";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import { formatNumber } from "@/lib/i18n/format";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { errorMessage } from "./sign-in-form";

type Labels = Dictionary["account"];
type SyncLabels = Dictionary["sync"];

/** The account block on the profile page: sign in, or who is signed in, sign out and delete. */
export function AccountPanel({
  locale,
  labels,
  syncLabels,
  editLabel,
}: {
  locale: Locale;
  labels: Labels;
  syncLabels: SyncLabels;
  editLabel: string;
}) {
  const account = useAccount();
  const editor = useIsEditor(account.status === "signed-in" ? account.user.id : null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!accountsEnabled) return <p className="text-fg-muted">{labels.unavailable}</p>;
  // as tall as the signed-out panel (what a first visit shows), so the sections below do not jump
  if (account.status === "loading") return <div className="h-[196px] animate-pulse rounded-control bg-sunken sm:h-[168px]" aria-busy />;

  if (account.status === "signed-out") {
    return (
      <div className="space-y-4">
        <p className="text-lg">{labels.signedOutTitle}</p>
        <p className="max-w-prose text-fg-muted">{labels.signedOutBody}</p>
        <Link
          href={`${localizedPath(locale, "/signin")}?next=${encodeURIComponent(localizedPath(locale, "/profile"))}`}
          className="inline-flex h-12 items-center gap-2 rounded-control bg-cloth px-6 text-on-cloth hover:bg-cloth-raised"
        >
          <LogIn aria-hidden className="size-5" />
          {labels.signIn}
        </Link>
        {message ? (
          <p role="status" className="text-sm text-fg-muted">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  const deleteAccount = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const sb = await getSupabase();
      // files kept in the account go first (only the Storage API can remove them)
      const { removeAllAccountFiles } = await import("@/lib/personal/store");
      await removeAllAccountFiles();
      // connections are withdrawn at the services too (best effort: the rows go with the account anyway)
      const { disconnectAll } = await import("@/lib/connections/actions");
      await disconnectAll().catch(() => null);
      const { error } = await sb.rpc("delete_my_account");
      if (error) throw error;
      const engine = await import("@/lib/sync/engine");
      await engine.forgetAccount();
      setConfirming(false);
      setMessage(labels.deleted);
    } catch (e) {
      setMessage(errorMessage(e, labels));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <p className="flex items-center gap-3 text-lg">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-cloth text-on-cloth">
          <UserRound aria-hidden className="size-5" />
        </span>
        <span className="min-w-0 [overflow-wrap:anywhere]">{t(labels.signedInAs, { email: account.user.email ?? "" })}</span>
      </p>
      <SyncStatusLine locale={locale} labels={syncLabels} />
      {editor ? (
        <Link
          href={localizedPath(locale, "/admin")}
          className="inline-flex h-11 items-center gap-2 rounded-control border border-line-strong px-4 hover:bg-sunken"
        >
          <LibraryBig aria-hidden className="size-5" />
          {editLabel}
        </Link>
      ) : null}
      <div className="space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              // last changes first; the account's data then leaves this device
              const engine = await import("@/lib/sync/engine");
              await engine.syncNow().catch(() => {});
              const pending = await engine.pendingChanges();
              if (pending && !window.confirm(t(labels.unsyncedConfirm, { count: formatNumber(pending, locale) }))) return;
              await engine.signOutAndClear();
            } finally {
              setBusy(false);
            }
          }}
          className="inline-flex h-11 items-center gap-2 rounded-control border border-line-strong px-4 text-sm hover:bg-sunken"
        >
          <LogOut aria-hidden className="size-4" />
          {labels.signOut}
        </button>
        <p className="max-w-prose text-sm text-fg-subtle">{labels.signOutNote}</p>
      </div>
      <div className="border-t border-line pt-6">
        {confirming ? (
          <div role="group" aria-labelledby="delete-account-title" className="space-y-4 rounded-[14px] border border-destructive/40 p-4 sm:p-5">
            <p id="delete-account-title" className="text-lg">
              {labels.deleteConfirmTitle}
            </p>
            <p className="max-w-prose text-sm text-fg-muted">{labels.deleteConfirmBody}</p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={deleteAccount}
                className="inline-flex h-11 items-center rounded-control bg-destructive px-4 text-sm text-white hover:bg-destructive/90 disabled:opacity-70"
              >
                {labels.deleteConfirm}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirming(false)}
                className="inline-flex h-11 items-center rounded-control border border-line-strong px-4 text-sm hover:bg-sunken"
              >
                {labels.cancel}
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex h-11 items-center rounded-control border border-destructive/40 px-4 text-sm text-destructive hover:bg-destructive/10"
          >
            {labels.deleteAccount}
          </button>
        )}
      </div>
      {message ? (
        <p role="status" className="text-sm text-fg-muted">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/** Whether the signed-in reader may edit the catalogue (a link only; the admin checks for itself). */
function useIsEditor(userId: string | null) {
  const [editor, setEditor] = useState<{ id: string; yes: boolean } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void getSupabase()
      .then((sb) => sb.from("profiles").select("role").eq("id", userId).maybeSingle())
      .then((res) => {
        const role = res?.data?.role as string | undefined;
        if (live) setEditor({ id: userId, yes: role === "editor" || role === "admin" });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [userId]);
  return Boolean(userId && editor?.id === userId && editor.yes);
}
