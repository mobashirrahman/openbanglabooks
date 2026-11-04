import "./globals.css";
import type { Metadata } from "next";
import { NotFoundView } from "@/components/status/not-found-view";
import { ThemeScript } from "@/components/theme/theme-script";
import bn from "@/lib/i18n/dictionaries/bn";

export const metadata: Metadata = {
  title: `${bn.common.notFoundTitle} | ${bn.meta.siteName}`,
  robots: { index: false },
};

/** 404 for URLs that match no route at all (outside the locale layouts). */
export default function GlobalNotFound() {
  return (
    <html lang="bn" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="bg-bg text-fg">
        <NotFoundView
          as="main"
          title={bn.common.notFoundTitle}
          body={bn.common.notFoundBody}
          english="This page could not be found."
          action={{ href: "/", label: bn.common.goHome }}
        />
      </body>
    </html>
  );
}
