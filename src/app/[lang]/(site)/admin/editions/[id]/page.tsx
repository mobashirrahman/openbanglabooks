import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EditionForm, type EditionRecord } from "@/components/admin/edition-form";
import { BookFiles, type BookFileRecord } from "@/components/admin/book-files";
import { DeleteEdition } from "@/components/admin/delete-buttons";
import { StatusBadge } from "@/components/admin/status-badge";
import { pageEditor } from "@/lib/admin/page";
import type { Status } from "@/lib/admin/forms";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";

export const instant = false;

const UUID = /^[0-9a-f-]{36}$/i;

export default async function EditionPage({ params }: PageProps<"/[lang]/admin/editions/[id]">) {
  const locale = await getLocale();
  const editor = await pageEditor(locale);
  if (!editor) return null;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const db = editor.supabase;
  const [dict, edition, files] = await Promise.all([
    getDictionary(locale),
    db.from("editions").select("*, works(id, title_bn)").eq("id", id).maybeSingle<EditionRecord & { works: { id: string; title_bn: string } | null }>(),
    db
      .from("book_files")
      .select("id, sha256, bytes, epub_version, is_current, created_at, validation_report")
      .eq("edition_id", id)
      .order("created_at", { ascending: false })
      .returns<BookFileRecord[]>(),
  ]);
  if (!edition.data) notFound();
  const a = dict.admin;
  const e = edition.data;
  const name = (locale === "bn" ? e.label_bn : e.label_en) ?? e.label_bn ?? e.source_name;

  return (
    <div className="space-y-6">
      <Link href={localizedPath(locale, `/admin/works/${e.work_id}`)} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" />
        <span className="font-display">{e.works?.title_bn}</span>
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-3xl sm:text-4xl">{name}</h1>
        <StatusBadge status={e.status} label={a.statuses[e.status as Status]} />
      </div>
      <div className="grid gap-10 lg:grid-cols-[1fr_24rem]">
        <EditionForm edition={e} workId={e.work_id} locale={locale} labels={a} />
        <section aria-labelledby="files-heading" className="space-y-4">
          <h2 id="files-heading" className="text-2xl">
            {a.files}
          </h2>
          <BookFiles editionId={e.id} files={files.data ?? []} locale={locale} labels={a} />
        </section>
      </div>
      {e.status === "draft" ? (
        <div className="border-t border-line pt-6">
          <DeleteEdition id={e.id} workId={e.work_id} name={name} locale={locale} labels={a} />
        </div>
      ) : null}
    </div>
  );
}
