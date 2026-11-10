import type { Metadata } from "next";
import { SignInForm } from "@/components/account/sign-in-form";
import { getDictionary, getLocale } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.account.authTitle, robots: { index: false, follow: false } };
}

/**
 * Sign in with email and password, or create an account (email and password,
 * Google or Facebook). The page is static; `?next=` is read in the browser by
 * the form.
 */
export default async function SignInPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const a = dict.account;
  return (
    <div className="mx-auto max-w-xl px-4 pt-10 pb-16 sm:px-6 sm:pt-16">
      <h1 className="text-4xl sm:text-5xl">{a.authTitle}</h1>
      <p className="mt-3 mb-10 text-lg text-fg-muted">{a.signInLead}</p>
      <SignInForm locale={locale} labels={a} />
      <p className="mt-12 border-t border-line pt-6 text-sm text-fg-subtle">{a.privacy}</p>
    </div>
  );
}
