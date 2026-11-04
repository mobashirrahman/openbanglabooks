import type { Metadata, Viewport } from "next";
import "../../globals.css";
import { ThemeScript } from "@/components/theme/theme-script";
import { SiteHeader } from "@/components/nav/site-header";
import { SiteFooter } from "@/components/nav/site-footer";
import { BottomNav } from "@/components/nav/primary-nav";
import { OpenTracker } from "@/components/reader/open-tracker";
import { getDictionary, getLocale } from "@/lib/i18n";
import { locales } from "@/lib/i18n/config";
import { siteUrl } from "@/lib/seo/site";

export async function generateStaticParams() {
  return locales.map((lang) => ({ lang }));
}

export async function generateMetadata(): Promise<Metadata> {
  const dict = await getDictionary();
  return {
    metadataBase: new URL(siteUrl()),
    title: { default: dict.meta.homeTitle, template: `%s | ${dict.meta.siteName}` },
    description: dict.meta.homeDescription,
    applicationName: dict.meta.siteName,
    formatDetection: { telephone: false },
    appleWebApp: { capable: true, title: dict.meta.siteName, statusBarStyle: "default" },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#233B30" },
    { media: "(prefers-color-scheme: dark)", color: "#1A2D24" },
  ],
  viewportFit: "cover",
};

export default async function SiteLayout({ children }: LayoutProps<"/[lang]">) {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <ThemeScript />
        <link rel="preload" href="/fonts/hind-siliguri-bengali-400-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
        <link rel="preload" href="/fonts/tiro-bangla-bengali-400-normal.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only z-50 rounded-control bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          {dict.nav.skipToContent}
        </a>
        <SiteHeader locale={locale} dict={dict} />
        <main id="main" className="flex-1 pb-20 lg:pb-0">
          {children}
        </main>
        <SiteFooter locale={locale} dict={dict} />
        <OpenTracker />
        <BottomNav
          locale={locale}
          labels={{ discover: dict.nav.discover, library: dict.nav.library, profile: dict.nav.profile, mainNav: dict.nav.mainNav }}
        />
      </body>
    </html>
  );
}
