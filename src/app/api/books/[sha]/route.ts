import { connection } from "next/server";
import { cacheLife, cacheTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { CATALOG_TAG } from "@/lib/catalog/queries";
import { getBookFile, hasBookBucket } from "@/lib/storage";

/**
 * Serves a published EPUB from the same origin, so the reader's strict CSP
 * (connect-src 'self') applies and the service worker can cache it later.
 * Files are content-addressed (sha256), so responses are immutable.
 */
const SHA = /^[0-9a-f]{64}$/;

async function storagePathFor(sha: string): Promise<string | null> {
  "use cache";
  cacheLife("days");
  cacheTag(CATALOG_TAG);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  // RLS: only files of published editions are visible to the anon role
  const { data } = await supabase.from("book_files").select("storage_path").eq("sha256", sha).maybeSingle();
  return data?.storage_path ?? null;
}

export async function GET(_request: Request, { params }: RouteContext<"/api/books/[sha]">) {
  await connection();
  const { sha } = await params;
  if (!SHA.test(sha)) return new Response("Not found", { status: 404 });
  const path = await storagePathFor(sha);
  if (!path) return new Response("Not found", { status: 404 });

  // R2 first; fall back to the old Supabase bucket while files are migrated.
  const object = await getBookFile(path);
  const debugHeaders = { "X-R2-Binding": hasBookBucket() ? "yes" : "no", "X-R2": object ? "hit" : "miss" };
  if (object) {
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/epub+zip",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "Content-Disposition": `inline; filename="${sha.slice(0, 12)}.epub"`,
        ...(object.httpEtag ? { ETag: object.httpEtag } : {}),
        ...debugHeaders,
      },
    });
  }

  const upstream = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/books/${encodeURIComponent(path)}`,
  );
  if (!upstream.ok || !upstream.body) return new Response("Unavailable", { status: 502, headers: debugHeaders });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/epub+zip",
      "Content-Length": upstream.headers.get("content-length") ?? "",
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `inline; filename="${sha.slice(0, 12)}.epub"`,
    },
  });
}
