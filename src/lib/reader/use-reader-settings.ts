"use client";

import { useCallback, useState } from "react";
import { localDB } from "@/lib/local/db";
import { DEFAULT_SETTINGS, READER_SETTINGS_KEY, normalizeSettings, type ReaderSettings } from "./settings";

function readMirror(): ReaderSettings {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(READER_SETTINGS_KEY) ?? "{}"));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Reader settings, read synchronously from a localStorage mirror (so the first
 * render already has the right theme and size), persisted to IndexedDB as the
 * record that Phase 2 syncs.
 */
export function useReaderSettings() {
  const [settings, setSettings] = useState<ReaderSettings>(() =>
    typeof window === "undefined" ? DEFAULT_SETTINGS : readMirror(),
  );

  const update = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = normalizeSettings({ ...prev, ...patch });
      try {
        localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(next));
      } catch {
        /* private mode */
      }
      localDB()
        .settings.put({ key: READER_SETTINGS_KEY, value: next, updatedAt: Date.now() })
        .catch(() => {});
      return next;
    });
  }, []);

  return [settings, update] as const;
}
