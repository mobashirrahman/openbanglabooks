import "server-only";
import { connectionsConfigured } from "./crypto";
import { ConnectionError, deleteConnection, leaseConnection, loadConnection, markUsed, releaseConnection, rotateConnection } from "./store";

/**
 * Hardcover (https://docs.hardcover.app), checked 2026-11-05. Hardcover
 * asks that apps people sign into use OAuth, never a pasted token, and
 * that the API is called from a server: this is a confidential client
 * (authorization code + PKCE, client secret over HTTP Basic). Access
 * tokens last a week; refresh tokens last six months and rotate on every
 * use, and one used twice revokes the whole chain, so refreshes are
 * serialised by a lease in the database.
 *
 * Request shapes follow Hardcover's own TypeScript SDK (0.1.1).
 */

const api = () => (process.env.HARDCOVER_API_URL || "https://api.hardcover.app").replace(/\/$/, "");
const authorizeEndpoint = () => process.env.HARDCOVER_AUTHORIZE_URL || "https://hardcover.app/oauth2/authorize";
export const hardcoverIssuer = () => process.env.HARDCOVER_ISSUER || "https://api.hardcover.app";
const clientId = () => process.env.HARDCOVER_CLIENT_ID ?? "";
const clientSecret = () => process.env.HARDCOVER_CLIENT_SECRET ?? "";

/** Read the library, add and update books in it, and search the catalogue to find our books there. */
export const HARDCOVER_SCOPES = "read:me:content read:library write:library read:catalog:search";

export const hardcoverConfigured = () => !!clientId() && !!clientSecret() && connectionsConfigured();

const USER_AGENT = "OpenBanglaBooks (+https://openbanglabooks.com)";

export type HardcoverSecret = { access: string; refresh: string; expiresAt: number; userId: number; username: string };
type Tokens = { access: string; refresh: string; expiresAt: number };

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export async function challengeFor(verifier: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}

export function authorizeUrl(p: { state: string; challenge: string; redirectUri: string }): string {
  const url = new URL(authorizeEndpoint());
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId(),
    redirect_uri: p.redirectUri,
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    scope: HARDCOVER_SCOPES,
  }).toString();
  return url.toString();
}

async function tokenRequest(form: Record<string, string>): Promise<Tokens> {
  const res = await fetch(`${api()}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId())}:${encodeURIComponent(clientSecret())}`).toString("base64")}`,
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams(form),
    cache: "no-store",
  }).catch(() => null);
  if (!res) throw new ConnectionError("upstream");
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !body.access_token || !body.refresh_token) {
    // a spent, replayed or revoked refresh token: only a new sign-in helps
    if (body.error === "invalid_grant") throw new ConnectionError("reconnect", undefined, body.error_description);
    throw new ConnectionError(res.status === 429 ? "rateLimited" : "upstream", undefined, `${body.error ?? res.status}: ${body.error_description ?? ""}`);
  }
  return { access: body.access_token, refresh: body.refresh_token, expiresAt: Date.now() + (body.expires_in ?? 604800) * 1000 };
}

export const exchangeCode = (code: string, verifier: string, redirectUri: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier });

/** Revokes the pair (either token revokes both). Best effort: the reader is disconnected here either way. */
export async function revokeTokens(refresh: string) {
  await fetch(`${api()}/oauth2/revoke`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId())}:${encodeURIComponent(clientSecret())}`).toString("base64")}`,
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({ token: refresh, token_type_hint: "refresh_token" }),
    cache: "no-store",
  }).catch(() => null);
}

type GqlResponse<T> = { data?: T; errors?: { message: string; extensions?: { code?: string } }[]; error?: string; error_description?: string };

export async function gql<T>(token: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${api()}/v1/graphql`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, "User-Agent": USER_AGENT },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
  }).catch(() => null);
  if (!res) throw new ConnectionError("upstream");
  if (res.status === 401) throw new ConnectionError("reconnect");
  if (res.status === 429) {
    const s = Number(res.headers.get("Retry-After"));
    throw new ConnectionError("rateLimited", Number.isFinite(s) && s > 0 ? Math.min(s, 300) : 30);
  }
  const body = (await res.json().catch(() => ({}))) as GqlResponse<T>;
  // a scope the reader did not grant
  if (res.status === 403 && body.error === "insufficient_scope") throw new ConnectionError("reconnect", undefined, body.error_description);
  if (!res.ok || body.errors?.length || !body.data) throw new ConnectionError("upstream", undefined, body.errors?.map((e) => e.message).join("; ") ?? body.error ?? String(res.status));
  return body.data;
}

