"use client";

import { deleteCollection, deleteGenre, saveCollection, saveGenre } from "@/lib/admin/actions";
import { STATUSES } from "@/lib/admin/forms";
import type { Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import { formatNumber } from "@/lib/i18n/format";
import { DeleteForm, FormStatus, SelectField, SubmitButton, TextArea, TextField, useAdminForm, type AdminLabels } from "./form-kit";

export type TermRecord = {
  id: string;
  slug: string;
  name_bn: string;
  name_en: string;
  description_bn: string | null;
  description_en: string | null;
  position: number;
  status?: string;
  works: number;
};

/** Genres or collections: each one editable in place, and a form for a new one. */
export function TermList({ kind, terms, locale, labels }: { kind: "genres" | "collections"; terms: TermRecord[]; locale: Locale; labels: AdminLabels }) {
  return (
    <div className="space-y-4">
      {terms.map((term) => (
        <details key={term.id} className="group rounded-[14px] border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
            <span className="font-display text-lg">{locale === "bn" ? term.name_bn : term.name_en}</span>
            <code className="text-xs text-fg-subtle">{term.slug}</code>
            {term.status && term.status !== "published" ? <span className="rounded-full bg-sunken px-2 py-0.5 text-xs">{labels.statuses[term.status as "draft"]}</span> : null}
            <span className="ml-auto text-sm text-fg-muted">{t(labels.count, { count: formatNumber(term.works, locale) })}</span>
          </summary>
          <div className="border-t border-line px-5 py-5">
            <TermForm kind={kind} term={term} locale={locale} labels={labels} />
            <div className="mt-4 border-t border-line pt-4">
              <DeleteForm
                action={kind === "genres" ? deleteGenre : deleteCollection}
                fields={{ id: term.id, locale }}
                label={labels.delete}
                confirm={t(labels.deleteConfirm, { name: locale === "bn" ? term.name_bn : term.name_en })}
                labels={labels}
              />
            </div>
          </div>
        </details>
      ))}
      <section className="rounded-[14px] border border-dashed border-line-strong p-5">
        <h2 className="mb-4 font-display text-xl">{kind === "genres" ? labels.newGenre : labels.newCollection}</h2>
        <TermForm kind={kind} term={null} locale={locale} labels={labels} />
      </section>
    </div>
  );
}

function TermForm({ kind, term, locale, labels }: { kind: "genres" | "collections"; term: TermRecord | null; locale: Locale; labels: AdminLabels }) {
  const { state, pending, form } = useAdminForm(kind === "genres" ? saveGenre : saveCollection);
  return (
    <form {...form} key={term ? undefined : state.status === "saved" ? state.at : "new"} className="space-y-5">
      <input type="hidden" name="locale" value={locale} />
      {term ? <input type="hidden" name="id" value={term.id} /> : null}
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField name="name_bn" label={labels.nameBn} lang="bn" defaultValue={term?.name_bn} required state={state} labels={labels} />
        <TextField name="name_en" label={labels.nameEn} lang="en" defaultValue={term?.name_en} required state={state} labels={labels} />
        <TextField name="slug" label={labels.slug} hint={labels.slugHint} lang="en" defaultValue={term?.slug} required state={state} labels={labels} />
        <TextField name="position" label={labels.position} inputMode="numeric" defaultValue={term?.position ?? 0} state={state} labels={labels} />
        <TextArea name="description_bn" label={`${labels.description} (বাংলা)`} lang="bn" rows={2} defaultValue={term?.description_bn} state={state} labels={labels} />
        <TextArea name="description_en" label={`${labels.description} (English)`} lang="en" rows={2} defaultValue={term?.description_en} state={state} labels={labels} />
        {kind === "collections" ? (
          <SelectField
            name="status"
            label={labels.status}
            defaultValue={term?.status ?? "published"}
            options={STATUSES.map((s) => ({ value: s, label: labels.statuses[s] }))}
            state={state}
            labels={labels}
          />
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pending={pending} pendingText={labels.saving}>
          {term ? labels.save : labels.add}
        </SubmitButton>
        <FormStatus state={state} labels={labels} />
      </div>
    </form>
  );
}
