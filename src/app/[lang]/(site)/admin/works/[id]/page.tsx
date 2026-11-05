import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Plus } from "lucide-react";
import { WorkForm, type WorkRecord } from "@/components/admin/work-form";
import { DeleteWork } from "@/components/admin/delete-buttons";
import { StatusBadge } from "@/components/admin/status-badge";
import { pageEditor, workOptions } from "@/lib/admin/page";
import type { Status } from "@/lib/admin/forms";
import { getDictionary, getLocale, t } from "@/lib/i18n";
import { formatNumber } from "@/lib/i18n/format";
import { localizedPath } from "@/lib/i18n/config";

export const instant = false;

const UUID = /^[0-9a-f-]{36}$/i;

type EditionRow = {
  id: string;
  label_bn: string | null;
  label_en: string | null;
  source_name: string;
  is_primary: boolean;
  status: Status;
  chapter_count: number | null;
  book_files: { id: string; is_current: boolean }[];
};

export default async function EditWorkPage({ params }: PageProps<"/[lang]/admin/works/[id]">) {
  const locale = await getLocale();
  const editor = await pageEditor(locale);
  if (!editor) return null;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = editor.supabase;
  const [dict, options, work, credits, genres, collections, editions] = await Promise.all([
    getDictionary(locale),
    workOptions(editor),
    db.from("works").select("*").eq("id", id).maybeSingle<WorkRecord>(),
    db.from("work_authors").select("author_id, role, position").eq("work_id", id).order("position"),
    db.from("work_genres").select("genre_id").eq("work_id", id),
    db.from("collection_items").select("collection_id").eq("work_id", id),
    db
      .from("editions")
      .select("id, label_bn, label_en, source_name, is_primary, status, chapter_count, book_files(id, is_current)")
      .eq("work_id", id)
      .order("created_at")
      .returns<EditionRow[]>(),
  ]);
  if (!work.data) notFound();
  const a = dict.admin;
  const w = work.data;

  return (
    <div className="space-y-6">
      <Link href={localizedPath(locale, "/admin")} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" />
        {a.works}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-3xl sm:text-4xl">{w.title_bn}</h1>
        <StatusBadge status={w.status} label={a.statuses[w.status as Status]} />
        {w.status === "published" ? (
          <a href={localizedPath(locale, `/books/${w.slug}`)} className="inline-flex h-10 items-center gap-1.5 rounded-control px-3 text-sm text-link hover:bg-sunken">
            <ExternalLink aria-hidden className="size-4" />
            {a.viewPublic}
          </a>
        ) : null}
      </div>

      <WorkForm
        work={w}
        credits={(credits.data ?? []).map((c) => ({ id: c.author_id, role: c.role }))}
        genreIds={(genres.data ?? []).map((g) => g.genre_id)}
        collectionIds={(collections.data ?? []).map((c) => c.collection_id)}
        {...options}
        locale={locale}
        labels={a}
        formNames={dict.forms}
      />

      <section aria-labelledby="editions-heading" className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="editions-heading" className="mr-auto text-2xl">
            {a.editions}
          </h2>
          <Link
            href={localizedPath(locale, `/admin/works/${w.id}/editions/new`)}
            className="inline-flex h-10 items-center gap-1.5 rounded-control border border-line-strong px-4 text-sm hover:bg-sunken"
          >
            <Plus aria-hidden className="size-4" />
            {a.newEdition}
          </Link>
        </div>
        {editions.data?.length ? (
          <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
            {editions.data.map((e) => (
              <li key={e.id}>
                <Link href={localizedPath(locale, `/admin/editions/${e.id}`)} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-sunken/60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{(locale === "bn" ? e.label_bn : e.label_en) ?? e.label_bn ?? e.source_name}</span>
                    <span className="block text-sm text-fg-muted">
                      {[e.is_primary ? a.primary : null, e.chapter_count ? t(a.chapters, { count: formatNumber(e.chapter_count, locale) }) : null, e.book_files.some((f) => f.is_current) ? null : a.noFiles]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </span>
                  <StatusBadge status={e.status} label={a.statuses[e.status]} />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-fg-muted">{a.noEditions}</p>
        )}
      </section>

      {w.status === "draft" ? (
        <div className="border-t border-line pt-6">
          <DeleteWork id={w.id} name={w.title_bn} locale={locale} labels={a} />
        </div>
      ) : null}
    </div>
  );
}
