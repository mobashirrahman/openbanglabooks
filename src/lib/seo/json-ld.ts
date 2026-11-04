import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import type { Locale } from "@/lib/i18n/config";
import type { Author, WorkDetail } from "@/lib/catalog/types";
import { absoluteUrl, siteUrl } from "./site";

/**
 * Schema.org builders. Every property mirrors content that is visible on the
 * page it is embedded in.
 */

export function websiteJsonLd(locale: Locale, dict: Dictionary) {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteUrl()}/#website`,
    name: dict.meta.siteName,
    alternateName: dict.meta.siteNameLocal,
    url: absoluteUrl(locale, "/"),
    inLanguage: locale === "bn" ? "bn" : "en",
    publisher: { "@id": `${siteUrl()}/#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${absoluteUrl(locale, "/search")}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

export function organizationJsonLd(dict: Dictionary) {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl()}/#organization`,
    name: dict.meta.siteName,
    alternateName: dict.meta.siteNameLocal,
    url: siteUrl(),
    logo: `${siteUrl()}/brand/logo.png`,
  };
}

export function bookJsonLd(work: WorkDetail, locale: Locale) {
  const url = absoluteUrl(locale, `/books/${work.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Book",
    "@id": `${absoluteUrl("bn", `/books/${work.slug}`)}#book`,
    name: work.title_bn,
    alternateName: work.title_en,
    url,
    inLanguage: "bn",
    author: work.authors.map((a) => ({
      "@type": "Person",
      name: a.name_bn,
      alternateName: a.name_en,
      url: absoluteUrl(locale, `/authors/${a.slug}`),
    })),
    datePublished: work.original_pub_year ? String(work.original_pub_year) : undefined,
    genre: work.genres.map((g) => (locale === "bn" ? g.name_bn : g.name_en)),
    description: (locale === "bn" ? work.description_bn : work.description_en) ?? undefined,
    image: `${siteUrl()}/og/books/${work.slug}.png`,
    isAccessibleForFree: true,
    workExample: work.edition
      ? {
          "@type": "Book",
          bookFormat: "https://schema.org/EBook",
          inLanguage: "bn",
          url: absoluteUrl(locale, `/read/${work.slug}`),
          publisher: work.edition.publisher ?? undefined,
          numberOfPages: undefined,
          license: work.edition.license_url ?? undefined,
          isAccessibleForFree: true,
        }
      : undefined,
  };
}

export function personJsonLd(author: Author, locale: Locale) {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: author.name_bn,
    alternateName: author.name_en,
    url: absoluteUrl(locale, `/authors/${author.slug}`),
    birthDate: author.born_year ? String(author.born_year) : undefined,
    deathDate: author.died_year ? String(author.died_year) : undefined,
    description: (locale === "bn" ? author.bio_bn : author.bio_en) ?? undefined,
    sameAs: [
      author.wikidata_id ? `https://www.wikidata.org/wiki/${author.wikidata_id}` : null,
      author.wikisource_url,
    ].filter(Boolean),
  };
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, item: item.url })),
  };
}
