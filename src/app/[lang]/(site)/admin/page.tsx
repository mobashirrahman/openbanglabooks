import Link from "next/link";
import { Plus } from "lucide-react";
import { BookCover } from "@/components/cover/book-cover";
import { StatusBadge } from "@/components/admin/status-badge";
import { STATUSES, type Status } from "@/lib/admin/forms";
import { creditLine, pageEditor } from "@/lib/admin/page";
import { getDictionary, getLocale } from "@/lib/i18n";
import { formatNumber } from "@/lib/i18n/format";
import { localeTag, localizedPath } from "@/lib/i18n/config";
import { cn } from "@/lib/utils";

export const instant = false;

type Row = {
  id: string;
  slug: string;
  title_bn: string;
  title_en: string;
  status: Status;
  updated_at: string;
  cover_variant: number;
  work_authors: { position: number; role: string; authors: { name_bn: string; name_en: string } | null }[];
};

/** All works, drafts included, newest changes first. */
export default async function AdminWorksPage({ searchParams }: PageProps<"/[lang]/admin">) {
  const locale = await getLocale();
  const editor = await pageEditor(locale);
  if (!editor) return null;
  const dict = await getDictionary(locale);
  const a = dict.admin;
  const raw = (await searchParams).status;
  const filter = STATUSES.find((s) => s === raw) ?? null;

  const { data } = await editor.supabase
    .from("works")
    .select("id, slug, title_bn, title_en, status, updated_at, cover_variant, work_authors(position, role, authors(name_bn, name_en))")
    .order("updated_at", { ascending: false })
    .returns<Row[]>();
  const works = data ?? [];
  const shown = filter ? works.filter((w) => w.status === filter) : works;
  const date = new Intl.DateTimeFormat(localeTag[locale], { dateStyle: "medium" });
  const n = (x: number) => formatNumber(x, locale);
  const tabs: { value: Status | null; label: string; count: number }[] = [
    { value: null, label: a.all, count: works.length },
    ...STATUSES.map((s) => ({ value: s, label: a.statuses[s], count: works.filter((w) => w.status === s).length })),
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="mr-auto text-3xl sm:text-4xl">{a.works}</h1>
        <Link href={localizedPath(locale, "/admin/works/new")} className="inline-flex h-11 items-center gap-2 rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised">
          <Plus aria-hidden className="size-4" />
          {a.newWork}
        </Link>
      </div>

      <nav aria-label={a.statusFilter} className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={`${localizedPath(locale, "/admin")}${tab.value ? `?status=${tab.value}` : ""}`}
            aria-current={filter === tab.value ? "page" : undefined}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm",
              filter === tab.value ? "border-cloth bg-cloth text-on-cloth" : "border-line-strong text-fg-muted hover:text-fg",
            )}
          >
            {tab.label}
            <span className={cn("text-xs", filter === tab.value ? "text-on-cloth-muted" : "text-fg-subtle")}>{n(tab.count)}</span>
          </Link>
        ))}
      </nav>

      {shown.length ? (
        <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
          {shown.map((w) => {
            const byline = creditLine(w.work_authors, locale);
            return (
              <li key={w.id}>
                <Link href={localizedPath(locale, `/admin/works/${w.id}`)} className="flex items-center gap-4 px-4 py-3 hover:bg-sunken/60">
                  <div className="w-10 shrink-0">
                    <BookCover work={{ slug: w.slug, title_bn: w.title_bn, authors: [], cover_variant: w.cover_variant }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-display text-lg">{w.title_bn}</p>
                    <p className="truncate text-sm text-fg-muted">
                      {[w.title_en, byline].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <StatusBadge status={w.status} label={a.statuses[w.status]} />
                    <span className="hidden text-xs text-fg-subtle sm:block">
                      {a.updated} {date.format(new Date(w.updated_at))}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-fg-muted">{a.emptyList}</p>
      )}
    </div>
  );
}
