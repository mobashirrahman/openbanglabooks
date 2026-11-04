"use client";

import { useEffect } from "react";
import { recordOpenOrigin } from "@/lib/reader/open-origin";

/**
 * Remembers which cover was tapped when a reader link is followed, so the
 * reader can fly that cover into place and open it. One delegated listener.
 */
export function OpenTracker() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const m = a?.pathname.match(/\/read\/([a-z0-9-]+)/);
      if (!a || !m) return;
      const slug = m[1];
      const scope = a.closest("[data-book-scope]") ?? document;
      const cover = a.querySelector(`[data-cover="${slug}"]`) ?? scope.querySelector(`[data-cover="${slug}"]`);
      if (cover) recordOpenOrigin(slug, cover);
    };
    document.addEventListener("click", onClick, { capture: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }, []);
  return null;
}
