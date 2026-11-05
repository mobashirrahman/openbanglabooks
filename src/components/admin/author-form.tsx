"use client";

import { saveAuthor } from "@/lib/admin/actions";
import { STATUSES } from "@/lib/admin/forms";
import type { Locale } from "@/lib/i18n/config";
import { Fieldset, FormStatus, SelectField, SubmitButton, TextArea, TextField, useAdminForm, type AdminLabels } from "./form-kit";

export type AuthorRecord = {
  id: string;
  slug: string;
  name_bn: string;
  name_en: string;
  born_year: number | null;
  died_year: number | null;
  bio_bn: string | null;
  bio_en: string | null;
  wikidata_id: string | null;
  wikisource_url: string | null;
  status: string;
};

export function AuthorForm({ author, locale, labels }: { author: AuthorRecord | null; locale: Locale; labels: AdminLabels }) {
  const { state, pending, form } = useAdminForm(saveAuthor);
  return (
    <form {...form} className="space-y-8">
      <input type="hidden" name="locale" value={locale} />
      {author ? <input type="hidden" name="id" value={author.id} /> : null}
      <Fieldset legend={labels.identity}>
        <div className="grid gap-5 sm:grid-cols-2">
          <TextField name="name_bn" label={labels.nameBn} lang="bn" defaultValue={author?.name_bn} required state={state} labels={labels} />
          <TextField name="name_en" label={labels.nameEn} lang="en" defaultValue={author?.name_en} required state={state} labels={labels} />
          <TextField name="slug" label={labels.slug} hint={labels.slugHint} lang="en" defaultValue={author?.slug} required state={state} labels={labels} />
          <SelectField
            name="status"
            label={labels.status}
            hint={labels.statusHelp}
            defaultValue={author?.status ?? "draft"}
            options={STATUSES.map((s) => ({ value: s, label: labels.statuses[s] }))}
            state={state}
            labels={labels}
          />
          <TextField name="born_year" label={labels.born} inputMode="numeric" defaultValue={author?.born_year} state={state} labels={labels} />
          <TextField name="died_year" label={labels.died} inputMode="numeric" defaultValue={author?.died_year} state={state} labels={labels} />
          <TextField name="wikidata_id" label={labels.wikidata} lang="en" defaultValue={author?.wikidata_id} state={state} labels={labels} />
          <TextField name="wikisource_url" label={labels.wikisource} inputMode="url" lang="en" defaultValue={author?.wikisource_url} state={state} labels={labels} />
        </div>
      </Fieldset>
      <Fieldset legend={labels.about}>
        <TextArea name="bio_bn" label={labels.bioBn} lang="bn" rows={5} defaultValue={author?.bio_bn} state={state} labels={labels} />
        <TextArea name="bio_en" label={labels.bioEn} lang="en" rows={4} defaultValue={author?.bio_en} state={state} labels={labels} />
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
