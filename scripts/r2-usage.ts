/**
 * Prints R2 storage usage against the free-tier guard.
 *
 *   pnpm storage:usage
 */
import { bucketUsage, R2_STORAGE_LIMIT_BYTES } from "./lib/r2.ts";

const used = bucketUsage();
const limit = R2_STORAGE_LIMIT_BYTES;
const pct = (used / limit) * 100;
console.log(`R2 storage: ${(used / 1024 ** 3).toFixed(3)} GiB used of ${(limit / 1024 ** 3).toFixed(1)} GiB guard (${pct.toFixed(1)}%)`);
console.log(`Remaining:  ${((limit - used) / 1024 ** 2).toFixed(0)} MiB before uploads are refused`);
