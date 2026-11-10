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

Readers create an account with a name, email and password, or continue with
Google or Facebook. Sign-in uses the email and password; a forgotten password
is reset through an emailed link.

In the Supabase dashboard (or `supabase/config.toml` for self-hosting):

- **Site URL:** `https://<domain>`; **redirect URLs:** `https://<domain>/**`
  (confirmation and reset links return to `/signin/confirm` and
  `/signin/reset`, also under `/en/…`).
- **Email templates:** use `supabase/templates/confirm-signup.html` for
  "Confirm signup" and `supabase/templates/recovery.html` for "Reset
  password"; the subjects are in `supabase/config.toml`.
- **Email confirmation:** on (recommended) means a new reader must open the
  link before signing in; off signs them in immediately. The app handles
  both.
- **Passwords:** Supabase's minimum is 6; the forms ask for 8. Turn on
  leaked-password protection in the dashboard if your plan offers it.
- **SMTP:** Supabase's built-in mail sender is rate-limited to a few emails
  an hour; configure your own SMTP (any transactional provider) before
  launch, with SPF/DKIM for the sending domain.
- **Rate limits:** the local config raises them for tests. In production keep
  the defaults or lower (e.g. 30 account emails per hour per IP) and turn on
  CAPTCHA if abuse appears.
- **Google:** create an OAuth client in Google Cloud (authorised redirect
  `https://<ref>.supabase.co/auth/v1/callback`), put its id and secret in
  Supabase and enable the provider. Local sign-in needs
  `skip_nonce_check = true`, already set in `supabase/config.toml`. The app
  shows "Continue with Google"; if the provider is not enabled the button
  reports that instead of leaving the site.
- **Facebook:** create a Meta app with Facebook Login, add the same callback
  URL, put its id and secret in Supabase and enable the provider. In the app's
  **Basic Settings**, set **Privacy Policy URL** to
  `https://<domain>/en/privacy`, set **Data Deletion Instructions URL** to
  `https://<domain>/en/data-deletion`, and switch the app to **Live** before
  readers outside the app's tester list can use it. The public bilingual pages
  live at `/privacy`, `/en/privacy`, `/data-deletion` and `/en/data-deletion`.
- **Hosted email templates:** after changing `supabase/templates/*.html`,
  either paste them into Authentication → Email Templates or run
  `pnpm exec tsx scripts/update-hosted-email-templates.ts` with a Supabase
  access token. The script changes only the confirmation and recovery
  templates.
- **Local providers:** put the four `SUPABASE_AUTH_EXTERNAL_*` variables in a
  gitignored `.env.supabase.local`, then run
  `set -a; . ./.env.supabase.local; set +a; pnpm db:start`. The values are
  read by `supabase start`, not by the web app.

Nothing else changes: sync and the admin only see a user id.

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
