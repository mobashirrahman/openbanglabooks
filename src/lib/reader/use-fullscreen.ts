"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Full screen for the reader, where the browser allows it.
 *
 * Safari on iPad supports the Element Fullscreen API (16.4+); Safari on iPhone
 * does not, and neither do browsers based on it. An installed web app is
 * already full screen, so the control is hidden there. Everything is feature
 * detected: no control is offered where it would do nothing.
 */

type FsDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type FsElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

const activeElement = (): Element | null =>
  typeof document === "undefined" ? null : (document.fullscreenElement ?? (document as FsDocument).webkitFullscreenElement ?? null);

function installedApp() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Whether this browser can put the page itself full screen. */
export function fullscreenSupported() {
  if (typeof document === "undefined" || installedApp()) return false;
  const d = document as FsDocument;
  const el = document.documentElement as FsElement;
  return Boolean(
    (document.fullscreenEnabled || d.webkitFullscreenEnabled) &&
      (el.requestFullscreen || el.webkitRequestFullscreen),
  );
}

const subscribe = (onChange: () => void) => {
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    document.removeEventListener("webkitfullscreenchange", onChange);
  };
};

/** "supported,active" as a stable string snapshot (useSyncExternalStore compares by value). */
const snapshot = () => `${fullscreenSupported() ? 1 : 0}${activeElement() ? 1 : 0}`;
const serverSnapshot = () => "00";

export function useFullscreen() {
  const state = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const supported = state[0] === "1";
  const active = state[1] === "1";

  const toggle = useCallback(async () => {
    try {
      if (activeElement()) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await (document as FsDocument).webkitExitFullscreen?.();
        return;
      }
      const el = document.documentElement as FsElement;
      // no options: some Safari versions accept the API but reject option objects
      if (el.requestFullscreen) await el.requestFullscreen();
      else await el.webkitRequestFullscreen?.();
    } catch {
      /* refused (not a user gesture, or a policy): reading carries on unchanged */
    }
  }, []);

  return { supported, active, toggle };
}
