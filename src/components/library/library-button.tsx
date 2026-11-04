"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { BookmarkCheck, BookmarkPlus } from "lucide-react";
import { localDB, snapshotOf, type WorkSnapshot } from "@/lib/local/db";
import { cn } from "@/lib/utils";

/**
 * Adds a book to "Want to read" in the local library (this device). In Phase 2
 * the same entry syncs to the reader's account.
 */
export function LibraryButton({
  work,
  labels,
  tone = "paper",
  className,
}: {
  work: WorkSnapshot;
  labels: { add: string; added: string };
  tone?: "paper" | "cloth";
  className?: string;
}) {
  const entry = useLiveQuery(() => localDB().library.get(work.slug), [work.slug]);
  const saved = Boolean(entry);

  const toggle = async () => {
    const db = localDB();
    if (saved) await db.library.delete(work.slug);
    else {
      const now = Date.now();
      const position = await db.positions.get(work.slug);
      await db.library.put({
        workSlug: work.slug,
        status: position ? (position.finished ? "finished" : "reading") : "want",
        addedAt: now,
        updatedAt: now,
        work: snapshotOf(work),
      });
    }
  };

  const Icon = saved ? BookmarkCheck : BookmarkPlus;
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      className={cn(
        "inline-flex h-12 items-center justify-center gap-2 rounded-control border px-5 text-base transition-colors duration-200",
        tone === "cloth"
          ? "border-on-cloth/35 text-on-cloth hover:border-on-cloth/70 hover:bg-cloth-raised"
          : "border-line-strong text-fg hover:bg-sunken",
        className,
      )}
    >
      <Icon aria-hidden className={cn("size-5 transition-transform duration-300 ease-paper", saved && "scale-110")} />
      {saved ? labels.added : labels.add}
    </button>
  );
}
