"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, LoaderCircle, Search, TriangleAlert } from "lucide-react";
import { useAccount } from "@/lib/account/session";
import { connectionsOverview, type Failure, type Overview } from "@/lib/connections/actions";
import { findOnHardcover, knownHardcoverBooks, readHardcoverLibrary, rememberHardcoverBooks, sendToHardcover } from "@/lib/connections/client";
import type { HardcoverBook } from "@/lib/connections/hardcover";
import type { WorkNames } from "@/lib/catalog/queries";
import { formatNumber } from "@/lib/i18n/format";
import { localizedPath, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { localDB, type LibraryStatus } from "@/lib/local/db";
import { isPersonal } from "@/lib/personal/ids";
import type { MatchIndex } from "@/lib/transfer/match";
import { cn } from "@/lib/utils";
import { ImportSection, type ImportSource, type TransferLabels } from "@/components/transfer/goodreads-transfer";

type HcLabels = Dictionary["connections"];

const errorText = (hc: HcLabels, f: Failure) => hc.errors[f.code] ?? hc.errors.upstream;

/** Library → Hardcover: bring the reader's shelves in, or send their library out, each book confirmed first. */
export function HardcoverTransfer({ locale, labels, hc, works }: { locale: Locale; labels: TransferLabels; hc: HcLabels; works: WorkNames[] }) {
  const account = useAccount();
  const signedIn = account.status === "signed-in";
  const [state, setState] = useState<Overview["hardcover"] | string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    void connectionsOverview().then((r) => live && setState(r.ok ? r.hardcover : errorText(hc, r)));
    return () => {
      live = false;
    };
  }, [signedIn, hc]);

  const source = useMemo<ImportSource>(
    () => ({
      kind: "loader",
      start: hc.hcRead,
      again: hc.hcReadAgain,
      summary: hc.hcImportSummary,
      loading: (count) => t(hc.hcReading, { count: formatNumber(count, locale) }),
      load: async (progress) => {
        const r = await readHardcoverLibrary(progress);
        if (!r.ok) return errorText(hc, r);
        return r.books.length ? r.books : hc.hcNothing;
      },
    }),
    [hc, locale],
  );

  if (account.status === "loading" || (signedIn && state === null)) return <div className="min-h-40" aria-busy />;
  if (!signedIn)
    return (
      <p>
        <Link href={`${localizedPath(locale, "/signin")}?next=${encodeURIComponent(localizedPath(locale, "/library/hardcover"))}`} className="text-link underline-offset-4 hover:underline">
          {hc.signIn}
        </Link>
      </p>
    );
  if (typeof state === "string")
    return (
      <p role="alert" className="flex items-start gap-2 text-destructive">
        <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
        {state}
      </p>
    );
  if (!state?.available) return <p className="text-fg-muted">{hc.unavailable}</p>;
  if (!state.connected)
    return (
      <div className="space-y-4" data-testid="hardcover-not-connected">
        <p className="text-fg-muted">{hc.hcNotConnected}</p>
        <Link href={`${localizedPath(locale, "/profile")}#connections`} className="inline-flex h-11 items-center rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
          {hc.hcConnectHere}
        </Link>
      </div>
    );

  return (
    <div className="space-y-14">
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <Check aria-hidden className="size-4 text-cloth" />
        {t(hc.hardcoverAs, { name: state.label ?? "" })}
      </p>
      <ImportSection locale={locale} labels={labels} works={works} source={source} title={hc.hcImportTitle} intro={hc.hcImportIntro} id="hc-import" />
      <SendSection locale={locale} labels={labels} hc={hc} works={works} />
    </div>
  );
}

// ── sending ────────────────────────────────────────────────────────────────

