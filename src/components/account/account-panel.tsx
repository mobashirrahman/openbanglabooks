"use client";

import { useState } from "react";
import Link from "next/link";
import { LogIn, LogOut, UserRound } from "lucide-react";
import { accountsEnabled, getSupabase, signOut, useAccount } from "@/lib/account/session";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { errorMessage } from "./sign-in-form";

type Labels = Dictionary["account"];

/** The account block on the profile page: sign in, or who is signed in, sign out and delete. */
export function AccountPanel({ locale, labels, children }: { locale: Locale; labels: Labels; children?: React.ReactNode }) {
  const account = useAccount();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!accountsEnabled) return <p className="text-fg-muted">{labels.unavailable}</p>;
  if (account.status === "loading") return <div className="h-24 animate-pulse rounded-control bg-sunken" aria-busy />;

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
      const { error } = await sb.rpc("delete_my_account");
      if (error) throw error;
      window.dispatchEvent(new CustomEvent("obb:account-deleted"));
      await signOut();
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
        <span className="min-w-0 break-words">{t(labels.signedInAs, { email: account.user.email ?? "" })}</span>
      </p>
      {children}
      <div className="space-y-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await signOut();
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
