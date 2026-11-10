"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { getSupabase } from "@/lib/account/session";
import { safeNext } from "@/lib/account/next";
import { MIN_PASSWORD } from "@/lib/account/policy";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { errorMessage } from "./sign-in-form";

type Labels = Dictionary["account"];
type Phase = "checking" | "ready" | "saving" | "invalid";

/**
 * The page the password-reset email returns to. The link carries a PKCE code
 * (or, from an older template, a token hash); it is exchanged in the browser,
 * so a mail scanner that prefetches the link cannot use it up.
 */
export function ResetPassword({ locale, labels }: { locale: Locale; labels: Labels }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("checking");
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [next, setNext] = useState(localizedPath(locale, "/library"));
  const passwordRef = useRef<HTMLInputElement>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const tokenHash = params.get("token_hash");
    const type = params.get("type");
    const denied = params.get("error_description") ?? params.get("error");
    setNext(safeNext(params.get("next"), localizedPath(locale, "/library")));
    // the code or token must not linger in the address bar or the history
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      try {
        if (denied) throw { code: "otp_expired", message: denied };
        const sb = await getSupabase();
        if (code) {
          const { error } = await sb.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type === "recovery") {
          const { error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
          if (error) throw error;
        } else {
          // a reader who is already signed in may also change the password here
          const { data } = await sb.auth.getSession();
          if (!data.session) throw { code: "otp_expired" };
        }
        setPhase("ready");
        requestAnimationFrame(() => passwordRef.current?.focus());
      } catch (e) {
        const message = errorMessage(e, labels);
        setError(message === labels.linkFailed ? labels.resetLinkFailed : message);
        setPhase("invalid");
      }
    })();
  }, [labels, locale]);

  const save = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const field = e.currentTarget.elements.namedItem("password") as HTMLInputElement | null;
    const password = field?.value ?? "";
    setError(null);
    if (password.length < MIN_PASSWORD) return setError(labels.weakPassword);
    setPhase("saving");
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      // the recovery session is already signed in; continue where they were going
      router.replace(next);
    } catch (error) {
      setError(errorMessage(error, labels));
      setPhase("ready");
    }
  };

  if (phase === "checking") {
    return (
      <p role="status" className="flex items-center gap-3 text-lg text-fg-muted">
        <Loader2 aria-hidden className="size-5 animate-spin" />
        {labels.verifying}
      </p>
    );
  }

  if (phase === "invalid") {
    return (
      <div className="space-y-6">
        <p role="alert" className="text-lg">
          {error}
        </p>
        <Link
          href={localizedPath(locale, "/signin")}
          className="inline-flex h-12 items-center rounded-control bg-cloth px-6 text-on-cloth hover:bg-cloth-raised"
        >
          {labels.backToSignIn}
        </Link>
      </div>
    );
  }

  return (
    <form noValidate method="post" onSubmit={save} className="space-y-5">
      <div className="space-y-2">
        <label htmlFor="reset-password" className="block text-base">
          {labels.newPassword}
        </label>
        <div className="relative">
          <input
            ref={passwordRef}
            id="reset-password"
            type={showPassword ? "text" : "password"}
            name="password"
            autoComplete="new-password"
            required
            onChange={() => error && setError(null)}
            aria-invalid={Boolean(error)}
            aria-describedby="reset-help reset-error"
            className="h-12 w-full rounded-control border border-line-strong bg-surface px-4 pr-12 text-base outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
          />
          <button
            type="button"
            onClick={() => {
              setShowPassword((shown) => !shown);
              passwordRef.current?.focus();
            }}
            aria-label={showPassword ? labels.hidePassword : labels.showPassword}
            aria-pressed={showPassword}
            className="absolute inset-y-0 right-0 inline-flex w-12 items-center justify-center rounded-r-control text-fg-muted hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
          >
            {showPassword ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
          </button>
        </div>
        <p id="reset-help" className="text-sm text-fg-muted">
          {labels.passwordHint}
        </p>
      </div>

      <p id="reset-error" role="alert" className="min-h-6 text-sm text-destructive">
        {error}
      </p>

      <button
        type="submit"
        disabled={phase === "saving"}
        className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-control bg-cloth px-6 text-on-cloth transition-colors hover:bg-cloth-raised disabled:opacity-70"
      >
        {phase === "saving" ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
        {phase === "saving" ? labels.saving : labels.savePassword}
      </button>

      <Link href={localizedPath(locale, "/signin")} className="inline-flex items-center gap-1.5 text-sm text-link underline-offset-4 hover:underline">
        {labels.backToSignIn}
      </Link>
    </form>
  );
}
