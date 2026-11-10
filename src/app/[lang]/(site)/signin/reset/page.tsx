import type { Metadata } from "next";
import { ResetPassword } from "@/components/account/reset-password";
import { getDictionary, getLocale } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.account.resetTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

/** Opened from the password-reset email; the form exchanges the link in the browser. */
export default async function ResetPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const a = dict.account;
  return (
    <div className="mx-auto max-w-xl px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
      <h1 className="text-4xl sm:text-5xl">{a.resetTitle}</h1>
      <p className="mt-3 mb-10 text-lg text-fg-muted">{a.resetLead}</p>
      <ResetPassword locale={locale} labels={a} />
      <p className="mt-12 border-t border-line pt-6 text-sm text-fg-subtle">{a.privacy}</p>
    </div>
  );
}
