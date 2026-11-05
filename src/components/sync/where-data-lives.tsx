"use client";

import Link from "next/link";
import { useAccount } from "@/lib/account/session";
import { localizedPath, type Locale } from "@/lib/i18n/config";

/** One line under personal pages: "on this device (sign in…)" or "kept in your account". */
export function WhereDataLives({ locale, local, synced, signIn, next }: { locale: Locale; local: string; synced: string; signIn: string; next: string }) {
  const account = useAccount();
  if (account.status === "loading") return <p className="min-h-5" aria-hidden />;
  if (account.status === "signed-in") return <p className="text-sm text-fg-subtle">{synced}</p>;
  return (
    <p className="text-sm text-fg-subtle">
      {local}{" "}
      <Link href={`${localizedPath(locale, "/signin")}?next=${encodeURIComponent(localizedPath(locale, next))}`} className="text-link underline-offset-4 hover:underline">
        {signIn}
      </Link>
    </p>
  );
}
