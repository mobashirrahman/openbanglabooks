import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";
import { adminGate } from "@/lib/admin/auth";
import { signInPath } from "@/lib/admin/page";
import { getDictionary, getLocale, t } from "@/lib/i18n";

/**
 * The catalogue editor. Rendered per request as the signed-in editor (the
 * proxy keeps the session fresh), never cached or indexed.
 */
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.admin.title, robots: { index: false, follow: false } };
}

export default async function AdminLayout({ children }: LayoutProps<"/[lang]/admin">) {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const gate = await adminGate();
  if (gate.kind === "signed-out") redirect(signInPath(locale));
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-6 sm:pt-10">
      {gate.kind === "forbidden" ? (
        <div className="mx-auto max-w-xl rounded-[16px] border border-line bg-surface p-8 text-center">
          <ShieldAlert aria-hidden className="mx-auto size-8 text-fg-subtle" />
          <h1 className="mt-4 text-2xl">{dict.admin.forbidden}</h1>
          <p className="mt-2 text-fg-muted [overflow-wrap:anywhere]">{t(dict.admin.forbiddenAs, { email: gate.email ?? "" })}</p>
        </div>
      ) : (
        <>
          <AdminNav locale={locale} labels={dict.admin} />
          <div className="pt-8">{children}</div>
        </>
      )}
    </div>
  );
}
