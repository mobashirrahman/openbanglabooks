"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Loader2, Mail } from "lucide-react";
import { getSupabase, useAccount, accountsEnabled } from "@/lib/account/session";
import { formatNumber, toAsciiDigits } from "@/lib/i18n/format";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

type Labels = Dictionary["account"];
type Step = { kind: "email" } | { kind: "code"; email: string } | { kind: "done" };

const RESEND_SECONDS = 60;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Only same-site paths: `next` comes from the URL and must never send a reader elsewhere. */
export function safeNext(raw: string | null | undefined, fallback: string): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  return raw;
}

export function errorMessage(error: unknown, labels: Labels): string {
  const e = error as { status?: number; code?: string; message?: string } | null;
  if (typeof navigator !== "undefined" && !navigator.onLine) return labels.offline;
  if (e?.status === 429 || e?.code === "over_email_send_rate_limit" || e?.code === "over_request_rate_limit") return labels.tooMany;
  if (e?.code === "otp_expired" || e?.code === "invalid_otp" || e?.status === 403) return labels.wrongCode;
  if (e?.message?.toLowerCase().includes("fetch")) return labels.offline;
  return labels.failed;
}

export function SignInForm({ locale, labels }: { locale: Locale; labels: Labels }) {
  const router = useRouter();
  const account = useAccount();
  const [step, setStep] = useState<Step>({ kind: "email" });
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);
  // where to go afterwards (?next=…). Read when needed, not while rendering:
  // on a client-side navigation the address bar updates after the first render.
  const target = () => safeNext(new URLSearchParams(window.location.search).get("next"), localizedPath(locale, "/library"));

  // warm the library while the reader types their address
  useEffect(() => {
    if (accountsEnabled) void getSupabase();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (step.kind === "code") codeRef.current?.focus();
  }, [step.kind]);

  if (!accountsEnabled) return <p className="text-fg-muted">{labels.unavailable}</p>;

  if (account.status === "signed-in" && step.kind !== "done") {
    return (
      <div className="space-y-5">
        <p className="text-lg">{t(labels.signedInAs, { email: account.user.email ?? "" })}</p>
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

  const send = async (address: string) => {
    setBusy(true);
    setError(null);
    try {
      const sb = await getSupabase();
      const confirm = new URL(localizedPath(locale, "/signin/confirm"), window.location.origin);
      confirm.searchParams.set("next", target());
      const { error } = await sb.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true, emailRedirectTo: confirm.toString() },
      });
      if (error) throw error;
      setStep({ kind: "code", email: address });
      setCode("");
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(errorMessage(e, labels));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (address: string, token: string) => {
    setBusy(true);
    setError(null);
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.verifyOtp({ email: address, token, type: "email" });
      if (error) throw error;
      setStep({ kind: "done" });
      router.replace(target());
    } catch (e) {
      setError(errorMessage(e, labels));
      setCode("");
      codeRef.current?.focus();
    } finally {
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

  if (step.kind === "email") {
    return (
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          const address = email.trim();
          if (!EMAIL.test(address)) return setError(labels.invalidEmail);
          void send(address);
        }}
        className="space-y-5"
      >
        <div className="space-y-2">
          <label htmlFor="signin-email" className="block text-base">
            {labels.email}
          </label>
          <input
            id="signin-email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby="signin-help signin-error"
            className="h-12 w-full rounded-control border border-line-strong bg-surface px-4 text-base outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
          />
          <p id="signin-help" className="text-sm text-fg-muted">
            {labels.noPassword}
          </p>
        </div>
        <ErrorLine id="signin-error" text={error} />
        <button
          type="submit"
          disabled={busy}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-control bg-cloth px-6 text-on-cloth transition-colors hover:bg-cloth-raised disabled:opacity-70 sm:w-auto"
        >
          {busy ? <Loader2 aria-hidden className="size-5 animate-spin" /> : <Mail aria-hidden className="size-5" />}
          {busy ? labels.sending : labels.sendCode}
        </button>
      </form>
    );
  }

  const address = step.email;
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === 6) void verify(address, code);
      }}
      className="space-y-5"
    >
      <p className="text-lg" role="status">
        {t(labels.codeSent, { email: address })}
      </p>
      <div className="space-y-2">
        <label htmlFor="signin-code" className="block text-base">
          {labels.code}
        </label>
        <input
          ref={codeRef}
          id="signin-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={12}
          value={code}
          onChange={(e) => {
            // Bengali keyboards type ০–৯; pasted codes may carry spaces
            const digits = toAsciiDigits(e.target.value).replace(/\D/g, "").slice(0, 6);
            setCode(digits);
            setError(null);
            if (digits.length === 6 && !busy) void verify(address, digits);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby="signin-code-help signin-error"
          className="h-14 w-full max-w-[16rem] rounded-control border border-line-strong bg-surface px-4 text-center font-mono text-2xl tracking-[0.4em] outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
        />
        <p id="signin-code-help" className="text-sm text-fg-muted">
          {labels.checkSpam}
        </p>
      </div>
      <ErrorLine id="signin-error" text={error} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-control bg-cloth px-6 text-on-cloth transition-colors hover:bg-cloth-raised disabled:opacity-60"
        >
          {busy ? <Loader2 aria-hidden className="size-5 animate-spin" /> : null}
          {busy ? labels.verifying : labels.verify}
        </button>
        <button
          type="button"
          disabled={busy || cooldown > 0}
          onClick={() => void send(address)}
          className="inline-flex h-12 items-center rounded-control px-4 text-fg-muted hover:bg-sunken hover:text-fg disabled:hover:bg-transparent disabled:hover:text-fg-muted"
        >
          {cooldown > 0 ? t(labels.resendIn, { seconds: formatNumber(cooldown, locale) }) : labels.resend}
        </button>
      </div>
      <button
        type="button"
        onClick={() => {
          setStep({ kind: "email" });
          setError(null);
        }}
        className="inline-flex items-center gap-1.5 text-sm text-link underline-offset-4 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {labels.changeEmail}
      </button>
    </form>
  );
}

function ErrorLine({ id, text }: { id: string; text: string | null }) {
  return (
    <p id={id} role="alert" className="min-h-6 text-sm text-destructive">
      {text}
    </p>
  );
}