export async function whoAmI(token: string): Promise<{ id: number; username: string }> {
  const data = await gql<{ me: { id: number; username: string }[] }>(token, "query Me { me { id username } }");
  const me = data.me?.[0];
  if (!me) throw new ConnectionError("upstream", undefined, "no user");
  return me;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// refresh a little before the week is up, so a long import never meets an expired token
const REFRESH_MARGIN = 60 * 60 * 1000;

/** A working access token for the signed-in reader, refreshed (once, under the lease) when needed. */
export async function hardcoverSession(): Promise<{ token: string; userId: number }> {
  if (!hardcoverConfigured()) throw new ConnectionError("notConfigured");
  for (let attempt = 0; attempt < 8; attempt++) {
    const current = await loadConnection<HardcoverSecret>("hardcover");
    if (!current) throw new ConnectionError("notConnected");
    if (current.value.expiresAt - Date.now() > REFRESH_MARGIN) return { token: current.value.access, userId: current.value.userId };
    const lease = await leaseConnection<HardcoverSecret>("hardcover");
    if (!lease) {
      // another request is refreshing: wait for its new tokens
      await sleep(500 + attempt * 250);
      continue;
    }
    try {
      const fresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: lease.value.refresh });
      const next: HardcoverSecret = { ...lease.value, ...fresh };
      if (!(await rotateConnection("hardcover", lease.version, next, fresh.expiresAt))) throw new ConnectionError("busy");
      return { token: next.access, userId: next.userId };
    } catch (e) {
      if (e instanceof ConnectionError && e.code === "reconnect") await deleteConnection("hardcover");
      else await releaseConnection("hardcover");
      throw e;
    }
  }
  throw new ConnectionError("busy");
}

// ── reading and writing the library ────────────────────────────────────────

export type HardcoverEntry = {
  id: number;
  bookId: number;
  status: number;
  rating: number | null;
  dateAdded: string | null;
  lastRead: string | null;
  title: string;
  authors: string[];
};

type Contributor = { author?: { name?: string }; contribution?: string | null };

function authorsOf(cached: unknown): string[] {
  const list = Array.isArray(cached) ? (cached as Contributor[]) : [];
  const names = list.filter((c) => !c.contribution || c.contribution === "Author").map((c) => c.author?.name).filter((n): n is string => !!n);
  return [...new Set(names)];
}

const PAGE = 100;

/** One page of the reader's Hardcover library, oldest first. */
export async function libraryPage(offset: number): Promise<{ entries: HardcoverEntry[]; more: boolean; spent: number }> {
  const { token, userId } = await hardcoverSession();
  const data = await gql<{
    user_books: { id: number; book_id: number; status_id: number; rating: number | null; date_added: string | null; last_read_date: string | null; book: { title: string; cached_contributors: unknown } | null }[];
  }>(
    token,
    `query Library($userId: Int!, $limit: Int!, $offset: Int!) {
      user_books(where: {user_id: {_eq: $userId}}, order_by: {id: asc}, limit: $limit, offset: $offset) {
        id book_id status_id rating date_added last_read_date
        book { title cached_contributors }
      }
    }`,
    { userId, limit: PAGE, offset },
  );
  await markUsed("hardcover");
  const entries = data.user_books
    .filter((u) => u.book?.title)
    .map((u) => ({
      id: u.id,
      bookId: u.book_id,
      status: u.status_id,
      rating: u.rating === null ? null : Number(u.rating),
      dateAdded: u.date_added,
      lastRead: u.last_read_date,
      title: u.book!.title,
      authors: authorsOf(u.book!.cached_contributors),
    }));
  return { entries, more: data.user_books.length === PAGE, spent: 1 };
}

export type HardcoverBook = { id: number; title: string; authors: string[]; year: number | null };

// each top-level field takes a token from the bucket (see limits.ts): five fields per request
const BATCH = 5;

