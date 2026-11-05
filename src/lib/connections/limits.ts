/** Highlights per request to Readwise (its API takes a list; we keep requests modest). */
export const READWISE_BATCH = 100;

/**
 * Hardcover's rate limit is a token bucket: 10 tokens on the free plan,
 * refilled at 60 a minute, and every top-level field of a GraphQL request
 * costs one. So one call from the browser spends at most the bucket, the
 * server reports what it spent, and the browser waits that many seconds
 * before the next call.
 */
export const HARDCOVER_BUCKET = 10;
/** Searches per call: one field each. */
export const HARDCOVER_FIND_BATCH = HARDCOVER_BUCKET;
/** Books per send: one field each, plus one to see what is already there. */
export const HARDCOVER_SEND_BATCH = HARDCOVER_BUCKET - 1;
/** Seconds for the bucket to refill one token. */
export const HARDCOVER_REFILL_SECONDS = 1;
