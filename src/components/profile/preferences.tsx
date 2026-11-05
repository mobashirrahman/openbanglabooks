"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY } from "@/components/theme/theme-script";
import { localDB } from "@/lib/local/db";
import { wipeDevice } from "@/lib/local/wipe";
import { accountState } from "@/lib/account/session";
import { requestSyncNow } from "@/lib/sync/status";
import { DEFAULT_SETTINGS, READER_SETTINGS_KEY } from "@/lib/reader/settings";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

type Theme = "system" | "light" | "dark";

function applyTheme(pref: Theme) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

// the stored preference is an external store: other tabs change it too
const THEME_EVENT = "obb:theme-change";
function readThemePref(): Theme {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}
function subscribeThemePref(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(THEME_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(THEME_EVENT, onChange);
  };
}

export function ThemePreference({ labels }: { labels: Dictionary["profile"] }) {
  const pref = useSyncExternalStore(subscribeThemePref, readThemePref, () => "system" as Theme);
  const choose = (p: Theme) => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {}
    applyTheme(p);
    window.dispatchEvent(new Event(THEME_EVENT));
  };
  const options: { value: Theme; label: string; Icon: typeof Sun }[] = [
    { value: "system", label: labels.themeSystem, Icon: Monitor },
    { value: "light", label: labels.themeLight, Icon: Sun },
    { value: "dark", label: labels.themeDark, Icon: Moon },
  ];
  return (
    <div role="radiogroup" aria-label={labels.theme} className="inline-flex rounded-control border border-line-strong p-1">
      {options.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          onClick={() => choose(value)}
          className={cn(
            "inline-flex h-10 items-center gap-2 rounded-[7px] px-3.5 text-sm transition-colors duration-200",
            pref === value ? "bg-cloth text-on-cloth" : "text-fg-muted hover:text-fg",
          )}
        >
          <Icon aria-hidden className="size-4" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function DeviceData({ labels }: { labels: Dictionary["profile"] }) {
  const [usage, setUsage] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => {
      if (e.usage != null) setUsage(`${(e.usage / 1024 / 1024).toFixed(1)} MB`);
    });
  }, [message]);

  const resetReading = async () => {
    // written, not deleted: the reset reaches the reader's other devices too
    await localDB().settings.put({ key: READER_SETTINGS_KEY, value: DEFAULT_SETTINGS, updatedAt: Date.now() });
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
    } catch {}
    setMessage(labels.resetDone);
  };

  const clearAll = async () => {
    const signedIn = accountState().status === "signed-in";
    if (!window.confirm(signedIn ? labels.clearConfirmSignedIn : labels.clearConfirm)) return;
    // local only: the account (if any) keeps its data and sends it back
    await wipeDevice();
    if (signedIn) requestSyncNow();
    setMessage(labels.cleared);
  };

  return (
    <div className="space-y-4">
      <p className="text-fg-muted">{labels.dataNote}</p>
      {usage ? <p className="text-sm text-fg-subtle">{labels.storageUsed.replace("{size}", usage)}</p> : null}
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={resetReading} className="h-11 rounded-control border border-line-strong px-4 text-sm hover:bg-sunken">
          {labels.resetReading}
        </button>
        <button
          type="button"
          onClick={clearAll}
          className="h-11 rounded-control border border-destructive/40 px-4 text-sm text-destructive hover:bg-destructive/10"
        >
          {labels.clearData}
        </button>
      </div>
      <p role="status" className="min-h-6 text-sm text-fg-muted">
        {message}
      </p>
    </div>
  );
}
