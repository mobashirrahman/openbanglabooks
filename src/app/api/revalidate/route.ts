import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { CATALOG_TAG } from "@/lib/catalog/queries";

/**
 * Marks the cached catalog stale after ingestion or admin edits.
 * POST with header `Authorization: Bearer <REVALIDATE_SECRET>`.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.REVALIDATE_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const ok =
    Boolean(secret) &&
    given.length === secret!.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(secret!));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  revalidateTag(CATALOG_TAG, "max");
  return NextResponse.json({ revalidated: CATALOG_TAG });
}
