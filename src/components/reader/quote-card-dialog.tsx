"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { Download, Share, X } from "lucide-react";
import { cardToBlob, renderQuoteCard, type CardStyle } from "@/lib/reader/quote-card";
import { clothOf } from "@/components/cover/cloths";
import { cn } from "@/lib/utils";

type Labels = {
  quoteCard: string;
  cardStyle: string;
  cardCloth: string;
  cardPaper: string;
  cardNight: string;
  saveImage: string;
  share: string;
  closeMenu: string;
};

export type QuoteTarget = { quote: string; title: string; author: string; variant: number; slug: string };

/**
 * A passage as an image to save or share. Drawn on the device; the system
 * share sheet is offered where the browser can share files (phones, mostly),
 * saving the PNG works everywhere.
 */
export function QuoteCardDialog({ target, labels, onClose }: { target: QuoteTarget | null; labels: Labels; onClose: () => void }) {
  return (
    <Dialog.Root open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[94dvh] flex-col rounded-t-[20px] bg-[var(--paper,var(--surface))] text-[var(--ink,var(--fg))] shadow-sheet pb-safe outline-none",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom-8 data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 duration-300",
            "sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[30rem] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-[20px]",
          )}
        >
          {target ? <CardBody key={target.quote} target={target} labels={labels} /> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function CardBody({ target, labels }: { target: QuoteTarget; labels: Labels }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [style, setStyle] = useState<CardStyle>("cloth");
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    let live = true;
    const el = canvas.current;
    if (!el) return;
    void (async () => {
      await renderQuoteCard(el, { ...target, style });
      const blob = await cardToBlob(el);
      if (live) setFile(new File([blob], `${target.slug}-quote.png`, { type: "image/png" }));
    })();
    return () => {
      live = false;
    };
  }, [target, style]);

  const canShare = Boolean(file && typeof navigator !== "undefined" && navigator.canShare?.({ files: [file] }));
  const save = () => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: target.title, text: `${target.title} — ${target.author}` });
    } catch {
      /* dismissed */
    }
  };
  const swatches: { value: CardStyle; label: string; color: string }[] = [
    { value: "cloth", label: labels.cardCloth, color: clothOf(target.variant).cloth },
    { value: "paper", label: labels.cardPaper, color: "#F5EFE4" },
    { value: "night", label: labels.cardNight, color: "#202423" },
  ];

  return (
    <>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <Dialog.Title className="font-display text-xl">{labels.quoteCard}</Dialog.Title>
        <Dialog.Close className="inline-flex size-10 items-center justify-center rounded-full hover:bg-[color-mix(in_oklab,currentColor_8%,transparent)]">
          <X aria-hidden className="size-5" />
          <span className="sr-only">{labels.closeMenu}</span>
        </Dialog.Close>
      </div>
      <Dialog.Description className="sr-only">{target.quote}</Dialog.Description>
      <div className="min-h-0 flex-1 overflow-y-auto px-5">
        <canvas
          ref={canvas}
          role="img"
          aria-label={`${labels.quoteCard}: ${target.title}`}
          data-ready={file ? "true" : undefined}
          className="mx-auto block aspect-[4/5] max-h-[56dvh] w-auto max-w-full rounded-[6px] shadow-book"
        />
      </div>
      <div className="px-5 pt-4">
        <div role="radiogroup" aria-label={labels.cardStyle} className="flex justify-center gap-2">
          {swatches.map((s) => (
            <button
              key={s.value}
              type="button"
              role="radio"
              aria-checked={style === s.value}
              onClick={() => setStyle(s.value)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm transition-colors",
                style === s.value ? "border-[var(--ink,var(--fg))]" : "border-[color-mix(in_oklab,currentColor_20%,transparent)] opacity-80",
              )}
            >
              <span aria-hidden className="size-4 rounded-full border border-black/10" style={{ background: s.color }} />
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex justify-end gap-3 px-5 pt-4 pb-5">
        <button
          type="button"
          disabled={!file}
          onClick={save}
          className="inline-flex h-11 items-center gap-2 rounded-[10px] border border-[color-mix(in_oklab,currentColor_25%,transparent)] px-4 disabled:opacity-50"
        >
          <Download aria-hidden className="size-4" />
          {labels.saveImage}
        </button>
        {canShare ? (
          <button
            type="button"
            onClick={share}
            className="inline-flex h-11 items-center gap-2 rounded-[10px] bg-[var(--ink,var(--fg))] px-5 text-[var(--paper,var(--surface))]"
          >
            <Share aria-hidden className="size-4" />
            {labels.share}
          </button>
        ) : null}
      </div>
    </>
  );
}
