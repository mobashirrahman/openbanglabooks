import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { HardcoverTransfer } from "@/components/connections/hardcover-transfer";
import { listWorkNames } from "@/lib/catalog/queries";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.connections.hcTitle, robots: { index: false, follow: false } };
}

export default async function HardcoverPage() {
  const locale = await getLocale();
  const [dict, works] = await Promise.all([getDictionary(locale), listWorkNames()]);
  return (
    <div className="mx-auto max-w-4xl px-4 pt-10 sm:px-6 sm:pt-14 lg:px-8">
      <Link href={localizedPath(locale, "/library")} className="-ml-2 inline-flex h-10 items-center gap-1 rounded-control px-2 text-sm text-fg-muted hover:bg-sunken hover:text-fg">
        <ChevronLeft aria-hidden className="size-4" />
        {dict.library.title}
      </Link>
      <h1 className="mt-4 text-4xl sm:text-5xl">{dict.connections.hcTitle}</h1>
      <p className="mt-3 mb-12 max-w-2xl text-fg-muted">{dict.connections.hcIntro}</p>
      <HardcoverTransfer
        locale={locale}
        works={works}
        hc={dict.connections}
        labels={{
          ...dict.transfer,
          statusWant: dict.library.statusWant,
          statusReading: dict.library.statusReading,
          statusFinished: dict.library.statusFinished,
          statusDnf: dict.library.statusDnf,
        }}
      />
    </div>
  );
}
