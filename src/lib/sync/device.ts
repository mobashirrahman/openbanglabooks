"use client";

import { localDB } from "@/lib/local/db";

export type Device = { id: string; label: string };

let cached: Device | null = null;

/** A short human name for this browser ("Chrome · Android"), shown on other devices. */
export function deviceLabel(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && /Mobile/.test(ua))
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\/|FxiOS/.test(ua)
      ? "Firefox"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /CriOS|Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "";
  return [browser, os].filter(Boolean).join(" · ") || "Browser";
}

/** This device's stable id (kept across sign-outs, so its own rows come back to it). */
export async function thisDevice(): Promise<Device> {
  if (cached) return cached;
  const db = localDB();
  let id = (await db.meta.get("device-id"))?.value as string | undefined;
  if (!id) {
    id = globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    await db.meta.put({ key: "device-id", value: id });
  }
  cached = { id, label: deviceLabel() };
  return cached;
}
