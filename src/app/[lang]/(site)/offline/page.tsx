import type { Metadata } from "next";
import { OfflineView } from "@/components/offline/offline-view";
import { getDictionary, getLocale } from "@/lib/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return { title: dict.offline.metaTitle, robots: { index: false, follow: false } };
}

/**
 * Shown by the service worker for a page that is not kept on this device
 * while there is no connection. Lists the books that can be read anyway.
 */
export default async function OfflinePage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return <OfflineView locale={locale} labels={dict.offline} />;
}
