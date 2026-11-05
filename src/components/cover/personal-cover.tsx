"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { localDB } from "@/lib/local/db";

const toDataUrl = (blob: Blob) =>
  new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(blob);
  });

/**
 * The cover image inside a reader's own EPUB, laid over the generated cloth
 * cover (which shows while it loads, and on devices without the file).
 * Covers are small (at most 480 px wide), so a data URL needs no cleanup.
 */
export function PersonalCoverImage({ id }: { id: string }) {
  const url = useLiveQuery(async () => {
    const cover = await localDB().personalCovers.get(id);
    return cover ? toDataUrl(new Blob([cover.data], { type: cover.type })) : null;
  }, [id]);
  if (!url) return null;
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- a local image, not an optimisable asset */}
      <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      {/* the same spine as the cloth covers, so all books stand alike on the shelf */}
      <div className="absolute inset-y-0 left-0 w-[7%] bg-[linear-gradient(90deg,rgb(0_0_0/0.28),rgb(0_0_0/0.08)_70%,rgb(255_255_255/0.10)_88%,rgb(0_0_0/0.08))]" />
    </>
  );
}
