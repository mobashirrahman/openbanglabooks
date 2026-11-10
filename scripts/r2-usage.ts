/**
 * Prints R2 storage usage against the free-tier guard.
 *
 *   pnpm storage:usage
 */
import { bucketUsage, R2_STORAGE_LIMIT_BYTES } from "./lib/r2.ts";

const used = bucketUsage();
const limit = R2_STORAGE_LIMIT_BYTES;
const pct = (used / limit) * 100;
console.log(`R2 storage: ${(used / 1000 ** 3).toFixed(3)} GB used of ${(limit / 1000 ** 3).toFixed(1)} GB guard (${pct.toFixed(1)}%)`);
console.log(`Remaining:  ${((limit - used) / 1000 ** 2).toFixed(0)} MB before uploads are refused`);
