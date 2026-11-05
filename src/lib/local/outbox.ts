import type { DBCore, DBCoreMutateRequest, DBCoreMutateResponse, Middleware } from "dexie";

/**
 * Change capture for sync. A Dexie middleware sits under every table: each
 * local write to a synced table also records "this row changed" in the
 * `outbox` table, in the same IndexedDB transaction (so the two can never
 * disagree), and stamps the row with `updatedAt`. Code that writes data does
 * not need to know about sync at all.
 *
 * Writes that come *from* the server (pull) run in transactions marked
 * untracked, so they are not sent back.
 */

/** Local tables whose rows sync to the account. */
export const SYNCED_TABLES = ["library", "shelves", "shelfItems", "positions", "bookmarks", "annotations", "settings", "days"] as const;
export type SyncedTable = (typeof SYNCED_TABLES)[number];
const SYNCED = new Set<string>(SYNCED_TABLES);

/** One pending change, coalesced per row: only the row's latest state is pushed. */
export type OutboxEntry = {
  key: string;
  t: SyncedTable;
  pk: string;
  changedAt: number;
  deleted: boolean;
  /** for deletions: the server version the row had, so the server can tell an informed delete from a stale one */
  base?: number;
};

export const outboxKey = (t: string, pk: unknown) => `${t}|${String(pk)}`;

let last = 0;
/** Milliseconds that never repeat or go backwards in this page, so two quick edits never tie. */
export function stamp(): number {
  const now = Date.now();
  last = now > last ? now : last + 1;
  return last;
}

const UNTRACKED = Symbol.for("obb:untracked");

/** Marks a Dexie transaction (its `idbtrans`) as applying server data: no outbox entries. */
export function markUntracked(idbtrans: unknown) {
  (idbtrans as Record<symbol, boolean>)[UNTRACKED] = true;
}

function untracked(trans: unknown) {
  const t = trans as (Record<symbol, boolean> & { mode?: string }) | undefined;
  // schema upgrades are not reader changes either
  return Boolean(t?.[UNTRACKED]) || t?.mode === "versionchange";
}

export const outboxMiddleware: Middleware<DBCore> = {
  stack: "dbcore",
  name: "obb-outbox",
  create(down) {
    return {
      ...down,
      transaction(stores, mode, options) {
        const scope = mode === "readwrite" && stores.some((s) => SYNCED.has(s)) && !stores.includes("outbox") ? [...stores, "outbox"] : stores;
        return down.transaction(scope, mode, options);
      },
      table(name) {
        const table = down.table(name);
        if (!SYNCED.has(name)) return table;
        const primaryKey = table.schema.primaryKey;
        const keyOf = (v: unknown) => primaryKey.extractKey!(v);

        return {
          ...table,
          async mutate(req: DBCoreMutateRequest): Promise<DBCoreMutateResponse> {
            if (untracked(req.trans)) return table.mutate(req);
            const outbox = down.table("outbox");
            const now = stamp();

            if (req.type === "add" || req.type === "put") {
              const values = req.values.map((v) => ({ ...v, updatedAt: now }));
              const res = await table.mutate({ ...req, values });
              // Dexie passes an empty key list for inline keys
              const keys = req.keys && req.keys.length === values.length ? req.keys : values.map(keyOf);
              const entries = keys
                .filter((_, i) => !res.failures[i])
                .map((k): OutboxEntry => ({ key: outboxKey(name, k), t: name as SyncedTable, pk: String(k), changedAt: now, deleted: false }));
              if (entries.length) await outbox.mutate({ type: "put", trans: req.trans, values: entries });
              return res;
            }

            const keys: unknown[] =
              req.type === "delete"
                ? req.keys
                : (await table.query({ trans: req.trans, values: false, query: { index: primaryKey, range: req.range } })).result;
            const before: ({ serverUpdatedAt?: number } | undefined)[] = keys.length ? await table.getMany({ trans: req.trans, keys }) : [];
            const res = await table.mutate(req);
            const entries = keys
              .map((k, i): OutboxEntry | null =>
                before[i] ? { key: outboxKey(name, k), t: name as SyncedTable, pk: String(k), changedAt: now, deleted: true, base: before[i]!.serverUpdatedAt } : null,
              )
              .filter((e): e is OutboxEntry => e !== null);
            if (entries.length) await outbox.mutate({ type: "put", trans: req.trans, values: entries });
            return res;
          },
        };
      },
    };
  },
};
