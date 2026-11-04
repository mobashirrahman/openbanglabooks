# OpenBanglaBooks — production image (Next.js standalone output)
# Build:  docker build -t openbanglabooks --build-arg NEXT_PUBLIC_SITE_URL=https://openbanglabooks.com \
#           --build-arg NEXT_PUBLIC_SUPABASE_URL=… --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=… .
# Public (NEXT_PUBLIC_*) values are inlined at build time; secrets are passed at runtime only.

ARG NODE_VERSION=26-bookworm-slim

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
RUN npm install -g pnpm@12
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:${NODE_VERSION} AS build
WORKDIR /app
RUN npm install -g pnpm@12
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# the catalog is read at build time to prerender book pages: the database must be reachable
RUN pnpm build

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
