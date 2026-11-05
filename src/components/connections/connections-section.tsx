"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, ExternalLink, LoaderCircle, Send, Unplug } from "lucide-react";
import { useAccount } from "@/lib/account/session";
import { connectionsOverview, connectReadwise, disconnect, type Failure, type Overview } from "@/lib/connections/actions";
import { readwiseLastSent, sendHighlights } from "@/lib/connections/client";
import { formatNumber } from "@/lib/i18n/format";
import { localeTag, localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import { CONNECTIONS_PLACEHOLDER } from "./placeholder";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

type Labels = Dictionary["connections"];

const button = "inline-flex h-11 items-center gap-2 rounded-control px-4 text-sm disabled:opacity-60";
const primary = `${button} bg-cloth text-on-cloth hover:bg-cloth-raised`;
const secondary = `${button} border border-line-strong hover:bg-sunken`;
const quiet = `${button} text-fg-muted hover:bg-sunken hover:text-fg`;

const errorText = (labels: Labels, f: Failure) => labels.errors[f.code] ?? labels.errors.upstream;

/** Profile: Hardcover and Readwise, connected by the reader and only used when they ask. */
export function ConnectionsSection({ locale, labels }: { locale: Locale; labels: Labels }) {
  const account = useAccount();
  const signedIn = account.status === "signed-in";
  const [overview, setOverview] = useState<Overview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const params = useSearchParams();
  // what came back from Hardcover, kept while the address is tidied (a reload should not repeat it)
  const [notice] = useState(() => {
    const outcome = params.get("hardcover");
    return outcome && Object.hasOwn(labels.hardcoverNotice, outcome) ? labels.hardcoverNotice[outcome as keyof Labels["hardcoverNotice"]] : null;
  });
  useEffect(() => {
    if (!params.has("hardcover")) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("hardcover");
    window.history.replaceState(window.history.state, "", url);
  }, [params]);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void connectionsOverview().then((r) => {
      if (!live) return;
      if (r.ok) {
        setOverview(r);
        setFailure(null);
      } else setFailure(errorText(labels, r));
    });
    return () => {
      live = false;
    };
  }, [signedIn, version, labels]);

  if (account.status === "loading") return <div className={CONNECTIONS_PLACEHOLDER} aria-busy />;
  // the account section above has the sign-in button
  if (!signedIn)
    return (
      <div className="space-y-3">
        <p className="text-fg-muted">{labels.intro}</p>
        <p className="text-sm text-fg-subtle">{labels.signIn}</p>
      </div>
    );

  const refresh = () => setVersion((v) => v + 1);
  return (
    <div className="space-y-6">
      <p className="text-fg-muted">{labels.intro}</p>
      {notice ? (
        <p role="status" className="rounded-[10px] bg-sunken px-4 py-3 text-sm">
          {notice}
        </p>
      ) : null}
      {failure ? (
        <p role="alert" className="text-sm text-destructive">
          {failure}
        </p>
      ) : null}
      {!overview ? (
        <div className="min-h-32" aria-busy />
      ) : (
        <>
          <HardcoverCard locale={locale} labels={labels} state={overview.hardcover} onChange={refresh} />
          <ReadwiseCard locale={locale} labels={labels} state={overview.readwise} onChange={refresh} />
        </>
      )}
    </div>
  );
}

function Card({ title, about, children, testId }: { title: string; about: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="space-y-3 rounded-[14px] border border-line p-5" data-testid={testId} aria-label={title}>
      <h3 className="font-display text-xl">{title}</h3>
      <p className="text-sm text-fg-muted">{about}</p>
      {children}
    </section>
  );
}

