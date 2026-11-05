"use client";

import { saveEdition } from "@/lib/admin/actions";
import { STATUSES } from "@/lib/admin/forms";
import type { Locale } from "@/lib/i18n/config";
import { CheckboxField, Fieldset, FormStatus, SelectField, SubmitButton, TextArea, TextField, useAdminForm, type AdminLabels } from "./form-kit";

export type EditionRecord = {
  id: string;
  work_id: string;
  label_bn: string | null;
  label_en: string | null;
  publisher: string | null;
  pub_year: number | null;
  source_name: string;
  source_url: string;
  license: string;
  license_url: string | null;
  attribution: string | null;
  is_primary: boolean;
  status: string;
};

export function EditionForm({ edition, workId, locale, labels }: { edition: EditionRecord | null; workId: string; locale: Locale; labels: AdminLabels }) {
  const { state, pending, form } = useAdminForm(saveEdition);
  return (
    <form {...form} className="space-y-8">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="work_id" value={workId} />
      {edition ? <input type="hidden" name="id" value={edition.id} /> : null}
      <Fieldset legend={labels.identity}>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="label_bn" label={labels.labelBn} lang="bn" defaultValue={edition?.label_bn} state={state} labels={labels} />
          <TextField name="label_en" label={labels.labelEn} lang="en" defaultValue={edition?.label_en} state={state} labels={labels} />
          <TextField name="publisher" label={labels.publisher} defaultValue={edition?.publisher} state={state} labels={labels} />
          <TextField name="pub_year" label={labels.pubYear} inputMode="numeric" defaultValue={edition?.pub_year} state={state} labels={labels} />
          <TextField name="source_name" label={labels.sourceName} defaultValue={edition?.source_name} required state={state} labels={labels} />
          <TextField name="source_url" label={labels.sourceUrl} inputMode="url" lang="en" defaultValue={edition?.source_url} required state={state} labels={labels} />
          <TextField name="license" label={labels.license} lang="en" defaultValue={edition?.license} required state={state} labels={labels} />
          <TextField name="license_url" label={labels.licenseUrl} inputMode="url" lang="en" defaultValue={edition?.license_url} state={state} labels={labels} />
        </div>
        <TextArea name="attribution" label={labels.attribution} rows={2} defaultValue={edition?.attribution} state={state} labels={labels} />
        <CheckboxField name="is_primary" label={labels.isPrimary} defaultChecked={edition ? edition.is_primary : true} />
        <SelectField
          name="status"
          label={labels.status}
          hint={labels.statusHelp}
          defaultValue={edition?.status ?? "draft"}
          options={STATUSES.map((s) => ({ value: s, label: labels.statuses[s] }))}
          state={state}
          labels={labels}
          className="max-w-xs"
        />
      </Fieldset>
      <div className="flex flex-wrap items-center gap-4">
        <SubmitButton pending={pending} pendingText={labels.saving}>
          {labels.save}
        </SubmitButton>
        <FormStatus state={state} labels={labels} />
      </div>
    </form>
  );
}
