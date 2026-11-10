import { bindings, defineConfig, defineWorker } from "cf/config";

export default defineConfig({
  worker: defineWorker({
    name: "openbanglabooks",
    entrypoint: "vinext/server/fetch-handler",
    compatibilityDate: "2026-11-09",
    compatibilityFlags: ["nodejs_compat"],
    domains: ["openbanglabooks.com"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      VINEXT_KV_CACHE: bindings.kv({ id: "6740eac8523c46ee85e7e043ac2451ff" }),
      BOOK_FILES: bindings.r2({ name: "openbanglabooks-files" }),
      NEXT_PUBLIC_SITE_URL: bindings.text("https://openbanglabooks.com"),
      NEXT_PUBLIC_SUPABASE_URL: bindings.text("https://mfelvlzokrzknfujiroq.supabase.co"),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: bindings.text("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1mZWx2bHpva3J6a25mdWppcm9xIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyMzM3MDksImV4cCI6MjEwOTgwOTcwOX0.mn4XV_3VPGbTEqhjjYAwM0XqQ70FFLzyYmPyu_Ym-AM"),
      REVALIDATE_SECRET: bindings.secret(),
      CONNECTIONS_KEY: bindings.secret(),
      // Fresh per deploy, so the service worker updates on every release.
      NEXT_DEPLOYMENT_ID: bindings.text(`${Date.now()}`),
    },
  }),
});
