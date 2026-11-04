# Deploying (self-hosted Docker)

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

## 4. Build and run

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

The build prerenders every book page, so the database must be reachable from
the build. Caddy obtains certificates automatically once DNS points at the
server (ports 80 and 443 open).

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
