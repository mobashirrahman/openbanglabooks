import { readFile } from "node:fs/promises";
import path from "node:path";
import { connection } from "next/server";

let buildId: Promise<string> | null = null;
/** The id of the running build: a new build gives the browser a new worker, which refreshes the kept pages. */
function currentBuild(): Promise<string> {
  buildId ??= readFile(path.join(process.cwd(), process.env.NEXT_DIST_DIR || ".next", "BUILD_ID"), "utf8")
    .then((s) => s.trim().replace(/[^\w-]/g, "") || "dev")
    .catch(() => "dev");
  return buildId;
}

/**
 * The service worker's entry script. Its logic lives in /sw-core.js (a plain
 * script in public/); this tiny script names the build, so each deployment
 * installs a new worker. Served fresh every time (no HTTP caching), as the
 * browser compares it byte for byte to decide whether to update.
 */
export async function GET() {
  await connection();
  const build = await currentBuild();
  const body = `self.OBB_BUILD=${JSON.stringify(build)};importScripts(${JSON.stringify(`/sw-core.js?v=${build}`)});\n`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'",
      "Service-Worker-Allowed": "/",
    },
  });
}