type SendRow = {
  slug: string;
  title: string;
  author: string;
  status: LibraryStatus;
  rating: number | null;
  finishedAt: number | null;
  candidates: HardcoverBook[];
  /** the matcher (or an earlier choice) is confident */
  sure: boolean;
  /** Hardcover book id; 0 leaves the book out */
  choice: number;
};
type SendState =
  | { kind: "idle" }
  | { kind: "finding"; done: number; total: number }
  | { kind: "review"; rows: SendRow[] }
  | { kind: "sending"; rows: SendRow[]; done: number }
  | { kind: "done"; text: string }
  | { kind: "error"; message: string };

/** Which Hardcover result is our book: the same phonetic matching as the Goodreads import, the other way round. */
function judge(Index: typeof MatchIndex, w: WorkNames, hits: HardcoverBook[]): { id: number; order: HardcoverBook[] } {
  if (!hits.length) return { id: 0, order: [] };
  const index = new Index(hits.map((h) => ({ slug: String(h.id), title_bn: h.title, title_en: null, title_latn: null, authors: h.authors.map((a) => ({ name_bn: a, name_en: null })) })));
  const people = w.authors.flatMap((a) => [a.name_en, a.name_bn]);
  const tries = [w.title_en, w.title_bn].filter(Boolean).map((title) => index.match({ title, author: people[0] ?? null, additionalAuthors: people.slice(1) }));
  const sure = tries.find((m) => m.verdict === "match");
  const best = sure ?? tries.sort((a, b) => (b.candidates[0]?.score ?? 0) - (a.candidates[0]?.score ?? 0))[0];
  const ranked = (best?.candidates ?? []).map((c) => hits.find((h) => String(h.id) === c.slug)).filter((h): h is HardcoverBook => !!h);
  // Hardcover's own order for the rest, so every result can still be chosen
  const order = [...ranked, ...hits.filter((h) => !ranked.includes(h))];
  return { id: sure?.slug ? Number(sure.slug) : 0, order };
}

/** Above this many books, the wait for Hardcover's rate limit is worth a word. */
const SLOW = 20;

const bookLabel = (b: HardcoverBook) => [b.title, b.authors.slice(0, 2).join(", "), b.year ? String(b.year) : ""].filter(Boolean).join(" — ");

