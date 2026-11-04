/** Usage: tsx scripts/ingest/check.ts "<root title>" ... — reports completeness. */
import { resolveSource, qualitySummary } from "./sources.ts";
for (const root of process.argv.slice(2)) {
  try {
    const src = await resolveSource({ root });
    const q = qualitySummary(src.chapters);
    const chars = src.chapters.reduce((n, c) => n + c.page.html.replace(/<[^>]+>/g, "").length, 0);
    const parts = [...new Set(src.chapters.map((c) => c.part).filter(Boolean))];
    console.log(JSON.stringify({ root: src.rootTitle, chapters: src.chapters.length, parts, ...q, chars, index: src.indexTitle, meta: src.index && Object.fromEntries(Object.entries(src.index).filter(([k]) => /নাম|লেখক|প্রকাশক|প্রকাশ|সংস্করণ|উৎস|প্রগতি/.test(k))) }));
  } catch (e) { console.log(JSON.stringify({ root, error: (e as Error).message })); }
}
