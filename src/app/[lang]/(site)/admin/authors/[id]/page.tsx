import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { AuthorForm, type AuthorRecord } from "@/components/admin/author-form";
import { DeleteAuthor } from "@/components/admin/delete-buttons";
import { StatusBadge } from "@/components/admin/status-badge";
import { pageEditor } from "@/lib/admin/page";
import type { Status } from "@/lib/admin/forms";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";

export const instant = false;

const UUID = /^[0-9a-f-]{36}$/i;

export default async function EditAuthorPage({ params }: PageProps<"/[lang]/admin/authors/[id]">) {
  const locale = await getLocale();
  const editor = await pageEditor(locale);
  if (!editor) return null;
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [dict, author, works] = await Promise.all([
    getDictionary(locale),
    editor.supabase.from("authors").select("*").eq("id", id).maybeSingle<AuthorRecord>(),
    editor.supabase.from("work_authors").select("role, works(id, title_bn, status)").eq("author_id", id).returns<{ role: string; works: { id: string; title_bn: string; status: Status } | null }[]>(),
  ]);
  if (!author.data) notFound();
  const a = dict.admin;
  const r = author.data;
  return (
    <div className="space-y-6">
      <Link href={localizedPath(locale, "/admin/authors")} className="inline-flex items-center gap-1.5 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" />
        {a.authors}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto font-display text-3xl sm:text-4xl">{locale === "bn" ? r.name_bn : r.name_en}</h1>
        <StatusBadge status={r.status} label={a.statuses[r.status as Status]} />
        {r.status === "published" ? (
          <a href={localizedPath(locale, `/authors/${r.slug}`)} className="inline-flex h-10 items-center gap-1.5 rounded-control px-3 text-sm text-link hover:bg-sunken">
            <ExternalLink aria-hidden className="size-4" />
            {a.viewPublic}
          </a>
        ) : null}
      </div>
      <AuthorForm author={r} locale={locale} labels={a} />
      {works.data?.length ? (
        <section aria-labelledby="author-works" className="space-y-3 pt-4">
          <h2 id="author-works" className="text-2xl">
            {a.works}
          </h2>
          <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
            {works.data
              .filter((w) => w.works)
              .map((w) => (
                <li key={`${w.works!.id}:${w.role}`}>
                  <Link href={localizedPath(locale, `/admin/works/${w.works!.id}`)} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/60">
                    <span className="flex-1 font-display">{w.works!.title_bn}</span>
                    <span className="text-sm text-fg-muted">{a.roles[w.role as keyof typeof a.roles]}</span>
                    <StatusBadge status={w.works!.status} label={a.statuses[w.works!.status]} />
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ) : (
        <div className="border-t border-line pt-6">
          <DeleteAuthor id={r.id} name={r.name_bn} locale={locale} labels={a} />
        </div>
      )}
    </div>
  );
}
