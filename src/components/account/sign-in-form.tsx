"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { getSupabase, useAccount, accountsEnabled } from "@/lib/account/session";
import { providerEnabled, type OAuthProvider } from "@/lib/account/providers";
import { safeNext } from "@/lib/account/next";
import { MIN_PASSWORD } from "@/lib/account/policy";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

type Labels = Dictionary["account"];
type Mode = "signin" | "signup" | "forgot";
type Step =
  | { kind: "form" }
  | { kind: "done" }
  | { kind: "check-email"; email: string }
  | { kind: "reset-sent"; email: string };

// false while server-rendered and hydrating: a tap on "submit" before then
// would submit the form natively (reloading the page with the address in the URL)
const noop = () => () => {};
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function errorMessage(error: unknown, labels: Labels): string {
  const e = error as { status?: number; code?: string; message?: string } | null;
  const message = e?.message ?? "";
  if (typeof navigator !== "undefined" && !navigator.onLine) return labels.offline;
  if (e?.status === 429 || e?.code === "over_email_send_rate_limit" || e?.code === "over_request_rate_limit") return labels.tooMany;
  if (e?.code === "invalid_credentials" || e?.code === "invalid_grant") return labels.wrongPassword;
  if (e?.code === "email_not_confirmed") return labels.emailNotConfirmed;
  if (e?.code === "user_already_exists" || e?.code === "email_exists" || /already registered|already exists/i.test(message)) {
    return labels.emailTaken;
  }
  if (e?.code === "weak_password" || /password should be at least/i.test(message)) return labels.weakPassword;
  if (e?.code === "same_password") return labels.samePassword;
  if (/provider is not enabled|unsupported provider/i.test(message)) return labels.providerUnavailable;
  if (e?.code === "otp_expired" || e?.code === "invalid_otp" || e?.code === "bad_code_verifier" || e?.code === "flow_state_not_found") {
    return labels.linkFailed;
  }
  if (message.toLowerCase().includes("fetch")) return labels.offline;
  return labels.failed;
}

