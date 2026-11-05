/**
 * Stand-ins for Hardcover and Readwise, for the end-to-end tests only.
 * They follow the documented behaviour the app relies on (checked
 * 2026-11-05) closely enough to catch mistakes in it:
 *
 * Hardcover: an OAuth confidential client with PKCE (S256), the client
 * secret over HTTP Basic, the issuer in the redirect (RFC 9207), refresh
 * tokens that rotate on every use and revoke the whole chain when one is
 * replayed, and the GraphQL calls the app makes. Every Hardcover account
 * starts with the same four books.
 *
 * Readwise: token auth (GET /auth/ → 204) and highlight creation, where a
 * highlight sent again with the same highlight_url is updated, not doubled.
 * A token containing "slow" is asked to wait once (429, Retry-After: 1).
 *
 * Run with `node tests/e2e/mock-upstreams.ts` (Playwright starts it).
 * GET /__state/hardcover/<username> and /__state/readwise/<token> show
 * what arrived.
 */
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

const PORT = Number(process.env.MOCK_UPSTREAMS_PORT ?? 3199);
const ISSUER = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = "obb-e2e";
const CLIENT_SECRET = "obb-e2e-secret";
const SCOPES = ["read:me:content", "read:library", "write:library", "read:catalog:search"];
// shorter than the app's refresh margin (an hour), so every call refreshes and rotation is exercised throughout
const ACCESS_SECONDS = 1800;

// ── Hardcover's catalogue and the books every account starts with ─────────

type Book = { id: number; title: string; authors: string[]; year: number };
const CATALOGUE: Book[] = [
  { id: 2001, title: "Gora", authors: ["Rabindranath Tagore"], year: 1910 },
  { id: 2002, title: "Devdas", authors: ["Sarat Chandra Chattopadhyay"], year: 1917 },
  { id: 2003, title: "Devdas: A Novel", authors: ["Saratchandra Chattopadhyay"], year: 2002 },
  { id: 2004, title: "Anandamath", authors: ["Bankim Chandra Chatterjee"], year: 1882 },
  { id: 2005, title: "The Great Gatsby", authors: ["F. Scott Fitzgerald"], year: 1925 },
  { id: 2006, title: "Pride and Prejudice", authors: ["Jane Austen"], year: 1813 },
];
type UserBook = { id: number; book_id: number; status_id: number; rating: number | null; date_added: string; last_read_date: string | null; user_date?: string; imported?: boolean };
const SEED: Omit<UserBook, "id">[] = [
  { book_id: 2001, status_id: 1, rating: null, date_added: "2024-03-01", last_read_date: null },
  { book_id: 2006, status_id: 3, rating: 5, date_added: "2020-01-01", last_read_date: "2020-05-05" },
  { book_id: 2005, status_id: 6, rating: null, date_added: "2023-01-02", last_read_date: null },
  { book_id: 2004, status_id: 5, rating: 2, date_added: "2024-04-04", last_read_date: null },
];

type User = { id: number; username: string; library: UserBook[]; refreshes: number; revoked: boolean; bucket: { tokens: number; at: number }; throttled: number };

// Hardcover's rate limit: a bucket of 10 tokens refilled at 60 a minute; each top-level field costs one
const BUCKET = 10;
function take(user: User, cost: number): "ok" | "throttled" | "too-big" {
  if (cost > BUCKET) return "too-big";
  const now = Date.now();
  user.bucket.tokens = Math.min(BUCKET, user.bucket.tokens + (now - user.bucket.at) / 1000);
  user.bucket.at = now;
  if (user.bucket.tokens < cost) {
    user.throttled++;
    return "throttled";
  }
  user.bucket.tokens -= cost;
  return "ok";
}
const users = new Map<string, User>();
let nextUser = 100;
let nextUserBook = 9000;

type Code = { user: User; challenge: string; redirectUri: string; expires: number };
const codes = new Map<string, Code>();
type Chain = { user: User; revoked: boolean };
const accessTokens = new Map<string, { chain: Chain; expires: number }>();
const refreshTokens = new Map<string, { chain: Chain; used: boolean }>();

