import type { Metadata } from "next";
import Link from "next/link";
import { getDictionary, getLocale } from "@/lib/i18n";
import { localizedPath } from "@/lib/i18n/config";
import { alternates } from "@/lib/seo/site";
import { CONTACT_EMAIL } from "@/lib/contact";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: locale === "bn" ? "আপনার তথ্য মুছে ফেলুন" : "Delete your data",
    description:
      locale === "bn"
        ? "OpenBanglaBooks অ্যাকাউন্ট এবং এতে রাখা পড়ার তথ্য, নোট, হাইলাইট ও সংযোগ কীভাবে মুছে ফেলবেন।"
        : "How to delete your OpenBanglaBooks account and the reading data, notes, highlights and connections stored with it.",
    alternates: alternates(locale, "/data-deletion", true),
  };
}

const CONTENT = {
  bn: {
    title: "আপনার তথ্য মুছে ফেলুন",
    lead: "OpenBanglaBooks-এ অ্যাকাউন্ট খুললে আপনার পড়ার অগ্রগতি, বুকমার্ক, হাইলাইট, নোট ও তাক আপনার অ্যাকাউন্টে রাখা হয়। আপনি যেকোনো সময় অ্যাকাউন্টটি এবং তার সব তথ্য মুছে ফেলতে পারেন।",
    deleteNow: "প্রোফাইলে গিয়ে অ্যাকাউন্ট মুছুন",
    sections: [
      {
        h: "অ্যাপ থেকে মুছে ফেলুন",
        steps: [
          "আপনার অ্যাকাউন্টে সাইন ইন করুন।",
          "প্রোফাইল পাতায় যান।",
          "‘অ্যাকাউন্ট’ অংশে ‘অ্যাকাউন্ট মুছুন’ বেছে নিন।",
          "‘হ্যাঁ, মুছে ফেলুন’ নিশ্চিত করুন। অ্যাকাউন্ট, প্রোফাইল এবং সিঙ্ক করা সব তথ্য সঙ্গে সঙ্গে মুছে যাবে; এই ডিভাইসে রাখা অ্যাকাউন্টের কপিও সরে যাবে।",
        ],
      },
      {
        h: "যা মুছে যায়",
        list: [
          "নাম ও ইমেইল ঠিকানা",
          "পড়ার অগ্রগতি, বুকমার্ক, হাইলাইট, নোট ও পড়ার ইতিহাস",
          "তাক, রেটিং ও ব্যক্তিগত সংগ্রহ",
          "অ্যাকাউন্টে রাখা নিজের আপলোড করা বই",
          "Hardcover ও Readwise সংযোগ এবং সংরক্ষিত টোকেন",
        ],
      },
      {
        h: "যা থেকে যায়",
        p: [
          "এই ডিভাইসে ডাউনলোড করা বইয়ের ফাইল অ্যাকাউন্টের অংশ নয়, তাই সেগুলো থেকে যায়। চাইলে ব্রাউজারের সাইট ডেটা বা অ্যাপের ডাউনলোড করা বই আলাদা করে মুছে ফেলতে পারেন।",
          "অ্যাকাউন্ট না খুলে শুধু এই ডিভাইসে রাখা পড়ার তথ্য সার্ভারে যায় না, তাই সেখানে মুছে ফেলার মতো কিছু থাকে না।",
          "সার্ভারের এনক্রিপ্টেড ব্যাকআপ কিছু সময়ের জন্য পুরোনো কপি রাখতে পারে; মেয়াদ শেষে সেগুলো মুছে যায় এবং অ্যাকাউন্ট ফিরিয়ে আনতে ব্যবহার করা হয় না।",
        ],
      },
      {
        h: "সাইন ইন করতে না পারলে",
        p: [
          "অ্যাকাউন্টে ঢুকতে না পারলে অ্যাকাউন্টের ইমেইল ঠিকানা থেকেই নিচের ঠিকানায় ‘Delete my account’ বিষয়সহ লিখুন। আমরা পরিচয় যাচাই করে যত দ্রুত সম্ভব, সাধারণত সাত দিনের মধ্যে, অ্যাকাউন্টটি মুছে দেব।",
        ],
      },
      {
        h: "Facebook বা Google দিয়ে সাইন ইন করলে",
        p: [
          "OpenBanglaBooks অ্যাকাউন্ট মুছলে আমাদের কাছে রাখা সংযোগ ও তথ্য মুছে যায়, কিন্তু আপনার Facebook বা Google অ্যাকাউন্ট মুছে যায় না। অ্যাপটিকে আপনার অ্যাকাউন্ট থেকে সরাতে Facebook-এ Settings ও privacy → Settings → Apps and Websites এবং Google-এ Security → Third-party apps with account access থেকে OpenBanglaBooks সরিয়ে দিন।",
        ],
      },
    ],
    updated: "সর্বশেষ হালনাগাদ: ১০ নভেম্বর ২০২৬",
  },
  en: {
    title: "Delete your data",
    lead: "When you create an OpenBanglaBooks account, your reading progress, bookmarks, highlights, notes and shelves are stored with it. You can delete the account and everything in it at any time.",
    deleteNow: "Go to your profile to delete your account",
    sections: [
      {
        h: "Delete it from the app",
        steps: [
          "Sign in to your account.",
          "Open your profile page.",
          "In the Account section, choose “Delete account”.",
          "Confirm with “Yes, delete it”. The account, profile and all synced data are deleted immediately, and this device's copy of the account data is removed too.",
        ],
      },
      {
        h: "What is deleted",
        list: [
          "Your name and email address",
          "Reading progress, bookmarks, highlights, notes and reading history",
          "Shelves, ratings and personal collections",
          "Books you uploaded and kept in your account",
          "Hardcover and Readwise connections and their stored tokens",
        ],
      },
      {
        h: "What remains",
        p: [
          "Books downloaded to this device are not part of your account, so their files stay. You can remove them separately by clearing this site's data or deleting the downloaded books in the app.",
          "Reading data kept only on this device, without an account, never reaches the server, so there is nothing there to delete.",
          "Encrypted server backups may hold an older copy for a limited period before they expire; they are not used to restore your account.",
        ],
      },
      {
        h: "If you cannot sign in",
        p: [
          "If you can no longer access the account, email the address below from the address on the account with the subject “Delete my account”. We will verify the request and delete the account as soon as possible, normally within seven days.",
        ],
      },
      {
        h: "If you signed in with Facebook or Google",
        p: [
          "Deleting your OpenBanglaBooks account removes the connection and the data we hold, but it does not delete your Facebook or Google account. To remove the app from those accounts, use Facebook's Settings & privacy → Settings → Apps and Websites and Google's Security → Third-party apps with account access.",
        ],
      },
    ],
    updated: "Last updated: 10 November 2026",
  },
} as const;

export default async function DataDeletionPage() {
  const locale = await getLocale();
  const dict = await getDictionary(locale);
  const c = CONTENT[locale];
  return (
    <article className="mx-auto max-w-3xl px-4 pt-10 pb-16 sm:px-6 sm:pt-14">
      <h1 className="text-4xl sm:text-5xl">{c.title}</h1>
      <p className="mt-4 text-lg leading-relaxed text-fg-muted">{c.lead}</p>
      <Link
        href={localizedPath(locale, "/profile")}
        className="mt-8 inline-flex h-12 items-center rounded-control bg-cloth px-6 text-on-cloth hover:bg-cloth-raised"
      >
        {c.deleteNow}
      </Link>

      <div className="mt-12 space-y-10">
        {c.sections.map((section) => (
          <section key={section.h}>
            <h2 className="text-2xl">{section.h}</h2>
            {"steps" in section ? (
              <ol className="mt-4 list-decimal space-y-2 pl-6 text-lg leading-relaxed text-fg-muted">
                {section.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            ) : null}
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
        </section>
      </div>

      <p className="mt-12 border-t border-line pt-6 text-sm text-fg-subtle">{c.updated}</p>
    </article>
  );
}