/** Searches Hardcover's catalogue, several titles per request; one token each. */
export async function searchBooks(queries: string[]): Promise<{ results: HardcoverBook[][]; spent: number }> {
  const { token } = await hardcoverSession();
  const out: HardcoverBook[][] = [];
  for (let i = 0; i < queries.length; i += BATCH) {
    const chunk = queries.slice(i, i + BATCH);
    const vars = Object.fromEntries(chunk.map((q, j) => [`q${j}`, q]));
    const query = `query Find(${chunk.map((_, j) => `$q${j}: String!`).join(", ")}) {
      ${chunk.map((_, j) => `s${j}: search(query: $q${j}, query_type: "book", per_page: 5, page: 1) { results }`).join("\n")}
    }`;
    const data = await gql<Record<string, { results: { hits?: { document?: Record<string, unknown> }[] } | null }>>(token, query, vars);
    for (let j = 0; j < chunk.length; j++) {
      const hits = data[`s${j}`]?.results?.hits ?? [];
      out.push(
        hits
          .map((h) => h.document ?? {})
          .map((d) => ({
            id: Number(d.id),
            title: String(d.title ?? ""),
            authors: Array.isArray(d.author_names) ? (d.author_names as unknown[]).map(String) : [],
            year: typeof d.release_year === "number" ? d.release_year : null,
          }))
          .filter((b) => Number.isInteger(b.id) && b.id > 0 && b.title),
      );
    }
  }
  await markUsed("hardcover");
  return { results: out, spent: queries.length };
}

/** Status ids on Hardcover. */
export const HC_STATUS = { want: 1, reading: 2, finished: 3, dnf: 5 } as const;

export type SendItem = { bookId: number; status: number; rating: number | null; finishedOn: string | null };
export type SendResult = { added: number; updated: number; unchanged: number; failed: number; spent: number };

/**
 * Puts books on the reader's Hardcover shelves. New ones are added quietly
 * (imported: no posts to followers' feeds); for books already there the
 * status follows ours, and a rating is only filled in where there is none.
 */
export async function sendBooks(items: SendItem[]): Promise<SendResult> {
  const { token, userId } = await hardcoverSession();
  const result: SendResult = { added: 0, updated: 0, unchanged: 0, failed: 0, spent: 0 };
  const ids = [...new Set(items.map((i) => i.bookId))];
  const existing = new Map<number, { id: number; status_id: number; rating: number | null }>();
  for (let i = 0; i < ids.length; i += 200) {
    const data = await gql<{ user_books: { id: number; book_id: number; status_id: number; rating: number | null }[] }>(
      token,
      `query Mine($userId: Int!, $ids: [Int!]!) { user_books(where: {user_id: {_eq: $userId}, book_id: {_in: $ids}}) { id book_id status_id rating } }`,
      { userId, ids: ids.slice(i, i + 200) },
    );
    result.spent++;
    for (const u of data.user_books) existing.set(u.book_id, u);
  }

  type Op = { kind: "insert" | "update"; id?: number; object: Record<string, unknown> };
  const ops: Op[] = [];
  for (const item of items) {
    const have = existing.get(item.bookId);
    const rating = item.rating && item.rating >= 1 && item.rating <= 5 ? item.rating : null;
    if (!have) {
      ops.push({
        kind: "insert",
        object: {
          book_id: item.bookId,
          status_id: item.status,
          ...(rating ? { rating } : {}),
          ...(item.status === HC_STATUS.finished && item.finishedOn ? { user_date: item.finishedOn } : {}),
          imported: true,
        },
      });
      continue;
    }
    const patch: Record<string, unknown> = {};
    if (have.status_id !== item.status) {
      patch.status_id = item.status;
      if (item.status === HC_STATUS.finished && item.finishedOn) patch.user_date = item.finishedOn;
    }
    if (rating && (have.rating === null || Number(have.rating) === 0)) patch.rating = rating;
    if (Object.keys(patch).length) ops.push({ kind: "update", id: have.id, object: patch });
    else result.unchanged++;
  }

  for (let i = 0; i < ops.length; i += BATCH) {
    const chunk = ops.slice(i, i + BATCH);
    const decl: string[] = [];
    const fields: string[] = [];
    const vars: Record<string, unknown> = {};
    chunk.forEach((op, j) => {
      vars[`o${j}`] = op.object;
      if (op.kind === "insert") {
        decl.push(`$o${j}: UserBookCreateInput!`);
        fields.push(`m${j}: insert_user_book(object: $o${j}) { id error }`);
      } else {
        decl.push(`$i${j}: Int!`, `$o${j}: UserBookUpdateInput!`);
        vars[`i${j}`] = op.id;
        fields.push(`m${j}: update_user_book(id: $i${j}, object: $o${j}) { id error }`);
      }
    });
    const data = await gql<Record<string, { id: number | null; error: string | null } | null>>(token, `mutation Send(${decl.join(", ")}) {\n${fields.join("\n")}\n}`, vars);
    result.spent += chunk.length;
    chunk.forEach((op, j) => {
      const r = data[`m${j}`];
      if (!r || r.error) result.failed++;
      else if (op.kind === "insert") result.added++;
      else result.updated++;
    });
  }
  await markUsed("hardcover");
  return result;
}