const token = () => randomBytes(24).toString("base64url");

function newUser(): User {
  const id = nextUser++;
  const user: User = {
    id,
    username: `reader${id}`,
    library: SEED.map((b) => ({ ...b, id: nextUserBook++ })),
    refreshes: 0,
    revoked: false,
    bucket: { tokens: BUCKET, at: Date.now() },
    throttled: 0,
  };
  users.set(user.username, user);
  return user;
}

function issue(chain: Chain) {
  const access = token();
  const refresh = token();
  accessTokens.set(access, { chain, expires: Date.now() + ACCESS_SECONDS * 1000 });
  refreshTokens.set(refresh, { chain, used: false });
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_SECONDS, refresh_token: refresh, scope: SCOPES.join(" ") };
}

// ── Readwise ───────────────────────────────────────────────────────────────

type Highlight = Record<string, unknown> & { highlight_url: string };
const readwise = new Map<string, { highlights: Map<string, Highlight>; posts: number; waited: boolean }>();
const readwiseToken = (req: IncomingMessage) => req.headers.authorization?.match(/^Token (rwtest[A-Za-z0-9]{20,})$/)?.[1] ?? null;

// ── plumbing ───────────────────────────────────────────────────────────────

function send(res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) {
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "Content-Type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json", ...headers });
  res.end(text);
}

async function bodyOf(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const basicOk = (req: IncomingMessage) => {
  const m = req.headers.authorization?.match(/^Basic (.+)$/);
  if (!m) return false;
  const [id, secret] = Buffer.from(m[1], "base64").toString("utf8").split(":").map(decodeURIComponent);
  return id === CLIENT_ID && secret === CLIENT_SECRET;
};

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

// ── GraphQL, just the operations the app sends ─────────────────────────────

function graphql(user: User, query: string, vars: Record<string, unknown>): { data?: unknown; errors?: { message: string }[] } {
  const op = query.match(/^\s*(query|mutation)\s+(\w+)/)?.[2];
  const book = (id: number) => CATALOGUE.find((b) => b.id === id)!;
  switch (op) {
    case "Me":
      return { data: { me: [{ id: user.id, username: user.username }] } };
    case "Library": {
      if (vars.userId !== user.id) return { data: { user_books: [] } };
      const page = user.library.slice(Number(vars.offset), Number(vars.offset) + Number(vars.limit));
      return {
        data: {
          user_books: page.map((u) => ({
            ...u,
            book: { title: book(u.book_id).title, cached_contributors: book(u.book_id).authors.map((name) => ({ author: { name }, contribution: null })) },
          })),
        },
      };
    }
    case "Mine": {
      const ids = vars.ids as number[];
      return { data: { user_books: user.library.filter((u) => ids.includes(u.book_id)).map(({ id, book_id, status_id, rating }) => ({ id, book_id, status_id, rating })) } };
    }
    case "Find": {
      const data: Record<string, unknown> = {};
      for (const m of query.matchAll(/(s\d+): search\(query: \$(q\d+), query_type: "book", per_page: (\d+), page: 1\)/g)) {
        const words = String(vars[m[2]]).toLowerCase().split(/\W+/).filter((w) => w.length >= 3);
        const scored = CATALOGUE.map((b) => {
          const hay = `${b.title} ${b.authors.join(" ")}`.toLowerCase().split(/\W+/);
          return { b, score: words.filter((w) => hay.includes(w)).length };
        })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, Number(m[3]));
        data[m[1]] = { results: { found: scored.length, hits: scored.map(({ b }) => ({ document: { id: String(b.id), title: b.title, author_names: b.authors, release_year: b.year } })) } };
      }
      return { data };
    }
    case "Send": {
      const data: Record<string, unknown> = {};
      for (const m of query.matchAll(/(m\d+): (insert_user_book|update_user_book)\((?:id: \$(i\d+), )?object: \$(o\d+)\)/g)) {
        const object = vars[m[4]] as Partial<UserBook>;
        if (m[2] === "insert_user_book") {
          if (!CATALOGUE.some((b) => b.id === object.book_id)) data[m[1]] = { id: null, error: "Book not found" };
          else if (user.library.some((u) => u.book_id === object.book_id)) data[m[1]] = { id: null, error: "Already in your library" };
          else {
            const u: UserBook = { id: nextUserBook++, book_id: object.book_id!, status_id: object.status_id ?? 1, rating: object.rating ?? null, date_added: new Date().toISOString().slice(0, 10), last_read_date: null, ...object };
            user.library.push(u);
            data[m[1]] = { id: u.id, error: null };
          }
        } else {
          const u = user.library.find((x) => x.id === vars[m[3]!]);
          if (!u) data[m[1]] = { id: null, error: "Not found" };
          else {
            Object.assign(u, object);
            data[m[1]] = { id: u.id, error: null };
          }
        }
      }
      return { data };
    }
    default:
      return { errors: [{ message: `mock: unknown operation ${op}` }] };
  }
}

