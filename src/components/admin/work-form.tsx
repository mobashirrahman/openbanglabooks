"use client";

import { useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { saveWork } from "@/lib/admin/actions";
import { COVER_VARIANTS, FORMS, ROLES, STATUSES } from "@/lib/admin/forms";
import { checkPublicDomain } from "@/lib/rights";
import { formatNumber } from "@/lib/i18n/format";
import type { Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { cn } from "@/lib/utils";
import { CheckboxField, Fieldset, FormStatus, SelectField, SubmitButton, TextArea, TextField, useAdminForm, type AdminLabels } from "./form-kit";

export type WorkRecord = {
  id: string;
  slug: string;
  title_bn: string;
  title_en: string;
  title_latn: string;
  subtitle_bn: string | null;
  original_pub_year: number | null;
  form: string;
  literary_period: string | null;
  description_bn: string | null;
  description_en: string | null;
  status: string;
  rights_basis: string | null;
  rights_verified_by: string | null;
  rights_verified_at: string | null;
  featured_rank: number | null;
  cover_variant: number;
};
export type AuthorOption = { id: string; name_bn: string; name_en: string; died_year: number | null };
export type TermOption = { id: string; name_bn: string; name_en: string };
type Credit = { key: number; id: string; role: string };

export function WorkForm({
  work,
  credits: initialCredits,
  genreIds,
  collectionIds,
  authors,
  genres,
  collections,
  locale,
  labels,
  formNames,
}: {
  work: WorkRecord | null;
  credits: { id: string; role: string }[];
  genreIds: string[];
  collectionIds: string[];
  authors: AuthorOption[];
  genres: TermOption[];
  collections: TermOption[];
  locale: Locale;
  labels: AdminLabels;
  formNames: Dictionary["forms"];
}) {
  const { state, pending, form } = useAdminForm(saveWork);
  const [credits, setCredits] = useState<Credit[]>(() =>
    (initialCredits.length ? initialCredits : [{ id: "", role: "author" }]).map((c, key) => ({ key, ...c })),
  );
  const nextKey = useRef(credits.length);
  const [title, setTitle] = useState(work?.title_bn ?? "");
  const [year, setYear] = useState(work?.original_pub_year?.toString() ?? "");
  const [variant, setVariant] = useState(work?.cover_variant ?? 0);
  const name = (a: AuthorOption) => (locale === "bn" ? a.name_bn : a.name_en);

  const firstAuthor = authors.find((a) => a.id === credits.find((c) => c.role === "author")?.id);
  const verdict = useMemo(() => {
    const died = credits.filter((c) => c.role === "author" && c.id).map((c) => authors.find((a) => a.id === c.id)?.died_year ?? null);
    const y = Number(year.replace(/[০-৯]/g, (d) => String(d.charCodeAt(0) - 0x09e6)));
    return checkPublicDomain({ authorDiedYears: died, firstPublished: year && Number.isInteger(y) ? y : null });
  }, [credits, authors, year]);

  const verifiedAt = work?.rights_verified_at ? new Intl.DateTimeFormat(locale === "bn" ? "bn-BD" : "en-GB", { dateStyle: "long" }).format(new Date(work.rights_verified_at)) : null;
  const creditsError = state.status === "error" ? state.errors?.authors : undefined;

  return (
    <form
      {...form}
      // the cover preview and the rights check follow what is typed
      onChange={(e) => {
        const el = e.target as unknown as HTMLInputElement;
        if (el.name === "title_bn") setTitle(el.value);
        else if (el.name === "original_pub_year") setYear(el.value);
      }}
      className="space-y-8"
    >
      <input type="hidden" name="locale" value={locale} />
      {work ? <input type="hidden" name="id" value={work.id} /> : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_16rem]">
        <div className="space-y-8">
          <Fieldset legend={labels.identity}>
            <div className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <TextField
                  name="title_bn"
                  label={labels.titleBn}
                  lang="bn"
                  defaultValue={work?.title_bn}
                  required
                  state={state}
                  labels={labels}
                  className="[&_input]:font-display [&_input]:text-lg"
                />
              </div>
              <TextField name="title_en" label={labels.titleEn} lang="en" defaultValue={work?.title_en} required state={state} labels={labels} />
              <TextField name="title_latn" label={labels.titleLatn} hint={labels.titleLatnHint} lang="en" defaultValue={work?.title_latn} required state={state} labels={labels} />
              <TextField name="subtitle_bn" label={labels.subtitle} lang="bn" defaultValue={work?.subtitle_bn} state={state} labels={labels} />
              <TextField name="slug" label={labels.slug} hint={labels.slugHint} lang="en" defaultValue={work?.slug} required state={state} labels={labels} />
              <SelectField
                name="form"
                label={labels.form}
                defaultValue={work?.form ?? "novel"}
                options={FORMS.map((f) => ({ value: f, label: formNames[f] }))}
                state={state}
                labels={labels}
              />
              <TextField name="original_pub_year" label={labels.firstPublished} inputMode="numeric" defaultValue={work?.original_pub_year} state={state} labels={labels} />
              <TextField name="literary_period" label={labels.literaryPeriod} defaultValue={work?.literary_period} state={state} labels={labels} />
            </div>
          </Fieldset>

          <Fieldset legend={labels.credits}>
            <ul className="space-y-3">
              {credits.map((c, i) => (
                <li key={c.key} className="flex flex-wrap items-end gap-3">
                  <label className="min-w-0 flex-1 space-y-1.5">
                    <span className="sr-only">{`${labels.chooseAuthor} ${formatNumber(i + 1, locale)}`}</span>
                    <select
                      name="author_id"
                      value={c.id}
                      onChange={(e) => setCredits((list) => list.map((x) => (x.key === c.key ? { ...x, id: e.target.value } : x)))}
                      aria-invalid={Boolean(creditsError) || undefined}
                      className="h-11 w-full rounded-[10px] border border-line-strong bg-surface px-3.5 text-base outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
                    >
                      <option value="">{labels.chooseAuthor}</option>
                      {authors.map((a) => (
                        <option key={a.id} value={a.id}>
                          {name(a)}
                          {a.died_year ? ` (${formatNumber(a.died_year, locale, { useGrouping: false })})` : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="sr-only">{labels.status}</span>
                    <select
                      name="author_role"
                      value={c.role}
                      onChange={(e) => setCredits((list) => list.map((x) => (x.key === c.key ? { ...x, role: e.target.value } : x)))}
                      className="h-11 rounded-[10px] border border-line-strong bg-surface px-3.5 text-base outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/30"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {labels.roles[r]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {credits.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => setCredits((list) => list.filter((x) => x.key !== c.key))}
                      className="inline-flex size-11 items-center justify-center rounded-control text-fg-muted hover:bg-sunken hover:text-fg"
                      aria-label={labels.removeCredit}
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {creditsError ? <p className="text-sm text-destructive">{labels.errors[creditsError]}</p> : null}
            <button
              type="button"
              onClick={() => setCredits((list) => [...list, { key: nextKey.current++, id: "", role: "author" }])}
              className="inline-flex h-10 items-center gap-1.5 rounded-control px-3 text-sm text-link hover:bg-sunken"
            >
              <Plus aria-hidden className="size-4" />
              {labels.addCredit}
            </button>
          </Fieldset>

          <Fieldset legend={labels.about}>
            <TextArea name="description_bn" label={labels.descriptionBn} lang="bn" rows={5} defaultValue={work?.description_bn} state={state} labels={labels} />
            <TextArea name="description_en" label={labels.descriptionEn} lang="en" rows={4} defaultValue={work?.description_en} state={state} labels={labels} />
            {genres.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{labels.genres}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {genres.map((g) => (
                    <CheckboxField key={g.id} name="genre" value={g.id} label={locale === "bn" ? g.name_bn : g.name_en} defaultChecked={genreIds.includes(g.id)} />
                  ))}
                </div>
              </div>
            ) : null}
            {collections.length ? (
              <div className="space-y-2">
                <p className="text-sm font-medium">{labels.collections}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {collections.map((c) => (
                    <CheckboxField key={c.id} name="collection" value={c.id} label={locale === "bn" ? c.name_bn : c.name_en} defaultChecked={collectionIds.includes(c.id)} />
                  ))}
                </div>
              </div>
            ) : null}
            <TextField name="featured_rank" label={labels.featuredRank} hint={labels.featuredHint} inputMode="numeric" defaultValue={work?.featured_rank} state={state} labels={labels} className="max-w-xs" />
          </Fieldset>

          <Fieldset legend={labels.rights}>
            <div className={cn("rounded-[10px] px-4 py-3 text-sm", verdict.ok ? "bg-sunken" : "bg-destructive/10")} aria-live="polite">
              <p className="font-medium">
                {labels.rightsCheck}: {verdict.ok ? labels.rightsOk : labels.rightsNotOk}
              </p>
              <p lang="en" className="mt-1 text-fg-muted">
                {verdict.ok ? verdict.basis : verdict.reason}
              </p>
              {verdict.ok ? (
                <button
                  type="button"
                  onClick={(e) => {
                    const field = e.currentTarget.form?.elements.namedItem("rights_basis") as HTMLTextAreaElement | null;
                    if (field) {
                      field.value = verdict.basis;
                      field.focus();
                    }
                  }}
                  className="mt-2 text-sm text-link underline underline-offset-4"
                >
                  {labels.useSuggestion}
                </button>
              ) : null}
            </div>
            <TextArea name="rights_basis" label={labels.rightsBasis} hint={labels.rightsBasisHint} rows={3} defaultValue={work?.rights_basis} state={state} labels={labels} />
            <p className="text-sm text-fg-muted">
              {work?.rights_verified_by && verifiedAt ? t(labels.rightsVerifiedBy, { who: work.rights_verified_by, date: verifiedAt }) : labels.rightsNotVerified}
            </p>
            <CheckboxField name="rights_verified" label={labels.rightsVerified} />
          </Fieldset>
        </div>

        <aside className="space-y-8 lg:sticky lg:top-6 lg:self-start">
          <Fieldset legend={labels.status}>
            <SelectField
              name="status"
              label={labels.status}
              hint={labels.statusHelp}
              defaultValue={work?.status ?? "draft"}
              options={STATUSES.map((s) => ({ value: s, label: labels.statuses[s] }))}
              state={state}
              labels={labels}
            />
            <div className="flex flex-col gap-3">
              <SubmitButton pending={pending} pendingText={labels.saving}>
                {labels.save}
              </SubmitButton>
              <FormStatus state={state} labels={labels} />
            </div>
          </Fieldset>

          <Fieldset legend={labels.cover}>
            <div className="mx-auto w-36">
              <BookCover work={{ slug: work?.slug ?? "new", title_bn: title || "…", authors: firstAuthor ? [{ name_bn: firstAuthor.name_bn }] : [], cover_variant: variant }} />
            </div>
            <div role="radiogroup" aria-label={labels.cover} className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto p-1">
              {Array.from({ length: COVER_VARIANTS }, (_, v) => (
                <label key={v} className="relative cursor-pointer">
                  <input type="radio" name="cover_variant" value={v} checked={variant === v} onChange={() => setVariant(v)} className="peer sr-only" />
                  <span className="sr-only">{t(labels.coverVariant, { n: formatNumber(v + 1, locale) })}</span>
                  <span className="block rounded-[4px] ring-offset-2 ring-offset-surface peer-checked:ring-2 peer-checked:ring-focus peer-focus-visible:ring-2 peer-focus-visible:ring-focus">
                    <BookCover work={{ slug: `v${v}`, title_bn: "", authors: [], cover_variant: v }} />
                  </span>
                </label>
              ))}
            </div>
          </Fieldset>
        </aside>
      </div>
    </form>
  );
}
