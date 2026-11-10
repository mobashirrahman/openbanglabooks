"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/account/session";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { errorMessage, safeNext } from "./sign-in-form";

const TYPES: EmailOtpType[] = ["email", "magiclink", "signup", "recovery"];

/**
 * The page a confirmation or social sign-in returns to. The token is verified
 * in the browser rather than on a GET to the server: mail scanners that
 * prefetch links do not run scripts, so they cannot use up a one-time token.
 * OAuth returns a PKCE code here; the same page exchanges it for a session.
 */
export function ConfirmLink({ locale, labels }: { locale: Locale; labels: Dictionary["account"] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type") as EmailOtpType | null;
    const denied = params.get("error_description") ?? params.get("error");
    const next = safeNext(params.get("next"), localizedPath(locale, "/library"));
    // tokens and codes must not linger in the address bar or the history
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      try {
        if (denied) throw { code: "otp_expired", message: denied };
        const sb = await getSupabase();
        if (code) {
          const { error } = await sb.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type && TYPES.includes(type)) {
          const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
        } else {
          throw { code: "otp_expired" };
        }
        router.replace(next);
      } catch (e) {
        setError(errorMessage(e, labels));
      }
    })();
  }, [locale, labels, router]);

  if (error) {
    return (
      <div className="space-y-6">
        <p role="alert" className="text-lg">
          {error}
        </p>
        <Link
          href={localizedPath(locale, "/signin")}
          className="inline-flex h-12 items-center rounded-control bg-cloth px-6 text-on-cloth hover:bg-cloth-raised"
        >
          {labels.signIn}
        </Link>
      </div>
    );
  }
  return (
    <p role="status" className="flex items-center gap-3 text-lg text-fg-muted">
      <Loader2 aria-hidden className="size-5 animate-spin" />
      {labels.confirming}
    </p>
  );
}
