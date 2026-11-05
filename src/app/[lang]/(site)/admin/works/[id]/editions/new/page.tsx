import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { EditionForm } from "@/components/admin/edition-form";
import { pageEditor } from "@/lib/admin/page";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";

export const instant = false;

export default async function NewEditionPage({ params }: PageProps<"/[lang]/admin/works/[id]/editions/new">) {
  const locale = await getLocale();
  const editor = await pageEditor(locale);
  if (!editor) return null;
  const { id } = await params;
  const [dict, work] = await Promise.all([getDictionary(locale), editor.supabase.from("works").select("id, title_bn").eq("id", id).maybeSingle()]);
  if (!work.data) notFound();
  return (
    <div className="space-y-6">
      <Link href={localizedPath(locale, `/admin/works/${id}`)} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" />
        <span className="font-display">{work.data.title_bn}</span>
      </Link>
      <h1 className="text-3xl sm:text-4xl">{dict.admin.newEdition}</h1>
      <EditionForm edition={null} workId={id} locale={locale} labels={dict.admin} />
    </div>
  );
}
