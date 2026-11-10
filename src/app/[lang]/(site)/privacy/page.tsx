import type { Metadata } from "next";
import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/contact";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";
import { alternates } from "@/lib/seo/site";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: locale === "bn" ? "গোপনীয়তা নীতি" : "Privacy policy",
    description:
      locale === "bn"
        ? "OpenBanglaBooks কী তথ্য রাখে, কেন রাখে, কার সঙ্গে ভাগ করে এবং আপনি কীভাবে তা মুছে ফেলতে পারেন।"
        : "What OpenBanglaBooks stores, why, who it is shared with, and how you can delete it.",
    alternates: alternates(locale, "/privacy", true),
  };
}

const CONTENT = {
  bn: {
    title: "গোপনীয়তা নীতি",
    lead: "OpenBanglaBooks আপনার তথ্য কী নেয়, কেন নেয় এবং আপনি কীভাবে তা নিয়ন্ত্রণ করবেন — সংক্ষেপে ও সরল ভাষায়।",
    updated: "সর্বশেষ হালনাগাদ: ১০ নভেম্বর ২০২৬",
    sections: [
      {
        h: "আমরা কী তথ্য রাখি",
        list: [
          "অ্যাকাউন্ট: নাম, ইমেইল ঠিকানা এবং পাসওয়ার্ডের হ্যাশ (Supabase Auth সংরক্ষণ করে), অথবা Google/Facebook দিয়ে সাইন ইন করলে সেই পরিচয়ের তথ্য।",
          "সাইন ইন করলে: পড়ার অগ্রগতি, বুকমার্ক, হাইলাইট, নোট, তাক, রেটিং ও পড়ার ইতিহাস।",
          "আপনি অ্যাকাউন্টে রাখতে চাইলে নিজের আপলোড করা বই।",
          "Hardcover বা Readwise সংযোগ করলে তাদের অ্যাক্সেস টোকেন, এনক্রিপ্ট করে।",
          "সার্ভার লগ: নিরাপত্তা ও সমস্যা সমাধানের জন্য IP ঠিকানা, ব্রাউজার, সময় ও ত্রুটির বিবরণ।",
          "অ্যাকাউন্ট না খুললে আপনার পড়ার তথ্য শুধু এই ডিভাইসে থাকে এবং সার্ভারে যায় না।",
        ],
      },
      {
        h: "কেন এই তথ্য রাখি",
        p: [
          "আপনাকে সাইন ইন করতে দেওয়া, সব ডিভাইসে পড়ার তথ্য মিলিয়ে রাখা, আপনার নোট ও হাইলাইট দেখানো, অ্যাকাউন্ট চালানো এবং সেবার নিরাপত্তা রক্ষা করা।",
          "আমরা আপনার তথ্য বিক্রি করি না এবং বিজ্ঞাপনী ট্র্যাকার ব্যবহার করি না।",
        ],
      },
      {
        h: "কার সঙ্গে ভাগ হয়",
        p: [
          "সেবা চালানোর জন্য Supabase (ডেটাবেস, সাইন ইন ও ব্যক্তিগত ফাইল) এবং Cloudflare (ওয়েবসাইট ও বইয়ের ফাইল) ব্যবহার করা হয়।",
          "আপনি Google বা Facebook দিয়ে সাইন ইন করলে সেই প্রতিষ্ঠান আপনার পরিচয় যাচাই করে। Hardcover বা Readwise সংযোগ করলে শুধু আপনার নির্দেশে তাদের সঙ্গে তথ্য আদান-প্রদান হয়।",
          "আইনি বাধ্যবাধকতা বা আপনার নিরাপত্তার জন্য প্রয়োজন না হলে আমরা অন্য কারও সঙ্গে আপনার ব্যক্তিগত তথ্য ভাগ করি না।",
        ],
      },
      {
        h: "কতদিন রাখি",
        p: [
          "অ্যাকাউন্টের তথ্য রাখা হয় যতদিন অ্যাকাউন্ট থাকে। অ্যাকাউন্ট মুছলে আপনার ব্যক্তিগত তথ্য সঙ্গে সঙ্গে মুছে যায়; এনক্রিপ্টেড ব্যাকআপ সীমিত সময়ের জন্য পুরোনো কপি রাখতে পারে এবং তা অ্যাকাউন্ট ফিরিয়ে আনতে ব্যবহার করা হয় না।",
          "সার্ভার লগ নিরাপত্তা ও সমস্যা সমাধানের জন্য সীমিত সময় রাখা হয়, তারপর মুছে যায়।",
        ],
      },
      {
        h: "আপনার পছন্দ",
        list: [
          "প্রোফাইল পাতা থেকে যেকোনো সময় অ্যাকাউন্ট ও তার সব তথ্য মুছে ফেলুন।",
          "‘আমার নোট’ পাতা থেকে নিজের নোট ও হাইলাইট Markdown বা JSON-এ রপ্তানি করুন।",
          "প্রোফাইল থেকে Hardcover বা Readwise সংযোগ বিচ্ছিন্ন করুন।",
          "তথ্য দেখা, সংশোধন বা মুছে ফেলার অনুরোধ জানাতে নিচের ঠিকানায় ইমেইল করুন।",
        ],
      },
      {
        h: "কুকি ও ডিভাইস স্টোরেজ",
        p: [
          "সাইন ইন সেশন, ভাষা ও থিমের পছন্দ এবং অফলাইনে পড়ার জন্য এই সাইট আপনার ব্রাউজারে কুকি ও IndexedDB ব্যবহার করে। এগুলো সেবা চালানোর জন্য প্রয়োজন; বিজ্ঞাপনী কুকি নেই।",
        ],
      },
      {
        h: "শিশুদের বিষয়ে",
        p: [
          "এই সেবা ১৩ বছরের কম বয়সী শিশুদের জন্য তৈরি নয়। অভিভাবক হিসেবে মনে করেন কোনো শিশু অ্যাকাউন্ট খুলেছে, তাহলে নিচের ঠিকানায় যোগাযোগ করুন; আমরা অ্যাকাউন্টটি মুছে দেব।",
        ],
      },
      {
        h: "নীতির পরিবর্তন",
        p: [
          "নীতিতে বড় পরিবর্তন হলে এই পাতায় নতুন তারিখসহ প্রকাশ করা হবে। সাইন ইন করা থাকলে গুরুত্বপূর্ণ পরিবর্তনের কথা ইমেইলেও জানানো হতে পারে।",
        ],
      },
    ],
  },
  en: {
    title: "Privacy policy",
    lead: "What OpenBanglaBooks stores, why it stores it, and how you stay in control — briefly and in plain language.",
    updated: "Last updated: 10 November 2026",
    sections: [
      {
        h: "What we store",
        list: [
          "Account: your name, email address and a hash of your password (stored by Supabase Auth), or the identity details returned when you sign in with Google or Facebook.",
          "When you sign in: reading progress, bookmarks, highlights, notes, shelves, ratings and reading history.",
          "Books you upload and choose to keep in your account.",
          "Hardcover or Readwise access tokens, encrypted, when you connect those services.",
          "Server logs: IP address, browser, timestamps and error details, for security and troubleshooting.",
          "If you never create an account, your reading data stays only on your device and never reaches the server.",
        ],
      },
      {
        h: "Why we store it",
        p: [
          "To sign you in, keep your reading data in step across devices, show your notes and highlights, operate your account and keep the service secure.",
          "We do not sell your data and we do not use advertising trackers.",
        ],
      },
      {
        h: "Who it is shared with",
        p: [
          "Supabase (database, sign-in and private files) and Cloudflare (website and public book files) process data so the service can run.",
          "If you sign in with Google or Facebook, that provider verifies your identity. If you connect Hardcover or Readwise, data is exchanged with them only when you ask it to be.",
          "We do not share your personal data with anyone else unless the law requires it or it is necessary to protect your account or the service.",
        ],
      },
      {
        h: "How long we keep it",
        p: [
          "Account data stays while your account exists. Deleting your account removes it immediately; encrypted backups may keep an older copy for a limited period and are not used to restore your account.",
          "Server logs are kept for a limited period for security and troubleshooting, then deleted.",
        ],
      },
      {
        h: "Your choices",
        list: [
          "Delete your account and everything in it at any time from your profile.",
          "Export your notes and highlights as Markdown or JSON from My Notes.",
          "Disconnect Hardcover or Readwise from your profile.",
          "Email the address below to ask what we hold, correct it, or request deletion.",
        ],
      },
      {
        h: "Cookies and device storage",
        p: [
          "This site uses cookies and IndexedDB in your browser for your sign-in session, language and theme preferences, and offline reading. These are needed to run the service; there are no advertising cookies.",
        ],
      },
      {
        h: "Children",
        p: [
          "This service is not directed to children under 13. If you are a parent or guardian and believe a child has created an account, contact us at the address below and we will delete it.",
        ],
      },
      {
        h: "Changes to this policy",
        p: [
          "If this policy changes materially, the new version will be published here with a new date. If you are signed in, we may also tell you about important changes by email.",
        ],
      },
    ],
  },
} as const;