function SendSection({ locale, labels, hc, works }: { locale: Locale; labels: TransferLabels; hc: HcLabels; works: WorkNames[] }) {
  const [state, setState] = useState<SendState>({ kind: "idle" });
  const n = (x: number) => formatNumber(x, locale);

  const find = async () => {
    setState({ kind: "finding", done: 0, total: 0 });
    try {
      const byslug = new Map(works.map((w) => [w.slug, w]));
      // only books from our catalogue: a reader's own books never leave for Hardcover
      const entries = (await localDB().library.toArray()).filter((e) => !isPersonal(e.workSlug) && byslug.has(e.workSlug));
      if (!entries.length) return setState({ kind: "error", message: hc.hcEmpty });
      const remembered = await knownHardcoverBooks();
      const fresh = entries.filter((e) => !remembered[e.workSlug]);
      const queries = fresh.map((e) => {
        const w = byslug.get(e.workSlug)!;
        return [w.title_en, w.authors[0]?.name_en].filter(Boolean).join(" ");
      });
      setState({ kind: "finding", done: 0, total: queries.length });
      const found = queries.length ? await findOnHardcover(queries, (done) => setState({ kind: "finding", done, total: queries.length })) : { ok: true as const, results: [] };
      if (!found.ok) return setState({ kind: "error", message: errorText(hc, found) });
      const { MatchIndex } = await import("@/lib/transfer/match");
      const results = new Map(fresh.map((e, i) => [e.workSlug, found.results[i] ?? []]));

      const rows: SendRow[] = entries.map((e) => {
        const w = byslug.get(e.workSlug)!;
        const base = {
          slug: e.workSlug,
          title: locale === "bn" ? w.title_bn : `${w.title_en} (${w.title_bn})`,
          author: w.authors.map((a) => (locale === "bn" ? a.name_bn : a.name_en)).join(", "),
          status: e.status,
          rating: e.rating ?? null,
          finishedAt: e.finishedAt ?? null,
        };
        const known = remembered[e.workSlug];
        if (known) return { ...base, candidates: [known], sure: true, choice: known.id };
        const { id, order } = judge(MatchIndex, w, results.get(e.workSlug) ?? []);
        return { ...base, candidates: order, sure: id > 0, choice: id };
      });
      setState({ kind: "review", rows });
    } catch (e) {
      console.warn("[hardcover]", e);
      setState({ kind: "error", message: hc.errors.upstream });
    }
  };

  const send = async (rows: SendRow[]) => {
    setState({ kind: "sending", rows, done: 0 });
    try {
      const chosen = rows.filter((r) => r.choice > 0);
      const r = await sendToHardcover(
        chosen.map((x) => ({ bookId: x.choice, status: x.status, rating: x.rating, finishedAt: x.finishedAt })),
        (done) => setState((s) => (s.kind === "sending" ? { ...s, done } : s)),
      );
      if (!r.ok) return setState({ kind: "error", message: errorText(hc, r) });
      // remember what the reader confirmed, so the next send needs no second look; forget what they left out
      await rememberHardcoverBooks(Object.fromEntries(rows.map((x) => [x.slug, x.choice > 0 ? (x.candidates.find((c) => c.id === x.choice) ?? null) : null])));
      const text = [
        t(hc.hcSent, { added: n(r.added), updated: n(r.updated), unchanged: n(r.unchanged) }),
        r.failed ? t(hc.hcFailedSome, { count: n(r.failed) }) : "",
      ]
        .filter(Boolean)
        .join(" ");
      setState({ kind: "done", text });
    } catch (e) {
      console.warn("[hardcover]", e);
      setState({ kind: "error", message: hc.errors.upstream });
    }
  };

  const choose = (slug: string, id: number) => setState((s) => (s.kind === "review" ? { ...s, rows: s.rows.map((r) => (r.slug === slug ? { ...r, choice: id } : r)) } : s));

  return (
    <section aria-labelledby="hc-send" className="space-y-5">
      <h2 id="hc-send" className="text-2xl sm:text-3xl">
        {hc.hcSendTitle}
      </h2>
      <p className="max-w-2xl text-fg-muted">{hc.hcSendIntro}</p>
      <p className="max-w-2xl text-sm text-fg-subtle">{hc.hcOwnBooks}</p>

      {state.kind === "idle" || state.kind === "error" ? (
        <button type="button" onClick={() => void find()} className="inline-flex h-11 items-center gap-2 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
          <Search aria-hidden className="size-4" />
          {hc.hcFind}
        </button>
      ) : null}

      {state.kind === "error" ? (
        <p role="alert" className="flex items-start gap-2 text-destructive">
          <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.message}
        </p>
      ) : null}

      {state.kind === "finding" ? (
        <div className="space-y-1">
          <p role="status" className="flex items-center gap-2 text-fg-muted">
            <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
            {t(hc.hcFinding, { done: n(state.done), total: n(state.total) })}
          </p>
          {state.total > SLOW ? <p className="text-sm text-fg-subtle">{hc.hcSlow}</p> : null}
        </div>
      ) : null}

      {state.kind === "review" || state.kind === "sending" ? (
        <SendReview
          locale={locale}
          labels={labels}
          hc={hc}
          rows={state.rows}
          busy={state.kind === "sending"}
          done={state.kind === "sending" ? state.done : 0}
          onChoose={choose}
          onSend={() => state.kind === "review" && void send(state.rows)}
          onStartOver={() => void find()}
        />
      ) : null}

      {state.kind === "done" ? (
        <div className="space-y-4 rounded-[14px] border border-line p-5">
          <p role="status" className="flex items-start gap-2">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-cloth" />
            {state.text}
          </p>
          <button type="button" onClick={() => void find()} className="h-11 rounded-control border border-line-strong px-4 hover:bg-sunken">
            {hc.hcStartOver}
          </button>
        </div>
      ) : null}
    </section>
  );
}

