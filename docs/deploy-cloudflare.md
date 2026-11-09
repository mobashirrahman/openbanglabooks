# Deploying on Cloudflare Workers (vinext)

Production runs on Cloudflare Workers with [vinext](https://github.com/cloudflare/vinext)
and Supabase Cloud for the database, auth and EPUB storage. This is the
deployment used by `openbanglabooks.com`.

The `vinext` branch carries the Cloudflare setup. `main` still builds the
Next.js container described in [deploy.md](deploy.md).

## Prerequisites

- `cf` CLI authenticated: `npm install -g cf && cf auth login`
- Node 22+ and pnpm
- A Supabase project with the migrations applied

## 1. Supabase

Apply the migrations and seed data once, then load the catalog:

```bash
pnpm exec supabase link --project-ref <ref>
pnpm exec supabase db push
psql "$SUPABASE_DB_URL" -f supabase/seed.sql
```

The web server only needs `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY`; `SUPABASE_SERVICE_ROLE_KEY` is only for
ingestion and publishing (`pnpm ingest`, `pnpm pdf:publish`).

## 2. Environment

Create `.env.production.local` (gitignored):

```bash
NEXT_PUBLIC_SITE_URL=https://openbanglabooks.com
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service role key>   # only for ingest scripts
REVALIDATE_SECRET=<long random string>
CONNECTIONS_KEY=<openssl rand -base64 32>
```

`NEXT_PUBLIC_*` values are baked in at build time, so export this file before
building (it overrides `.env.local`):

```bash
set -a; . ./.env.production.local; set +a
```

## 3. Deploy

```bash
pnpm build:vinext
cf deploy --prebuilt --secrets-file ./secrets.env
```

`secrets.env` is a temporary file with only the secret values:

```bash
REVALIDATE_SECRET=...
CONNECTIONS_KEY=...
```

`pnpm deploy:vinext` builds and deploys, but a first deployment of a new Worker
must use `cf deploy --prebuilt --secrets-file` because secrets cannot be set
before the Worker exists. Delete `secrets.env` afterwards.

## 4. Cloudflare configuration

`cloudflare.config.ts` declares:

- the `openbanglabooks.com` custom domain
- a KV namespace (`VINEXT_KV_CACHE`) for the ISR/data cache
- public values as text bindings and the two secrets as secret bindings

The cache adapter is enabled in `vite.config.ts` with `kvDataAdapter()`.
Without it, `vinext-cloudflare deploy` refuses to deploy an app with ISR.

`www.openbanglabooks.com` is a proxied `AAAA 100::` record plus a Single
Redirect rule (`http_request_dynamic_redirect`) that 301s to the apex and keeps
path and query. "Always Use HTTPS" is on for the zone.

## 5. Verify

```bash
curl -I https://openbanglabooks.com/
curl -I http://www.openbanglabooks.com/en/books/srikanta-1?x=1   # 301 → https://openbanglabooks.com/...
curl -I https://openbanglabooks.com/api/books/<sha256>           # application/epub+zip
```

Open `/`, `/books/<slug>` and `/read/<slug>` in a browser and check the reader
console is clean.

## Notes

- **Package size:** the Worker is ~3.3 MiB raw / ~1 MiB gzipped, under the
  Workers Free limit.
- **PDF.js:** `@napi-rs/canvas` and `node-readable-to-web-readable-stream` are
  externalized in `vite.config.ts`; they are Node-only paths inside the vendored
  PDF.js bundle and are never reached in the browser or the Worker.
- **Service worker:** `/sw.js` uses `NEXT_DEPLOYMENT_ID`, injected by
  `cloudflare.config.ts` at deploy time, so every deployment installs a new
  service worker. Locally it falls back to `.next/BUILD_ID`.
- **Secrets in the build:** the service-role key, revalidate secret and
  connections key are never inlined into `.cloudflare/output`; only
  `NEXT_PUBLIC_*` values are.
