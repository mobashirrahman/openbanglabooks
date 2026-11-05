import { createHash } from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { AdminError, requireEditor } from "@/lib/admin/auth";
import { CATALOG_TAG } from "@/lib/catalog/queries";
import { LIMITS, validateEpub } from "@/lib/epub/validate";
import { countChapters, readToc } from "@/lib/epub/toc";

/**
 * POST /api/admin/epub?edition=<uuid>, body: the EPUB file.
 *
 * A route handler rather than a server action: books can be tens of MB,
 * past the limits of server action bodies and of proxy body buffering
 * (/api is outside the proxy). The file is validated before anything is
 * stored, stored content-addressed (books/<sha256>.epub), then becomes the
 * edition's current file, all as the signed-in editor (storage and table
 * policies check the role again).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (status: number, error: string, details?: string[]) => NextResponse.json({ error, details }, { status });

/** Reads the body, refusing to buffer more than the EPUB limit. */
async function readCapped(request: NextRequest, max: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > max) return null;
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function POST(request: NextRequest) {
  // same-site requests only (server actions get this check from Next; this handler does it itself)
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return fail(403, "cross-site");

  let editor;
  try {
    editor = await requireEditor();
  } catch (e) {
    if (e instanceof AdminError) return fail(e.code === "signed-out" ? 401 : 403, e.code);
    throw e;
  }

  const edition = request.nextUrl.searchParams.get("edition") ?? "";
  if (!UUID.test(edition)) return fail(400, "edition");

  const bytes = await readCapped(request, LIMITS.maxBytes);
  if (!bytes) return fail(413, "too-large");
  if (!bytes.byteLength) return fail(400, "empty");

  const report = validateEpub(bytes);
  if (!report.ok) return fail(422, "invalid", report.errors);

  const sha = createHash("sha256").update(bytes).digest("hex");
  const toc = readToc(bytes);
  const { supabase } = editor;

  const { error: upErr } = await supabase.storage
    .from("books")
    .upload(`${sha}.epub`, bytes, { contentType: "application/epub+zip", upsert: true, cacheControl: "31536000" });
  if (upErr) {
    console.error("epub upload", upErr);
    return fail(502, "storage");
  }

  const { data: fileId, error } = await supabase.rpc("admin_add_book_file", {
    p_edition: edition,
    p_sha: sha,
    p_bytes: bytes.byteLength,
    p_version: report.version ?? null,
    p_report: { errors: report.errors, warnings: report.warnings, entries: report.entries, title: report.title ?? null },
    p_toc: toc,
    p_chapters: countChapters(toc),
  });
  if (error) {
    if (error.code === "23505") return fail(409, "elsewhere");
    if (error.code === "P0002") return fail(404, "edition");
    console.error("book file", error);
    return fail(500, "failed");
  }

  revalidateTag(CATALOG_TAG, { expire: 0 });
  return NextResponse.json({ id: fileId, sha256: sha, bytes: bytes.byteLength, chapters: countChapters(toc), warnings: report.warnings });
}
