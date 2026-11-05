import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "../../globals.css";
import { getLocale } from "@/lib/i18n";
import { locales } from "@/lib/i18n/config";
import { siteUrl } from "@/lib/seo/site";
import { READER_SETTINGS_KEY, THEMES } from "@/lib/reader/settings";
import { SyncAgent } from "@/components/sync/sync-agent";
import { ServiceWorker } from "@/components/offline/service-worker";

/**
 * Root layout for the immersive reader. Separate from the site layout so that
 * entering the reader is always a full document load under the strict,
 * nonce-based CSP set by proxy.ts (EPUB content can never run scripts).
 * Rendered per request by design (the nonce), so it opts out of the static
 * shell validation.
 */
export const instant = false;

export async function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  robots: { index: false, follow: true },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: "#202423",
};

// Applies the reader's page colour before first paint (no white flash at night).
const readerThemeScript = `(function(){try{var t=(JSON.parse(localStorage.getItem("${READER_SETTINGS_KEY}")||"{}").theme)||"light";var c=${JSON.stringify(
  Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, v.desk])),
)};if(!c[t])t="light";var r=document.documentElement;r.dataset.readerTheme=t;r.style.background=c[t];r.dataset.theme=t==="dark"?"dark":"light";}catch(e){}})();`;

export default async function ReaderLayout({ children }: LayoutProps<"/[lang]">) {
  const [locale, h] = await Promise.all([getLocale(), headers()]);
  const nonce = h.get("x-nonce") ?? undefined;
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: readerThemeScript }} />
      </head>
      <body className="overflow-hidden overscroll-none bg-transparent">
        {children}
        <SyncAgent />
        <ServiceWorker locale={locale} />
      </body>
    </html>
  );
}