// ── routes ─────────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", ISSUER);
  const path = url.pathname;
  try {
    if (path === "/__health") return send(res, 200, { ok: true });

    if (path.startsWith("/__state/hardcover/")) {
      const user = users.get(decodeURIComponent(path.split("/")[3]));
      return user ? send(res, 200, user) : send(res, 404, { error: "no such user" });
    }
    if (path.startsWith("/__state/readwise/")) {
      const r = readwise.get(decodeURIComponent(path.split("/")[3]));
      return send(res, 200, { posts: r?.posts ?? 0, highlights: r ? [...r.highlights.values()] : [] });
    }

    // the consent screen
    if (path === "/oauth2/authorize" && req.method === "GET") {
      const q = url.searchParams;
      const scopes = (q.get("scope") ?? "").split(" ");
      const problems = [
        q.get("response_type") !== "code" && "response_type",
        q.get("client_id") !== CLIENT_ID && "client_id",
        q.get("code_challenge_method") !== "S256" && "code_challenge_method",
        !/^[A-Za-z0-9_-]{43}$/.test(q.get("code_challenge") ?? "") && "code_challenge",
        !q.get("state") && "state",
        !/^http:\/\/localhost:\d+\/api\/connections\/hardcover\/callback$/.test(q.get("redirect_uri") ?? "") && "redirect_uri",
        SCOPES.some((s) => !scopes.includes(s)) && "scope",
      ].filter(Boolean);
      if (problems.length) return send(res, 400, `<p>Invalid request: ${escape(problems.join(", "))}</p>`);
      const decide = (allow: boolean) => `/oauth2/decide?${new URLSearchParams({ ...Object.fromEntries(q), allow: allow ? "1" : "0" })}`;
      return send(
        res,
        200,
        `<!doctype html><title>Authorize</title><h1>Allow OpenBanglaBooks to use your Hardcover account?</h1>
         <p>Scopes: ${escape(scopes.join(", "))}</p>
         <a href="${escape(decide(true))}">Allow</a> <a href="${escape(decide(false))}">Deny</a>`,
      );
    }
    if (path === "/oauth2/decide" && req.method === "GET") {
      const q = url.searchParams;
      const back = new URL(q.get("redirect_uri")!);
      back.searchParams.set("state", q.get("state")!);
      back.searchParams.set("iss", ISSUER);
      if (q.get("allow") !== "1") back.searchParams.set("error", "access_denied");
      else {
        const code = token();
        codes.set(code, { user: newUser(), challenge: q.get("code_challenge")!, redirectUri: q.get("redirect_uri")!, expires: Date.now() + 60_000 });
        back.searchParams.set("code", code);
      }
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }

    if (path === "/oauth2/token" && req.method === "POST") {
      if (!basicOk(req)) return send(res, 401, { error: "invalid_client" });
      const form = new URLSearchParams(await bodyOf(req));
      if (form.get("grant_type") === "authorization_code") {
        const c = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        if (!c || c.expires < Date.now() || c.redirectUri !== form.get("redirect_uri") || createHash("sha256").update(verifier).digest("base64url") !== c.challenge)
          return send(res, 400, { error: "invalid_grant", error_description: "code, redirect_uri or code_verifier does not match" });
        return send(res, 200, issue({ user: c.user, revoked: false }), { "Cache-Control": "no-store" });
      }
      if (form.get("grant_type") === "refresh_token") {
        const r = refreshTokens.get(form.get("refresh_token") ?? "");
        if (!r || r.chain.revoked) return send(res, 400, { error: "invalid_grant", error_description: "refresh token is invalid" });
        if (r.used) {
          // a replayed refresh token: the whole chain goes
          r.chain.revoked = true;
          r.chain.user.revoked = true;
          return send(res, 400, { error: "invalid_grant", error_description: "refresh token reused; chain revoked" });
        }
        r.used = true;
        r.chain.user.refreshes++;
        return send(res, 200, issue(r.chain), { "Cache-Control": "no-store" });
      }
      return send(res, 400, { error: "unsupported_grant_type" });
    }

    if (path === "/oauth2/revoke" && req.method === "POST") {
      if (!basicOk(req)) return send(res, 401, { error: "invalid_client" });
      const t = new URLSearchParams(await bodyOf(req)).get("token") ?? "";
      const chain = refreshTokens.get(t)?.chain ?? accessTokens.get(t)?.chain;
      if (chain) {
        chain.revoked = true;
        chain.user.revoked = true;
      }
      return send(res, 200, {});
    }

    if (path === "/v1/graphql" && req.method === "POST") {
      const a = accessTokens.get(req.headers.authorization?.replace(/^Bearer /, "") ?? "");
      if (!a || a.chain.revoked || a.expires < Date.now()) return send(res, 401, { error: "invalid_token" });
      const { query, variables } = JSON.parse(await bodyOf(req)) as { query: string; variables?: Record<string, unknown> };
      const fields = query.match(/^\s*(?:query|mutation)\s+\w+(?:\([^)]*\))?\s*\{([\s\S]*)\}\s*$/)?.[1].match(/^\s*\w+\s*:\s*\w+\(/gm)?.length ?? 1;
      const allowed = take(a.chain.user, fields);
      if (allowed === "too-big") return send(res, 403, { errors: ["request_exceeds_capacity"], message: `${fields} top-level fields; the limit is ${BUCKET}` });
      if (allowed === "throttled") return send(res, 429, { error: "Too Many Requests", message: "try again later" });
      return send(res, 200, graphql(a.chain.user, query, variables ?? {}));
    }

    if (path === "/readwise/api/v2/auth/" && req.method === "GET") {
      return readwiseToken(req) ? send(res, 204) : send(res, 401, { detail: "Invalid token." });
    }
    if (path === "/readwise/api/v2/highlights/" && req.method === "POST") {
      const t = readwiseToken(req);
      if (!t) return send(res, 401, { detail: "Invalid token." });
      let r = readwise.get(t);
      if (!r) readwise.set(t, (r = { highlights: new Map(), posts: 0, waited: false }));
      if (t.includes("slow") && !r.waited) {
        r.waited = true;
        return send(res, 429, { detail: "Request was throttled." }, { "Retry-After": "1" });
      }
      const { highlights } = JSON.parse(await bodyOf(req)) as { highlights: Highlight[] };
      const bad = highlights.find(
        (h) =>
          typeof h.text !== "string" ||
          !h.text ||
          (h.text as string).length > 8191 ||
          (h.title as string).length > 511 ||
          (h.author as string).length > 1024 ||
          (typeof h.note === "string" && h.note.length > 8191) ||
          h.category !== "books" ||
          h.location_type !== "order" ||
          !/^\S{3,64}$/.test(String(h.source_type)) ||
          !h.highlight_url,
      );
      if (bad) return send(res, 400, { detail: "invalid highlight", highlight: bad });
      r.posts++;
      for (const h of highlights) r.highlights.set(h.highlight_url, h);
      return send(res, 200, []);
    }

    send(res, 404, { error: `mock: nothing at ${req.method} ${path}` });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock upstreams on ${ISSUER}`));
