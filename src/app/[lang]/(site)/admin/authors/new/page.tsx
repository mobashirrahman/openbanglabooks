import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AuthorForm } from "@/components/admin/author-form";
import { pageEditor } from "@/lib/admin/page";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";

export const instant = false;

export default async function NewAuthorPage() {
  const locale = await getLocale();
  const editor = await pageEditor(locale);
  if (!editor) return null;
  const dict = await getDictionary(locale);
  return (
    <div className="space-y-6">
      <Link href={localizedPath(locale, "/admin/authors")} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" />
        {dict.admin.authors}
      </Link>
      <h1 className="text-3xl sm:text-4xl">{dict.admin.newAuthor}</h1>
      <AuthorForm author={null} locale={locale} labels={dict.admin} />
    </div>
  );
}
