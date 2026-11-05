import type { Metadata } from "next";
import { ConfirmLink } from "@/components/account/confirm-link";
import { getDictionary, getLocale } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.account.signInTitle, robots: { index: false, follow: false }, referrer: "no-referrer" };
}

export default async function ConfirmPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    <div className="mx-auto max-w-xl px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
      <h1 className="mb-8 text-4xl sm:text-5xl">{dict.account.signInTitle}</h1>
      <ConfirmLink locale={locale} labels={dict.account} />
    </div>
  );
}
