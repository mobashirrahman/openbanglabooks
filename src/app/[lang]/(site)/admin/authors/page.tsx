import Link from "next/link";
import { Plus } from "lucide-react";
import { StatusBadge } from "@/components/admin/status-badge";
import { pageEditor } from "@/lib/admin/page";
import type { Status } from "@/lib/admin/forms";
import { getDictionary, getLocale, t } from "@/lib/i18n";
import { formatNumber } from "@/lib/i18n/format";
import { localizedPath } from "@/lib/i18n/config";

export const instant = false;

type Row = { id: string; slug: string; name_bn: string; name_en: string; born_year: number | null; died_year: number | null; status: Status; work_authors: { count: number }[] };

export default async function AdminAuthorsPage() {
  const locale = await getLocale();
  const editor = await pageEditor(locale);
  if (!editor) return null;
  const [dict, { data }] = await Promise.all([
    getDictionary(locale),
    editor.supabase.from("authors").select("id, slug, name_bn, name_en, born_year, died_year, status, work_authors(count)").order("name_bn").returns<Row[]>(),
  ]);
  const a = dict.admin;
  const year = (y: number | null) => (y ? formatNumber(y, locale, { useGrouping: false }) : "?");
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto text-3xl sm:text-4xl">{a.authors}</h1>
        <Link href={localizedPath(locale, "/admin/authors/new")} className="inline-flex h-11 items-center gap-2 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
          <Plus aria-hidden className="size-4" />
          {a.newAuthor}
        </Link>
      </div>
      {data?.length ? (
        <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
          {data.map((r) => (
            <li key={r.id}>
              <Link href={localizedPath(locale, `/admin/authors/${r.id}`)} className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-sunken/60">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-lg">{locale === "bn" ? r.name_bn : r.name_en}</span>
                  <span className="block text-sm text-fg-muted">
                    {year(r.born_year)}–{year(r.died_year)} · {t(a.count, { count: formatNumber(r.work_authors[0]?.count ?? 0, locale) })} {a.works}
                  </span>
                </span>
                <StatusBadge status={r.status} label={a.statuses[r.status]} />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-fg-muted">{a.emptyList}</p>
      )}
    </div>
  );
}
