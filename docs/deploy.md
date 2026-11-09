# Deploying (self-hosted Docker)

> Production currently runs on Cloudflare Workers; see
> [deploy-cloudflare.md](deploy-cloudflare.md). This page documents the
> alternative self-hosted Docker deployment.

The app ships as a Next.js standalone server in a container, behind Caddy for
automatic HTTPS. The database, auth and file storage are Supabase (either
Supabase Cloud or your own self-hosted Supabase).

`openbanglabooks.com` is the intended production address; set your real domain
in the environment.

## 1. Supabase

Supabase Cloud is the simplest: create a project, then from this repo:

```bash
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push            # applies supabase/migrations
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

Self-hosted Supabase works the same way with its URL and keys.

## 2. Content

Run the ingestion against the production database once (from any machine
with the repo and the service-role key):

```bash
NEXT_PUBLIC_SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm ingest
```

## 3. Environment

Create `.env.production` (never commit it):

```
SITE_DOMAIN=openbanglabooks.com
NEXT_PUBLIC_SITE_URL=https://openbanglabooks.com
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
REVALIDATE_SECRET=<long random string>
```

`NEXT_PUBLIC_*` values are baked in at build time. The service-role key is
**not** needed by the web server.

### Connections (Hardcover, Readwise; optional)

Without these, the profile shows both as "not available".

```
CONNECTIONS_KEY=<openssl rand -base64 32>
HARDCOVER_CLIENT_ID=<from Hardcover>
HARDCOVER_CLIENT_SECRET=<from Hardcover>
```

- **`CONNECTIONS_KEY`** seals readers' tokens before they are stored (decision
  18). Keep it with your other secrets and back it up: if it is lost or
  changed, every reader has to connect again. Readwise needs nothing else.
- **Hardcover:** register an OAuth application with Hardcover as a
  confidential (server) client, with the redirect URI
  `https://<domain>/api/connections/hardcover/callback` and the scopes
  `read:me:content read:library write:library read:catalog:search`. Set
  `HARDCOVER_REDIRECT_URI` only if the site is reached at a different origin
  than the one it sees (the redirect URI must match the registered one
  exactly).
- Both services are called from the server: allow outbound HTTPS to
  `api.hardcover.app` and `readwise.io` if egress is restricted.

### Accounts (Supabase Auth)

In the Supabase dashboard (or `supabase/config.toml` for self-hosting):

- **Site URL:** `https://<domain>`; **redirect URLs:** `https://<domain>/**`
  (the sign-in link returns to `/signin/confirm` and `/en/signin/confirm`).
- **Email template:** use `supabase/templates/sign-in.html` for both "Magic
  link" and "Confirm signup", with the subject
  `সাইন ইন কোড {{ .Token }} · OpenBanglaBooks`. The template shows the
  six-digit code and links to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`.
- **OTP length 6, expiry 1 hour.**
- **SMTP:** Supabase's built-in mail sender is rate-limited to a few emails
  an hour; configure your own SMTP (any transactional provider) before
  launch, with SPF/DKIM for the sending domain.
- **Rate limits:** the local config raises them for tests. In production keep
  the defaults or lower (e.g. 30 sign-in emails per hour per IP) and turn on
  CAPTCHA if abuse appears.
- **Google sign-in (optional, not enabled yet):** create an OAuth client in
  Google Cloud (authorised redirect `https://<ref>.supabase.co/auth/v1/callback`),
  enable the Google provider with its ID and secret in Supabase, then add a
  "Continue with Google" button that calls `signInWithOAuth({ provider:
  "google", options: { redirectTo: origin + "/signin/confirm" } })` and
  exchange the code on that page. Nothing else changes: sync and the admin
  only see a user id.

### Editors

The admin (`/admin`) is for profiles with role `editor` or `admin`. After
the person has signed in once:

```sql
update public.profiles set role = 'editor'
where id = (select id from auth.users where email = 'editor@example.org');
```

## 4. Build and run

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The build prerenders every book page, so the database must be reachable from
the build. Caddy obtains certificates automatically once DNS points at the
server (ports 80 and 443 open).

The site must be served over HTTPS (or `localhost`): the service worker,
installing the app and importing a reader's own EPUB (which hashes the file
with WebCrypto) work only in a secure context. Do not cache `/sw.js` or
`/sw-core.js` at a proxy or CDN; both are sent with `no-cache` so a new
build reaches readers on their next visit.

## 5. After deploying

- Regenerate social images against the live site: `pnpm render:og --base https://openbanglabooks.com`, commit, redeploy.
- Add the site to Google Search Console and submit `https://<domain>/sitemap.xml`.
- After ingesting new books: `curl -X POST -H "Authorization: Bearer $REVALIDATE_SECRET" https://<domain>/api/revalidate`.

## Notes

- **Caching:** catalog pages are static and revalidated by tag; the
  `next-cache` volume keeps the incremental cache across restarts. For more
  than one app instance, configure a shared `cacheHandler`.
- **HTTPS is required:** WebCrypto (EPUB font de-obfuscation, file checksums) and the future service worker need a secure context.
- **CSP:** set by `src/proxy.ts`; the reader's per-request nonce makes `/read/*` dynamic by design.
- **Memory:** the container idles around 150–250 MB.
- **Uploads:** EPUBs up to 50 MB go to `/api/admin/epub`. If a reverse
  proxy sits in front of Caddy, allow that body size there too, and forward
  the public host (`X-Forwarded-Host`): the upload and server actions both
  check that requests come from the site's own origin.
- **Several app instances:** set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` to the
  same value on all of them.