export default async function PrivacyPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const c = CONTENT[locale];
  return (
    <article className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6 sm:pt-14">
      <h1 className="text-4xl sm:text-5xl">{c.title}</h1>
      <p className="mt-4 text-lg leading-relaxed text-fg-muted">{c.lead}</p>

      <div className="mt-12 space-y-10">
        {c.sections.map((section) => (
          <section key={section.h}>
            <h2 className="text-2xl">{section.h}</h2>
            {"list" in section ? (
              <ul className="mt-4 list-disc space-y-2 pl-6 text-lg leading-relaxed text-fg-muted">
                {section.list.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}
            {"p" in section
              ? section.p.map((paragraph) => (
                  <p key={paragraph.slice(0, 24)} className="mt-3 text-lg leading-relaxed text-fg-muted">
                    {paragraph}
                  </p>
                ))
              : null}
          </section>
        ))}

        <section>
          <h2 className="text-2xl">{dict.footer.dataDeletionContact}</h2>
          <p className="mt-3 text-lg leading-relaxed text-fg-muted">
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-link underline-offset-4 hover:underline">
              {CONTACT_EMAIL}
            </a>
          </p>
          <p className="mt-3 text-lg leading-relaxed text-fg-muted">
            <Link href={localizedPath(locale, "/data-deletion")} className="text-link underline-offset-4 hover:underline">
              {dict.footer.dataDeletion}
            </Link>
          </p>
        </section>
      </div>

      <p className="mt-12 border-t border-line pt-6 text-sm text-fg-subtle">{c.updated}</p>
    </article>
  );
}
