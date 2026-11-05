import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { WorkForm } from "@/components/admin/work-form";
import { pageEditor, workOptions } from "@/lib/admin/page";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";

export const instant = false;

export default async function NewWorkPage() {
  const locale = await getLocale();
  const editor = await pageEditor(locale);
  if (!editor) return null;
  const [dict, options] = await Promise.all([getDictionary(locale), workOptions(editor)]);
  return (
    <div className="space-y-6">
      <Link href={localizedPath(locale, "/admin")} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" />
        {dict.admin.works}
      </Link>
      <h1 className="text-3xl sm:text-4xl">{dict.admin.newWork}</h1>
      <WorkForm work={null} credits={[]} genreIds={[]} collectionIds={[]} {...options} locale={locale} labels={dict.admin} formNames={dict.forms} />
    </div>
  );
}
