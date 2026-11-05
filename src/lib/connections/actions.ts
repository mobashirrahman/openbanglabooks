"use server";

import { connectionsConfigured } from "./crypto";
import { HARDCOVER_FIND_BATCH, HARDCOVER_SEND_BATCH, READWISE_BATCH } from "./limits";
import { HC_STATUS, hardcoverConfigured, libraryPage, revokeTokens, searchBooks, sendBooks, type HardcoverEntry, type HardcoverSecret, type SendResult } from "./hardcover";
import { readwiseCheck, readwiseCreate, type ReadwiseHighlight } from "./readwise";
import { ConnectionError, deleteConnection, listConnections, loadConnection, markUsed, saveConnection, type ConnectionErrorCode, type Provider } from "./store";

/**
 * What the browser may ask of a reader's connections. Every action checks
 * the signed-in reader itself and validates its input; tokens never travel
 * back to the browser. Errors come back as codes (thrown errors are hidden
 * in production builds).
 */

export type Failure = { ok: false; code: ConnectionErrorCode; retryAfter?: number };
type Result<T> = ({ ok: true } & T) | Failure;

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (e) {
    if (e instanceof ConnectionError) {
      if (e.code === "upstream") console.warn("[connections]", e.message);
      return { ok: false, code: e.code, retryAfter: e.retryAfter };
    }
    console.error("[connections]", e);
    return { ok: false, code: "upstream" };
  }
}

export type Overview = {
  hardcover: { available: boolean; label: string | null; connected: boolean };
  readwise: { available: boolean; connected: boolean; lastUsedAt: string | null };
};

export async function connectionsOverview(): Promise<Result<Overview>> {
  return run(async () => {
    const list = await listConnections();
    const hc = list.find((c) => c.provider === "hardcover");
    const rw = list.find((c) => c.provider === "readwise");
    return {
      hardcover: { available: hardcoverConfigured(), connected: !!hc, label: hc?.label ?? null },
      readwise: { available: connectionsConfigured(), connected: !!rw, lastUsedAt: rw?.lastUsedAt ?? null },
    };
  });
}

// ── Readwise ───────────────────────────────────────────────────────────────

export async function connectReadwise(token: string): Promise<Result<object>> {
  return run(async () => {
    if (!connectionsConfigured()) throw new ConnectionError("notConfigured");
    const clean = String(token ?? "").trim();
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(clean)) throw new ConnectionError("rejected");
    if (!(await readwiseCheck(clean))) throw new ConnectionError("rejected");
    await saveConnection("readwise", { token: clean }, null, null);
    return {};
  });
}

export type HighlightIn = {
  id: string;
  text: string;
  note: string | null;
  title: string;
  author: string;
  /** 0–1 through the book */
  fraction: number;
  createdAt: number;
  /** the passage on this site, unique per highlight */
  url: string;
};

const clip = (s: string | null | undefined, n: number) => (s ?? "").slice(0, n);

/** Sends up to READWISE_BATCH highlights; the same highlight sent again is updated, not doubled. */
export async function sendToReadwise(items: HighlightIn[]): Promise<Result<{ sent: number }>> {
  return run(async () => {
    if (!Array.isArray(items) || items.length > READWISE_BATCH) throw new ConnectionError("rejected");
    const c = await loadConnection<{ token: string }>("readwise");
    if (!c) throw new ConnectionError("notConnected");
    const highlights: ReadwiseHighlight[] = items
      .filter((h) => typeof h?.text === "string" && h.text.trim() && typeof h.url === "string" && /^https?:\/\//.test(h.url))
      .map((h) => ({
        text: clip(h.text.trim(), 8191),
        title: clip(h.title, 511) || "OpenBanglaBooks",
        author: clip(h.author, 1024),
        ...(h.note?.trim() ? { note: clip(h.note.trim(), 8191) } : {}),
        location: Math.max(0, Math.round(Number(h.fraction) * 1_000_000) || 0),
        location_type: "order",
        highlighted_at: new Date(Number(h.createdAt) || Date.now()).toISOString(),
        highlight_url: clip(h.url, 4095),
        category: "books",
        source_type: "openbanglabooks",
      }));
    if (highlights.length) await readwiseCreate(c.value.token, highlights);
    await markUsed("readwise");
    return { sent: highlights.length };
  });
}

// ── Hardcover ──────────────────────────────────────────────────────────────

export async function hardcoverLibrary(offset: number): Promise<Result<{ entries: HardcoverEntry[]; more: boolean; spent: number }>> {
  return run(() => libraryPage(Math.max(0, Math.floor(Number(offset) || 0))));
}

export async function hardcoverFind(queries: string[]): Promise<Result<Awaited<ReturnType<typeof searchBooks>>>> {
  return run(async () => {
    if (!Array.isArray(queries) || queries.length > HARDCOVER_FIND_BATCH) throw new ConnectionError("rejected");
    return searchBooks(queries.map((q) => String(q).slice(0, 300)));
  });
}

export type SendIn = { bookId: number; status: "want" | "reading" | "finished" | "dnf"; rating: number | null; finishedAt: number | null };

export async function hardcoverSend(items: SendIn[]): Promise<Result<SendResult>> {
  return run(async () => {
    if (!Array.isArray(items) || items.length > HARDCOVER_SEND_BATCH) throw new ConnectionError("rejected");
    return sendBooks(
      items
        .filter((i) => Number.isInteger(i?.bookId) && i.bookId > 0 && i.status in HC_STATUS)
        .map((i) => ({
          bookId: i.bookId,
          status: HC_STATUS[i.status],
          rating: i.rating && i.rating >= 1 && i.rating <= 5 ? Math.round(i.rating) : null,
          finishedOn: i.finishedAt ? new Date(i.finishedAt).toISOString().slice(0, 10) : null,
        })),
    );
  });
}

// ── disconnecting ──────────────────────────────────────────────────────────

export async function disconnect(provider: Provider): Promise<Result<object>> {
  return run(async () => {
    if (provider !== "hardcover" && provider !== "readwise") throw new ConnectionError("rejected");
    if (provider === "hardcover" && hardcoverConfigured()) {
      // revoked at Hardcover too, so the app no longer shows among the reader's sessions there
      const c = await loadConnection<HardcoverSecret>("hardcover").catch(() => null);
      if (c) await revokeTokens(c.value.refresh);
    }
    await deleteConnection(provider);
    return {};
  });
}

/** Before an account is deleted: every connection revoked and removed. */
export async function disconnectAll(): Promise<Result<object>> {
  return run(async () => {
    for (const c of await listConnections()) {
      const r = await disconnect(c.provider);
      if (!r.ok) throw new ConnectionError(r.code);
    }
    return {};
  });
}
