import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n";
import { alternates } from "@/lib/seo/site";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: locale === "bn" ? "উৎস ও স্বত্ব — কোন বই এখানে থাকে" : "Sources and rights — what we publish",
    description:
      locale === "bn"
        ? "OpenBanglaBooks বাংলা বইয়ের সম্পূর্ণ পাঠ প্রকাশ করে, উৎস ও লাইসেন্সের তথ্যসহ। পাঠের উৎস ও যাচাইয়ের নিয়ম।"
        : "OpenBanglaBooks publishes complete Bengali texts with their sources and licences. Where the texts come from and how they are checked.",
    alternates: alternates(locale, "/about/sources", true),
  };
}

const CONTENT = {
  bn: {
    title: "উৎস ও স্বত্ব",
    sections: [
      {
        h: "কোন বই এখানে থাকে",
        p: [
          "OpenBanglaBooks-এ বাংলা বইয়ের সম্পূর্ণ পাঠ প্রকাশ করা হয়, উৎস ও লাইসেন্সের তথ্যসহ। প্রতিটি সংস্করণের উৎস, লাইসেন্স এবং প্রযোজ্য ক্ষেত্রে স্বত্বের বিবরণ সংরক্ষিত থাকে।",
          "প্রকাশের আগে পাঠের সম্পূর্ণতা যাচাই করা হয়: সব অধ্যায় থাকতে হবে এবং উইকিসংকলনের প্রতিটি স্ক্যান-পাতা সংশোধিত হতে হবে। যে বই অসম্পূর্ণ, সেটি প্রকাশ করা হয় না।",
        ],
      },
      {
        h: "পাঠ কোথা থেকে আসে",
        p: [
          "বইয়ের পাঠ নেওয়া হয় বাংলা উইকিসংকলন থেকে, যেখানে স্বেচ্ছাসেবকেরা পুরোনো মুদ্রিত বইয়ের স্ক্যান দেখে প্রতিটি পাতা টাইপ ও সংশোধন করেন। যে বইয়ের সব পাতা সংশোধিত হয়নি বা কোনো অধ্যায় বাদ আছে, সেটি এখানে প্রকাশ করা হয় না।",
          "উইকিসংকলনের প্রতিলিপি CC BY-SA 4.0 লাইসেন্সে প্রকাশিত। প্রতিটি বইয়ের শেষে ব্যবহৃত পাতার স্থায়ী সংস্করণ-লিংক দেওয়া থাকে।",
        ],
      },
      {
        h: "প্রচ্ছদ",
        p: ["যে সংস্করণে পরিষ্কার প্রচ্ছদ-শিল্প আছে, সেখানেই সেটি ব্যবহার করা হয়। প্রচ্ছদ না থাকলে বইয়ের তথ্য থেকে OpenBanglaBooks-এর নিজস্ব নকশা তৈরি হয়।"],
      },
      {
        h: "ভুল চোখে পড়লে",
        p: ["পাঠে ভুল পেলে উইকিসংকলনে সংশোধন করা যায়; পরের হালনাগাদে সেটি এখানেও চলে আসবে।"],
      },
    ],
  },
  en: {
    title: "Sources and rights",
    sections: [
      {
        h: "What we publish",
        p: [
          "OpenBanglaBooks publishes complete Bengali texts, with each edition's source and licence recorded.",
          "Before publication the text is checked for completeness: every chapter must be present and every Wikisource scan page proofread. Incomplete books are not published.",
        ],
      },
      {
        h: "Where the texts come from",
        p: [
          "Texts come from Bengali Wikisource, where volunteers type and proofread every page against scans of the original printed books. A book with unproofread pages or missing chapters is not published here.",
          "Wikisource transcriptions are licensed CC BY-SA 4.0. The end of every book lists permanent links to the exact page revisions used.",
        ],
      },
      { h: "Covers", p: ["Where an edition comes with clean cover artwork, that cover is used. Books without usable art get an original OpenBanglaBooks design generated from the book's details."] },
      { h: "Found a mistake?", p: ["Corrections can be made on Wikisource; they reach this site with the next update."] },
    ],
  },
} as const;

export default async function SourcesPage() {
  const locale = await getLocale();
  const c = CONTENT[locale];
  return (
    <article className="mx-auto max-w-3xl px-4 pt-10 sm:px-6 sm:pt-14">
      <h1 className="text-4xl sm:text-5xl">{c.title}</h1>
      <div className="mt-10 space-y-10">
        {c.sections.map((s) => (
          <section key={s.h}>
            <h2 className="text-2xl">{s.h}</h2>
            {s.p.map((p) => (
              <p key={p.slice(0, 20)} className="mt-3 text-lg leading-relaxed text-fg-muted">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
