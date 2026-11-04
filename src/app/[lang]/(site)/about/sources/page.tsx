import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n";
import { alternates } from "@/lib/seo/site";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: locale === "bn" ? "উৎস ও স্বত্ব — কোন বই এখানে থাকে" : "Sources and rights — what we publish",
    description:
      locale === "bn"
        ? "OpenBanglaBooks কেবল স্বত্বমুক্ত বা উন্মুক্ত লাইসেন্সের বাংলা বই প্রকাশ করে। পাঠের উৎস, লাইসেন্স ও যাচাইয়ের নিয়ম।"
        : "OpenBanglaBooks publishes only public-domain or openly licensed Bengali books. Where texts come from, licences and how rights are checked.",
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
          "OpenBanglaBooks-এ কেবল সেই বই প্রকাশ করা হয়, যেগুলো বাংলাদেশ, ভারত ও যুক্তরাষ্ট্র — তিন জায়গাতেই স্বত্বমুক্ত, অথবা যেগুলোর লেখক বা প্রকাশক উন্মুক্ত লাইসেন্সে প্রকাশের অনুমতি দিয়েছেন।",
          "আমাদের নিয়ম: লেখকের মৃত্যুর পর ৬০ বছর পার হতে হবে (বাংলাদেশ ও ভারতের আইন), এবং বইটি প্রথম প্রকাশিত হতে হবে যুক্তরাষ্ট্রের স্বত্বসীমার আগে (২০২৬ সালে, ১৯৩১-এর আগে)। প্রতিটি বইয়ের ক্ষেত্রে এই যাচাইয়ের ভিত্তি আর যাচাইকারীর নাম সংরক্ষণ করা হয়।",
          "এই কারণেই কাজী নজরুল ইসলামের রচনা এখনও এখানে নেই: তাঁর মৃত্যু ১৯৭৬ সালে, তাই বাংলাদেশ ও ভারতে ২০৩৬ সালের শেষ পর্যন্ত তাঁর লেখা স্বত্বাধীন।",
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
        p: ["সব প্রচ্ছদ OpenBanglaBooks-এর নিজস্ব নকশা, বইয়ের তথ্য থেকে তৈরি। কোনো প্রকাশকের প্রচ্ছদ বা অন্যের আঁকা ছবি ব্যবহার করা হয় না।"],
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
          "OpenBanglaBooks publishes only books that are in the public domain in Bangladesh, India and the United States, or that their authors or publishers have released under an open licence.",
          "Our rule: at least 60 years must have passed since the author's death (the term in Bangladesh and India), and the book must have been first published before the US cut-off (before 1931, as of 2026). The basis and the reviewer are recorded for every book.",
          "This is why Kazi Nazrul Islam's works are not here yet: he died in 1976, so his writing remains in copyright in Bangladesh and India until the end of 2036.",
        ],
      },
      {
        h: "Where the texts come from",
        p: [
          "Texts come from Bengali Wikisource, where volunteers type and proofread every page against scans of the original printed books. A book with unproofread pages or missing chapters is not published here.",
          "Wikisource transcriptions are licensed CC BY-SA 4.0. The end of every book lists permanent links to the exact page revisions used.",
        ],
      },
      { h: "Covers", p: ["All covers are original OpenBanglaBooks designs generated from each book's details. No publisher covers or third-party artwork are used."] },
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