export function SignInForm({ locale, labels }: { locale: Locale; labels: Labels }) {
  const router = useRouter();
  const account = useAccount();
  const [mode, setMode] = useState<Mode>("signin");
  const [step, setStep] = useState<Step>({ kind: "form" });
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const hydrated = useHydrated();
  // where to go afterwards (?next=…). Read when needed, not while rendering:
  // on a client-side navigation the address bar updates after the first render.
  const target = () => safeNext(new URLSearchParams(window.location.search).get("next"), localizedPath(locale, "/library"));

  const confirmUrl = () => {
    const url = new URL(localizedPath(locale, "/signin/confirm"), window.location.origin);
    url.searchParams.set("next", target());
    return url.toString();
  };

  const resetUrl = () => {
    const url = new URL(localizedPath(locale, "/signin/reset"), window.location.origin);
    url.searchParams.set("next", target());
    return url.toString();
  };

  // warm the library while the reader types
  useEffect(() => {
    if (accountsEnabled) void getSupabase();
  }, []);

  // an error from a social callback (?error=…): show it once, then clean the URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const reason = params.get("error");
    if (!reason) return;
    // one-time read of the callback's URL after hydration, not a render loop
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(
      reason === "access_denied"
        ? labels.signInCancelled
        : reason === "facebook"
          ? labels.facebookFailed
          : labels.googleFailed,
    );
    params.delete("error");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }, [labels.signInCancelled, labels.facebookFailed, labels.googleFailed]);

  if (!accountsEnabled) return <p className="text-fg-muted">{labels.unavailable}</p>;

  if (account.status === "signed-in" && step.kind !== "done") {
    return (
      <div className="space-y-5">
        <p className="text-lg [overflow-wrap:anywhere]">{t(labels.signedInAs, { email: account.user.email ?? "" })}</p>
        <button
          type="button"
          onClick={() => router.push(target())}
          className="inline-flex h-12 items-center rounded-control bg-cloth px-6 text-on-cloth hover:bg-cloth-raised"
        >
          {labels.continue}
        </button>
      </div>
    );
  }

  const signIn = async (address: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.signInWithPassword({ email: address, password });
      if (error) throw error;
      setStep({ kind: "done" });
      router.replace(target());
    } catch (e) {
      setError(errorMessage(e, labels));
    } finally {
      setBusy(false);
    }
  };

  const signUp = async (name: string, address: string, password: string) => {
    setBusy(true);
    setError(null);
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.auth.signUp({
        email: address,
        password,
        options: { data: { name }, emailRedirectTo: confirmUrl() },
      });
      if (error) throw error;
      // with email confirmation on, there is no session until the link is opened
      if (!data.session) {
        setStep({ kind: "check-email", email: address });
        return;
      }
      setStep({ kind: "done" });
      router.replace(target());
    } catch (e) {
      setError(errorMessage(e, labels));
    } finally {
      setBusy(false);
    }
  };

  const sendReset = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      const sb = await getSupabase();
      // Supabase answers the same whether or not the address has an account
      const { error } = await sb.auth.resetPasswordForEmail(address, { redirectTo: resetUrl() });
      if (error) throw error;
      setStep({ kind: "reset-sent", email: address });
    } catch (e) {
      setError(errorMessage(e, labels));
    } finally {
      setBusy(false);
    }
  };

  /** First-party OAuth: our route stores state/PKCE and sends the browser to Google. */
  const startGoogle = () => {
    setBusy(true);
    setError(null);
    const params = new URLSearchParams({ next: target(), locale });
    // a full-page navigation is required: the server route stores the OAuth
    // state cookie and redirects to Google
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign(`/api/auth/google/start?${params.toString()}`);
  };

  const continueWithFacebook = async () => {
    setBusy(true);
    setError(null);
    try {
      if (!(await providerEnabled("facebook"))) {
        setError(labels.providerUnavailable);
        setBusy(false);
        return;
      }
      const params = new URLSearchParams({ next: target(), locale });
      // a full-page navigation is required: the server route stores the OAuth
      // state cookie and redirects to Facebook
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/api/auth/facebook/start?${params.toString()}`);
    } catch (e) {
      setError(errorMessage(e, labels));
      setBusy(false);
    }
  };

  if (step.kind === "done") {
    return (
      <p role="status" className="flex items-center gap-2 text-lg">
        <Check aria-hidden className="size-5 text-cloth dark:text-foil" />
        {labels.signedIn}
      </p>
    );
  }

  if (step.kind === "check-email" || step.kind === "reset-sent") {
    const reset = step.kind === "reset-sent";
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-lg">
            <Check aria-hidden className="size-5 shrink-0 text-cloth dark:text-foil" />
            {reset ? labels.resetSentTitle : labels.checkEmailTitle}
          </p>
          <p className="[overflow-wrap:anywhere] text-fg-muted">
            {t(reset ? labels.resetSentBody : labels.checkEmailBody, { email: step.email })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setMode("signin");
            setStep({ kind: "form" });
            setError(null);
          }}
          className="inline-flex items-center gap-1.5 text-sm text-link underline-offset-4 hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" />
          {labels.backToSignIn}
        </button>
      </div>
    );
  }

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setShowPassword(false);
  };

  return (
    <div className="space-y-7">
      <div className="space-y-3">
        <ProviderButton
          provider="google"
          label={labels.continueWithGoogle}
          disabled={busy || !hydrated}
          onClick={startGoogle}
        />
        <ProviderButton
          provider="facebook"
          label={labels.continueWithFacebook}
          disabled={busy || !hydrated}
          onClick={() => void continueWithFacebook()}
        />
      </div>

      <div className="flex items-center gap-3 text-sm text-fg-subtle" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        {labels.or}
        <span className="h-px flex-1 bg-line" />
      </div>

      <form
        noValidate
        method="post"
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement | null)?.value ?? "";
          const name = field("name").trim();
          const address = field("email").trim();
          const password = field("password");
          setEmail(address);
          if (!EMAIL.test(address)) return setError(labels.invalidEmail);
          if (mode === "signup" && !name) return setError(labels.nameRequired);
          if (mode !== "forgot" && !password) return setError(labels.passwordRequired);
          if (mode === "signup" && password.length < MIN_PASSWORD) return setError(labels.weakPassword);
          if (!hydrated) return;
          if (mode === "forgot") return void sendReset(address);
          if (mode === "signup") return void signUp(name, address, password);
          return void signIn(address, password);
        }}
        className="space-y-5"
      >
        {mode === "signup" ? (
          <div key="name" className="space-y-2">
            <label htmlFor="auth-name" className="block text-base">
              {labels.name}
            </label>
            <input
              id="auth-name"
              type="text"
              name="name"
              autoComplete="name"
              required
              maxLength={80}
              onChange={() => error && setError(null)}
              aria-invalid={Boolean(error) && error === labels.nameRequired}
              className="h-12 w-full rounded-control border border-line-strong bg-surface px-4 text-base outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
            />
          </div>
        ) : null}

        <div key="email" className="space-y-2">
          <label htmlFor="auth-email" className="block text-base">
            {labels.email}
          </label>
          <input
            id="auth-email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            defaultValue={email}
            onChange={() => error && setError(null)}
            aria-invalid={Boolean(error)}
            aria-describedby="auth-error"
            className="h-12 w-full rounded-control border border-line-strong bg-surface px-4 text-base outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
          />
        </div>

        {mode !== "forgot" ? (
          <div key="password" className="space-y-2">
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="auth-password" className="block text-base">
                {labels.password}
              </label>
              {mode === "signin" ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => switchMode("forgot")}
                  className="text-sm text-link underline-offset-4 hover:underline disabled:opacity-60"
                >
                  {labels.forgotPassword}
                </button>
              ) : null}
            </div>
            <div className="relative">
              <input
                ref={passwordRef}
                id="auth-password"
                type={showPassword ? "text" : "password"}
                name="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                onChange={() => error && setError(null)}
                aria-invalid={Boolean(error)}
                aria-describedby={mode === "signup" ? "auth-password-help auth-error" : "auth-error"}
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
            {mode === "signup" ? (
              <p id="auth-password-help" className="text-sm text-fg-muted">
                {labels.passwordHint}
              </p>
            ) : null}
          </div>
        ) : null}

        <p id="auth-error" role="alert" className="min-h-6 text-sm text-destructive">
          {error}
        </p>

        <button
          type="submit"
          disabled={busy || !hydrated}
          data-busy={busy || undefined}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-control bg-cloth px-6 text-on-cloth transition-colors hover:bg-cloth-raised data-busy:opacity-70"
        >
          {busy ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
          {busy
            ? mode === "signup"
              ? labels.creating
              : mode === "forgot"
                ? labels.sending
                : labels.signingIn
            : mode === "signup"
              ? labels.createAccountAction
              : mode === "forgot"
                ? labels.sendReset
                : labels.signInAction}
        </button>
      </form>

      <div className="border-t border-line pt-5 text-sm text-fg-muted">
        {mode === "signup" ? (
          <p>
            {labels.haveAccount}{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => switchMode("signin")}
              className="text-link underline-offset-4 hover:underline disabled:opacity-60"
            >
              {labels.signIn}
            </button>
          </p>
        ) : mode === "forgot" ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => switchMode("signin")}
            className="inline-flex items-center gap-1.5 text-link underline-offset-4 hover:underline disabled:opacity-60"
          >
            <ArrowLeft aria-hidden className="size-4" />
            {labels.backToSignIn}
          </button>
        ) : (
          <p>
            {labels.newHere}{" "}
            <button
              type="button"
              disabled={busy}
              onClick={() => switchMode("signup")}
              className="text-link underline-offset-4 hover:underline disabled:opacity-60"
            >
              {labels.createAccount}
            </button>
          </p>
        )}
      </div>
    </div>
  );
}

function ProviderButton({
  provider,
  label,
  disabled,
  onClick,
}: {
  provider: OAuthProvider;
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      data-provider={provider}
      className="inline-flex h-12 w-full items-center justify-center gap-3 rounded-control border border-line-strong bg-surface px-6 text-base transition-colors hover:bg-sunken disabled:opacity-60"
    >
      {provider === "google" ? <GoogleMark /> : <FacebookMark />}
      {label}
    </button>
  );
}

function GoogleMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0">
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.68-.06-1.34-.18-1.97H12v3.73h5.38a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.98-4.33 2.98-7.28Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.97-.9 6.62-2.43l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.76-5.59-4.12H3.06v2.58A10 10 0 0 0 12 22Z"
      />
      <path fill="#FBBC05" d="M6.41 13.9a6 6 0 0 1 0-3.8V7.52H3.06a10 10 0 0 0 0 8.96l3.35-2.58Z" />
      <path
        fill="#EA4335"
        d="M12 5.96c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.94 5.52l3.35 2.58C7.2 7.73 9.4 5.96 12 5.96Z"
      />
    </svg>
  );
}

function FacebookMark() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-5 shrink-0">
      <path
        fill="#1877F2"
        d="M24 12a12 12 0 1 0-13.88 11.85v-8.38H7.08V12h3.04V9.36c0-3 1.79-4.67 4.53-4.67 1.31 0 2.68.24 2.68.24v2.95h-1.51c-1.49 0-1.95.92-1.95 1.87V12h3.32l-.53 3.47h-2.79v8.38A12 12 0 0 0 24 12Z"
      />
    </svg>
  );
}
