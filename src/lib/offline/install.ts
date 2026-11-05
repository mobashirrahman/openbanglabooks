"use client";

import { useSyncExternalStore } from "react";

/**
 * Installing the app. Chromium browsers fire `beforeinstallprompt` once,
 * early in the page's life: it is caught here (the listener is attached by
 * the service worker agent, which every page mounts) and kept until the
 * reader asks to install from the profile page.
 */

type InstallPrompt = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallPrompt | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function listenForInstall() {
  if (typeof window === "undefined" || (window as { __obbInstall?: boolean }).__obbInstall) return;
  (window as { __obbInstall?: boolean }).__obbInstall = true;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // our own button, on the profile page, instead of the browser's banner
    deferred = e as InstallPrompt;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    installed = true;
    emit();
  });
}

export type InstallState = "installed" | "available" | "ios" | "unavailable";

function current(): InstallState {
  if (installed || matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone) return "installed";
  if (deferred) return "available";
  // Safari on iPhone and iPad installs from its Share menu only
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios ? "ios" : "unavailable";
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    current,
    () => "unavailable",
  );
}

export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  emit();
  return outcome === "accepted";
}
