"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { THEME_STORAGE_KEY } from "@/components/theme/theme-script";
import { localDB, markHasProgress } from "@/lib/local/db";
import { READER_SETTINGS_KEY } from "@/lib/reader/settings";
import { cn } from "@/lib/utils";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";

type Theme = "system" | "light" | "dark";

function applyTheme(pref: Theme) {
  const dark = pref === "dark" || (pref === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function ThemePreference({ labels }: { labels: Dictionary["profile"] }) {
  const [pref, setPref] = useState<Theme>("system");
  useEffect(() => {
    try {
      setPref((localStorage.getItem(THEME_STORAGE_KEY) as Theme) ?? "system");
    } catch {}
  }, []);
  const choose = (p: Theme) => {
    setPref(p);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, p);
    } catch {}
    applyTheme(p);
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
    await localDB().settings.delete(READER_SETTINGS_KEY);
    try {
      localStorage.removeItem(READER_SETTINGS_KEY);
    } catch {}
    setMessage(labels.resetDone);
  };

  const clearAll = async () => {
    if (!window.confirm(labels.clearConfirm)) return;
    const db = localDB();
    await Promise.all([db.positions.clear(), db.library.clear(), db.bookmarks.clear(), db.files.clear(), db.settings.clear()]);
    try {
      localStorage.removeItem(READER_SETTINGS_KEY);
    } catch {}
    markHasProgress(false);
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