const STATUS_KEY: Record<LibraryStatus, keyof TransferLabels> = { want: "statusWant", reading: "statusReading", finished: "statusFinished", dnf: "statusDnf" };

function SendReview({
  locale,
  labels,
  hc,
  rows,
  busy,
  onChoose,
  onSend,
  onStartOver,
  done,
}: {
  locale: Locale;
  labels: TransferLabels;
  hc: HcLabels;
  rows: SendRow[];
  busy: boolean;
  done: number;
  onChoose: (slug: string, id: number) => void;
  onSend: () => void;
  onStartOver: () => void;
}) {
  const n = (x: number) => formatNumber(x, locale);
  // grouped by what the matcher thought when the list was made, so rows don't jump while the reader chooses
  const [unsure] = useState(() => new Set(rows.filter((r) => !r.sure).map((r) => r.slug)));
  const check = rows.filter((r) => unsure.has(r.slug));
  const found = rows.filter((r) => !unsure.has(r.slug));
  const chosen = rows.filter((r) => r.choice > 0).length;

  const list = (items: SendRow[]) => (
    <ul className="divide-y divide-line border-y border-line">
      {items.map((r) => (
        <li key={r.slug} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] sm:items-center sm:gap-6" data-hc-row={r.slug}>
          <div className="min-w-0">
            <p className="truncate font-display">{r.title}</p>
            <p className="truncate text-sm text-fg-muted">
              {[r.author, labels[STATUS_KEY[r.status]], r.rating ? t(labels.rated, { count: n(r.rating) }) : ""].filter(Boolean).join(" · ")}
            </p>
          </div>
          <select
            aria-label={t(hc.hcBookFor, { title: r.title })}
            value={r.choice}
            disabled={busy}
            onChange={(e) => onChoose(r.slug, Number(e.target.value))}
            className={cn(
              "h-11 w-full min-w-0 rounded-control border bg-bg px-3 text-sm outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30",
              r.choice ? "border-line-strong" : "border-line text-fg-muted",
            )}
          >
            <option value={0}>{hc.hcNotThere}</option>
            {r.candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {bookLabel(c)}
              </option>
            ))}
          </select>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="space-y-8">
      <p>{t(hc.hcSummary, { found: n(rows.filter((r) => r.candidates.length).length), total: n(rows.length) })}</p>

      {check.length ? (
        <section aria-labelledby="hc-check" className="space-y-3">
          <h3 id="hc-check" className="text-xl">
            {hc.hcCheckTitle} <span className="text-base text-fg-muted">({n(check.length)})</span>
          </h3>
          <p className="text-sm text-fg-muted">{hc.hcCheckHint}</p>
          {list(check)}
        </section>
      ) : null}

      {found.length ? (
        <details open={found.length <= 12}>
          <summary className="cursor-pointer text-xl marker:text-fg-subtle">
            {hc.hcFoundTitle} <span className="text-base text-fg-muted">({n(found.length)})</span>
          </summary>
          <p className="mt-3 text-sm text-fg-muted">{hc.hcFoundHint}</p>
          <div className="mt-3">{list(found)}</div>
        </details>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || !chosen}
          onClick={onSend}
          className="inline-flex h-11 items-center gap-2 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised disabled:opacity-50"
        >
          {busy ? <LoaderCircle aria-hidden className="size-4 animate-spin motion-reduce:animate-none" /> : null}
          {busy ? t(hc.hcSending, { done: n(done), total: n(chosen) }) : t(hc.hcSend, { count: n(chosen) })}
        </button>
        <button type="button" disabled={busy} onClick={onStartOver} className="h-11 rounded-control px-4 text-fg-muted hover:bg-sunken hover:text-fg disabled:opacity-50">
          {hc.hcStartOver}
        </button>
        {!chosen ? <p className="text-sm text-fg-muted">{labels.nothingChosen}</p> : null}
      </div>
      {busy && chosen > SLOW ? <p className="text-sm text-fg-subtle">{hc.hcSlow}</p> : null}
    </div>
  );
}
