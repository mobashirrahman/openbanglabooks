import { TermList, type TermRecord } from "@/components/admin/term-list";
import { pageEditor } from "@/lib/admin/page";
import { getDictionary, getLocale } from "@/lib/i18n";

export const instant = false;

type Row = Omit<TermRecord, "works"> & { collection_items: { count: number }[] };

export default async function AdminCollectionsPage() {
  const locale = await getLocale();
  const editor = await pageEditor(locale);
  if (!editor) return null;
  const [dict, { data }] = await Promise.all([
    getDictionary(locale),
    editor.supabase.from("collections").select("id, slug, name_bn, name_en, description_bn, description_en, position, status, collection_items(count)").order("position").returns<Row[]>(),
  ]);
  const terms: TermRecord[] = (data ?? []).map(({ collection_items: c, ...t }) => ({ ...t, works: c[0]?.count ?? 0 }));
  return (
    <div className="space-y-8">
      <h1 className="text-3xl sm:text-4xl">{dict.admin.collections}</h1>
      <TermList kind="collections" terms={terms} locale={locale} labels={dict.admin} />
    </div>
  );
}
