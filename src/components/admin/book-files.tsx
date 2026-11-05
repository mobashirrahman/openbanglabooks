"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { catalogChanged, makeFileCurrent } from "@/lib/admin/actions";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import { FormStatus, useAdminForm, type AdminLabels } from "./form-kit";

export type BookFileRecord = {
  id: string;
  sha256: string;
  bytes: number;
  epub_version: string | null;
  is_current: boolean;
  created_at: string;
  validation_report: { warnings?: string[] } | null;
};

type Upload = { kind: "idle" } | { kind: "busy" } | { kind: "done"; chapters: number; warnings: string[] } | { kind: "error"; code: string; details?: string[] };

/** The edition's EPUB files: upload a new one (validated on the server), or go back to an earlier one. */
export function BookFiles({ editionId, files, locale, labels }: { editionId: string; files: BookFileRecord[]; locale: Locale; labels: AdminLabels }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [upload, setUpload] = useState<Upload>({ kind: "idle" });
  const [, startTransition] = useTransition();
  const date = new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", { dateStyle: "medium", timeStyle: "short" });
  const size = (b: number) => `${formatNumber(Math.round(b / 1024), locale)} KB`;

  async function send(file: File) {
    setUpload({ kind: "busy" });
    try {
      const res = await fetch(`/api/admin/epub?edition=${editionId}`, {
        method: "POST",
        headers: { "content-type": "application/epub+zip" },
        body: file,
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; details?: string[]; chapters?: number; warnings?: string[] };
      if (!res.ok) return setUpload({ kind: "error", code: body.error ?? "failed", details: body.details });
      setUpload({ kind: "done", chapters: body.chapters ?? 0, warnings: body.warnings ?? [] });
      if (input.current) input.current.value = "";
      startTransition(async () => {
        await catalogChanged();
        router.refresh();
      });
    } catch {
      setUpload({ kind: "error", code: "failed" });
    }
  }

  const errorText = (code: string) => labels.uploadErrors[code as keyof AdminLabels["uploadErrors"]] ?? labels.uploadErrors.failed;

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const file = input.current?.files?.[0];
          if (file) void send(file);
        }}
        className="space-y-3 rounded-[14px] border border-dashed border-line-strong p-5"
      >
        <label htmlFor="epub-file" className="block text-sm font-medium">
          {labels.chooseFile}
        </label>
        <input
          id="epub-file"
          ref={input}
          type="file"
          accept=".epub,application/epub+zip"
          aria-describedby="epub-hint"
          className="block w-full text-sm file:mr-4 file:h-10 file:rounded-control file:border-0 file:bg-sunken file:px-4 file:text-fg"
        />
        <p id="epub-hint" className="text-xs text-fg-subtle">
          {labels.fileHint}
        </p>
        <button
          type="submit"
          disabled={upload.kind === "busy"}
          className="inline-flex h-11 items-center gap-2 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised disabled:opacity-70"
        >
          {upload.kind === "busy" ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <FileUp aria-hidden className="size-4" />}
          {upload.kind === "busy" ? labels.uploading : labels.upload}
        </button>
        <div aria-live="polite">
          {upload.kind === "done" ? (
            <div className="rounded-control bg-sunken px-3 py-2 text-sm">
              <p>{t(labels.uploaded, { chapters: formatNumber(upload.chapters, locale) })}</p>
              {upload.warnings.length ? (
                <details className="mt-1 text-fg-muted">
                  <summary>{labels.warnings}</summary>
                  <ul lang="en" className="mt-1 list-disc pl-5">
                    {upload.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
        {upload.kind === "error" ? (
          <div role="alert" className="rounded-control bg-destructive/10 px-3 py-2 text-sm text-destructive">
            <p>{errorText(upload.code)}</p>
            {upload.details?.length ? (
              <ul lang="en" className="mt-1 list-disc pl-5">
                {upload.details.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </form>

      {files.length ? (
        <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
              <code className="font-mono text-xs" title={f.sha256}>
                {f.sha256.slice(0, 12)}
              </code>
              <span className="text-fg-muted">{size(f.bytes)}</span>
              {f.epub_version ? <span className="text-fg-muted">EPUB {f.epub_version}</span> : null}
              <span className="text-fg-subtle">{date.format(new Date(f.created_at))}</span>
              <span className="ml-auto">{f.is_current ? <span className="rounded-full bg-cloth px-2.5 py-1 text-xs text-on-cloth">{labels.current}</span> : <MakeCurrent id={f.id} labels={labels} />}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted">{labels.noFiles}</p>
      )}
    </div>
  );
}

function MakeCurrent({ id, labels }: { id: string; labels: AdminLabels }) {
  const { state, pending, form } = useAdminForm(makeFileCurrent);
  return (
    <form {...form} className="inline-flex items-center gap-2">
      <input type="hidden" name="file" value={id} />
      <button type="submit" disabled={pending} className="text-sm text-link underline-offset-4 hover:underline disabled:opacity-60">
        {labels.makeCurrent}
      </button>
      {state.status === "error" ? <FormStatus state={state} labels={labels} /> : null}
    </form>
  );
}
