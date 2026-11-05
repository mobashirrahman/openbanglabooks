"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import type { Locale } from "@/lib/i18n/config";
import { keepAssets, keepOffline, shellPages, swSupported } from "@/lib/offline/pages";
import { listenForInstall } from "@/lib/offline/install";

const idle = (cb: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(cb, { timeout: 4000 }) : setTimeout(cb, 1500));

const STATIC_PATH = /^\/(_next\/static|fonts)\//;
/**
 * Names every build script and font this page loads to the worker. On the
 * first visit the page is not yet under the worker's control, so the scripts
 * loaded so far (and those loaded on demand, such as the book engine) would
 * otherwise never be kept, and the page could not run offline.
 */
function watchLoadedAssets() {
  if (typeof PerformanceObserver === "undefined") return;
  let batch = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      const url = new URL(e.name, location.href);
      if (url.origin === location.origin && STATIC_PATH.test(url.pathname) && !url.search) batch.add(url.pathname);
    }
    if (!batch.size) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const paths = [...batch];
      batch = new Set();
      void keepAssets(paths); // only a message: the worker does the fetching
    }, 400);
  });
  try {
    observer.observe({ type: "resource", buffered: true });
  } catch {
    /* older engines: pages loaded under the worker are kept anyway */
  }
}

/**
 * Registers the service worker (production builds only: in development it
 * would serve stale pages) and asks it to keep the app shell, and each page
 * the reader visits, so they open again without a network. Pages reached by
 * in-app navigation never pass the worker as page loads, so they are named
 * to it here.
 */
export function ServiceWorker({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const ready = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    listenForInstall();
    if (process.env.NODE_ENV !== "production" || !swSupported()) return;
    ready.current ??= navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then(() => navigator.serviceWorker.ready)
      .then(() => {
        // after the page has settled: warming must never compete with what the reader is doing
        idle(() => void keepOffline(shellPages(locale), true));
        watchLoadedAssets();
        return true;
      })
      .catch(() => false); // private mode or blocked: everything still works online
  }, [locale]);

  useEffect(() => {
    // the visible path (the proxy serves Bengali pages without their /bn prefix)
    const here = location.pathname;
    void ready.current?.then((ok) => ok && idle(() => void keepOffline([here])));
  }, [pathname]);

  return null;
}
