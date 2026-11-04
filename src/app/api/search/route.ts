import { NextResponse, type NextRequest } from "next/server";
import { listWorks, searchCatalog } from "@/lib/catalog/queries";
import { formatYearRange } from "@/lib/i18n/format";
import type { WorkSummary } from "@/lib/catalog/types";

export type SearchResponse = {
  works: Pick<WorkSummary, "slug" | "title_bn" | "subtitle_bn" | "title_en" | "cover_variant" | "authors">[];
  authors: { slug: string; name_bn: string; name_en: string; years: string | null }[];
};

/** Catalog search for the search dialog. Public data only; short HTTP caching. */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const locale = request.nextUrl.searchParams.get("lang") === "en" ? "en" : "bn";
  const [hits, works] = await Promise.all([searchCatalog(q, 12), listWorks()]);
  const bySlug = new Map(works.map((w) => [w.slug, w]));
  const body: SearchResponse = { works: [], authors: [] };
  for (const h of hits) {
    if (h.kind === "work") {
      const w = bySlug.get(h.slug);
      if (w)
        body.works.push({
          slug: w.slug,
          title_bn: w.title_bn,
          subtitle_bn: w.subtitle_bn,
          title_en: w.title_en,
          cover_variant: w.cover_variant,
          authors: w.authors,
        });
    } else {
      const [born, died] = (h.subtitle ?? "").split("–").map((x) => (x ? Number(x) : null));
      body.authors.push({
        slug: h.slug,
        name_bn: h.title_bn,
        name_en: h.title_en,
        years: born || died ? formatYearRange(born ?? null, died ?? null, locale) : null,
      });
    }
  }
  return NextResponse.json(body, {
    headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=3600" },
  });
}
