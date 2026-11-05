import type { Metadata } from "next";
import { DeviceData, ThemePreference } from "@/components/profile/preferences";
import { AccountPanel } from "@/components/account/account-panel";
import { LanguageSwitch } from "@/components/nav/language-switch";
import { getDictionary, getLocale } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.profile.title, robots: { index: false, follow: false } };
}

export default async function ProfilePage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6 sm:pt-14">
      <h1 className="text-4xl sm:text-5xl">{dict.profile.title}</h1>
      <div className="mt-10 divide-y divide-line border-y border-line">
        <section className="grid gap-4 py-8 sm:grid-cols-[12rem_1fr]">
          <h2 className="text-xl">{dict.account.title}</h2>
          <AccountPanel locale={locale} labels={dict.account} syncLabels={dict.sync} />
        </section>
        <section className="grid gap-4 py-8 sm:grid-cols-[12rem_1fr]">
          <h2 className="text-xl">{dict.profile.theme}</h2>
          <ThemePreference labels={dict.profile} />
        </section>
        <section className="grid gap-4 py-8 sm:grid-cols-[12rem_1fr]">
          <h2 className="text-xl">{dict.profile.language}</h2>
          <div>
            <LanguageSwitch
              locale={locale}
              label={dict.nav.language}
              title={dict.nav.languageSwitch}
              className="border border-line-strong text-fg hover:bg-sunken hover:text-fg"
            />
          </div>
        </section>
        <section className="grid gap-4 py-8 sm:grid-cols-[12rem_1fr]">
          <h2 className="text-xl">{dict.profile.reading}</h2>
          <p className="text-fg-muted">{dict.profile.readingNote}</p>
        </section>
        <section className="grid gap-4 py-8 sm:grid-cols-[12rem_1fr]">
          <h2 className="text-xl">{dict.profile.data}</h2>
          <DeviceData labels={dict.profile} />
        </section>
      </div>
    </div>
  );
}
