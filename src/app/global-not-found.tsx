import "./globals.css";
import type { Metadata } from "next";
import { Mark } from "@/components/brand/logo";
import { ThemeScript } from "@/components/theme/theme-script";

export const metadata: Metadata = {
  title: "পাতাটি পাওয়া যায়নি | OpenBanglaBooks",
  robots: { index: false },
};

/** 404 for URLs that match no route at all (outside the locale layouts). */
export default function GlobalNotFound() {
  return (
    <html lang="bn" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="flex min-h-dvh items-center justify-center bg-bg px-6 text-fg">
        <main className="max-w-md text-center">
          <Mark className="mx-auto size-16 text-cloth dark:text-foil" />
          <h1 className="mt-6 font-display text-3xl">পাতাটি পাওয়া যায়নি</h1>
          <p className="mt-3 text-fg-muted">ঠিকানাটি হয়তো বদলে গেছে বা ভুল লেখা হয়েছে।</p>
          <p lang="en" className="mt-1 text-sm text-fg-subtle">
            This page could not be found.
          </p>
          <a
            href="/"
            className="mt-8 inline-flex h-11 items-center rounded-control bg-cloth px-5 text-on-cloth hover:bg-cloth-raised"
          >
            প্রথম পাতায় যান
          </a>
        </main>
      </body>
    </html>
  );
}