function HardcoverCard({ locale, labels, state, onChange }: { locale: Locale; labels: Labels; state: Overview["hardcover"]; onChange: () => void }) {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <Card title={labels.hardcover} about={labels.hardcoverAbout} testId="hardcover-card">
      {!state.available ? (
        <p className="text-sm text-fg-subtle">{labels.unavailable}</p>
      ) : !state.connected ? (
        // a plain link: the server sends the reader on to Hardcover to approve
        <a href={`/api/connections/hardcover/start?next=${encodeURIComponent(pathname)}`} className={primary}>
          {labels.hardcoverConnect}
        </a>
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm">
            <Check aria-hidden className="size-4 text-cloth" />
            {t(labels.hardcoverAs, { name: state.label ?? "" })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={localizedPath(locale, "/library/hardcover")} className={secondary}>
              {labels.hardcoverOpen}
            </Link>
            <button
              type="button"
              disabled={busy}
              className={quiet}
              onClick={async () => {
                setBusy(true);
                const r = await disconnect("hardcover");
                setBusy(false);
                setMessage(r.ok ? labels.disconnected : errorText(labels, r));
                if (r.ok) onChange();
              }}
            >
              <Unplug aria-hidden className="size-4" />
              {labels.disconnect}
            </button>
          </div>
        </div>
      )}
      <p role="status" className="min-h-5 text-sm text-fg-muted">
        {message}
      </p>
    </Card>
  );
}

function ReadwiseCard({ locale, labels, state, onChange }: { locale: Locale; labels: Labels; state: Overview["readwise"]; onChange: () => void }) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [own, setOwn] = useState(false);
  const lastSent = useLiveQuery(() => readwiseLastSent(), []);
  const n = (x: number) => formatNumber(x, locale);

  const send = async (all: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await sendHighlights({ all, includeOwn: own }, (p) =>
        setMessage(p.waiting ? t(labels.readwiseWaiting, { seconds: n(p.waiting) }) : t(labels.readwiseSending, { done: n(p.done), total: n(p.total) })),
      );
      setMessage(r.ok ? (r.sent ? t(labels.readwiseSent, { count: n(r.sent) }) : labels.readwiseNothing) : errorText(labels, r));
      if (!r.ok && r.code === "reconnect") onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title={labels.readwise} about={labels.readwiseAbout} testId="readwise-card">
      {!state.available ? (
        <p className="text-sm text-fg-subtle">{labels.unavailable}</p>
      ) : !state.connected ? (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage(null);
            const r = await connectReadwise(token);
            setBusy(false);
            if (r.ok) {
              setToken("");
              onChange();
            } else setMessage(errorText(labels, r));
          }}
        >
          <label className="block space-y-2">
            <span className="block text-sm">{labels.readwiseToken}</span>
            <input
              type="password"
              name="readwise-token"
              autoComplete="off"
              spellCheck={false}
              required
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="h-11 w-full rounded-control border border-line-strong bg-bg px-3 font-mono text-sm outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
            />
            <span className="block text-xs text-fg-muted">{labels.readwiseTokenHint}</span>
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" disabled={busy || !token.trim()} className={primary}>
              {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
              {busy ? labels.connecting : labels.connect}
            </button>
            <a href="https://readwise.io/access_token" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm text-link underline-offset-4 hover:underline">
              {labels.readwiseGetToken}
              <ExternalLink aria-hidden className="size-3.5" />
            </a>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm">
            <Check aria-hidden className="size-4 text-cloth" />
            {labels.readwiseConnected}
          </p>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-[var(--color-cloth)]" />
            {labels.readwiseOwn}
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} className={primary} onClick={() => void send(false)}>
              <Send aria-hidden className="size-4" />
              {labels.readwiseSend}
            </button>
            <button type="button" disabled={busy} className={secondary} onClick={() => void send(true)}>
              {labels.readwiseSendAll}
            </button>
            <button
              type="button"
              disabled={busy}
              className={quiet}
              onClick={async () => {
                setBusy(true);
                const r = await disconnect("readwise");
                setBusy(false);
                setMessage(r.ok ? labels.disconnected : errorText(labels, r));
                if (r.ok) onChange();
              }}
            >
              <Unplug aria-hidden className="size-4" />
              {labels.disconnect}
            </button>
          </div>
          {lastSent ? <p className="text-xs text-fg-subtle">{t(labels.readwiseLast, { date: new Intl.DateTimeFormat(localeTag[locale], { dateStyle: "medium", timeStyle: "short" }).format(lastSent) })}</p> : null}
          <p className="text-xs text-fg-subtle">{labels.readwiseDeleted}</p>
        </div>
      )}
      <p role="status" className="min-h-5 text-sm text-fg-muted" data-testid="readwise-status">
        {message}
      </p>
    </Card>
  );
}
