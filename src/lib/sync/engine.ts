"use client";

import { liveQuery } from "dexie";
import type { SupabaseClient } from "@supabase/supabase-js";
import { localDB, markHasProgress, type Annotation, type ReadingPosition, type RemotePosition } from "@/lib/local/db";
import { markUntracked, outboxKey, SYNCED_TABLES, type OutboxEntry } from "@/lib/local/outbox";
import { clearAccountData } from "@/lib/local/wipe";
import { getSupabase, onAccountChange, signOut } from "@/lib/account/session";
import { READER_SETTINGS_KEY } from "@/lib/reader/settings";
import { thisDevice, type Device } from "./device";
import { decide, type LocalState } from "./merge";
import { fromServer, toChange, toDeletion, type Change, type ServerRow, type ServerTable } from "./tables";
import { setSyncStatus } from "./status";

/**
 * The sync engine. While a reader is signed in it keeps this device and the
 * account in step:
 *
 *   push   pending local changes (the outbox) → sync_push, in batches
 *   pull   everything after our cursor        → sync_pull, in whole versions
 *
 * Push always runs before pull, so the server resolves almost every conflict
 * (atomically); the local merge rules only cover edits made mid-sync.
 * Triggers: sign-in, local edits (debounced), focus, coming online, a
 * one-minute interval while visible. One tab syncs at a time (Web Locks).
 */

const PUSH_BATCH = 200;
const PULL_PAGE = 1000;
const INTERVAL = 60_000;

let started = false;
let user: string | null = null;
let paused = false;
let running: Promise<void> | null = null;
let again = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let failures = 0;

class Stopped extends Error {}

export function startSync() {
  if (started) return;
  started = true;
  onAccountChange((s) => {
    if (s.status === "signed-in") {
      if (user === s.user.id) return;
      user = s.user.id;
      requestSync();
    } else if (s.status === "signed-out") {
      user = null;
      setSyncStatus({ phase: "off" });
    }
  });
  window.addEventListener("online", () => requestSync());
  window.addEventListener("offline", () => user && setSyncStatus({ phase: "offline" }));
  // coming back to the tab, and leaving it (hand the latest place to the next device)
  document.addEventListener("visibilitychange", () => requestSync());
  window.addEventListener("obb:sync-now", () => requestSync());
  setInterval(() => document.visibilityState === "visible" && requestSync(), INTERVAL);
  liveQuery(() => localDB().outbox.count()).subscribe({
    next: (n) => {
      setSyncStatus({ pending: n });
      if (n > 0) schedule(1500);
    },
    error: () => {},
  });
}

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    requestSync();
  }, ms);
}

export function requestSync(): Promise<void> {
  if (!user || paused) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  const run: Promise<void> = withLock(syncOnce).finally(() => {
    running = null;
    if (again) {
      again = false;
      void requestSync();
    }
  });
  running = run;
  return run;
}

/** Syncs now and waits for it (for "sync now" buttons and sign-out). */
export async function syncNow() {
  await requestSync();
  if (again || running) await requestSync();
}

export async function pendingChanges(): Promise<number> {
  return localDB().outbox.count();
}

async function withLock(fn: () => Promise<void>): Promise<void> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks) await locks.request("obb-sync", fn);
  else await fn();
}

async function syncOnce() {
  const uid = user;
  if (!uid || paused) return;
  if (!navigator.onLine) {
    setSyncStatus({ phase: "offline" });
    return;
  }
  setSyncStatus({ phase: "syncing" });
  try {
    const sb = await getSupabase();
    const device = await thisDevice();
    await ensureOwner(uid);
    await push(sb, device, uid);
    await pull(sb, device, uid);
    failures = 0;
    const now = Date.now();
    await localDB().meta.put({ key: "last-synced", value: now });
    setSyncStatus({ phase: "idle", lastSyncedAt: now });
  } catch (e) {
    if (e instanceof Stopped) return;
    failures++;
    const offline = !navigator.onLine || isNetworkError(e);
    setSyncStatus({ phase: offline ? "offline" : "error" });
    if (!offline) console.warn("[sync]", e);
    // back off: 5 s, 10 s, 20 s … at most 5 minutes
    schedule(Math.min(300_000, 5000 * 2 ** Math.min(failures - 1, 6)));
  }
}

function checkStillSignedIn(uid: string) {
  if (user !== uid || paused) throw new Stopped();
}

function isNetworkError(e: unknown) {
  const m = String((e as { message?: string })?.message ?? e).toLowerCase();
  return m.includes("fetch") || m.includes("network") || m.includes("load failed");
}

// ── ownership: whose data is on this device ─────────────────────────────

/**
 * The first sign-in on a device claims the data read without an account
 * (guest data): every local row is queued for push. If the data belongs to
 * a different account, it is removed first.
 */
async function ensureOwner(uid: string) {
  const db = localDB();
  const owner = (await db.meta.get("owner"))?.value as string | undefined;
  if (owner === uid) return;
  if (owner) await clearAccountData();
  const now = Date.now();
  await db.transaction("rw", [...SYNCED_TABLES.map((t) => db.table(t)), db.outbox, db.meta], async () => {
    for (const t of SYNCED_TABLES) {
      const keys = (await db.table(t).toCollection().primaryKeys()) as string[];
      await db.outbox.bulkPut(keys.map((pk): OutboxEntry => ({ key: outboxKey(t, pk), t, pk: String(pk), changedAt: now, deleted: false })));
    }
    await db.meta.bulkPut([
      { key: "owner", value: uid },
      { key: "sync-cursor", value: 0 },
    ]);
  });
}

// ── push ────────────────────────────────────────────────────────────────

async function push(sb: SupabaseClient, device: Device, uid: string) {
  const db = localDB();
  for (let round = 0; round < 500; round++) {
    checkStillSignedIn(uid);
    const entries = await db.outbox.orderBy("changedAt").limit(PUSH_BATCH).toArray();
    if (!entries.length) return;
    const changes: Change[] = [];
    for (const entry of entries) {
      if (entry.deleted) {
        const c = toDeletion(entry, device);
        if (c) changes.push(c);
        continue;
      }
      const row = await db.table(entry.t).get(entry.pk);
      const c = row ? toChange(entry.t, row, entry.pk, device) : null;
      if (c) changes.push(c);
    }
    if (changes.length) await pushChanges(sb, changes);
    // done with these entries, unless the row changed again meanwhile
    await db.transaction("rw", db.outbox, async () => {
      for (const e of entries) {
        const current = await db.outbox.get(e.key);
        if (current && current.changedAt === e.changedAt) await db.outbox.delete(e.key);
      }
    });
  }
}

const isDataError = (e: { code?: string } | null) => Boolean(e?.code && /^(22|23)/.test(e.code));

async function pushChanges(sb: SupabaseClient, changes: Change[]) {
  const { error } = await sb.rpc("sync_push", { changes });
  if (!error) return;
  if (!isDataError(error)) throw error;
  // one bad row must not block the rest: send them one by one and set aside
  // the ones the server refuses (logged, never retried forever)
  for (const c of changes) {
    const res = await sb.rpc("sync_push", { changes: [c] });
    if (res.error && !isDataError(res.error)) throw res.error;
    if (res.error) console.warn("[sync] change refused", c.t, c.id, res.error.message);
  }
}

// ── pull ────────────────────────────────────────────────────────────────

type PullPage = { rows: { t: ServerTable; r: ServerRow }[]; version: number; more: boolean };

async function pull(sb: SupabaseClient, device: Device, uid: string) {
  const db = localDB();
  let since = Number((await db.meta.get("sync-cursor"))?.value ?? 0);
  for (let page = 0; page < 10_000; page++) {
    checkStillSignedIn(uid);
    const { data, error } = await sb.rpc("sync_pull", { since, max_rows: PULL_PAGE });
    if (error) throw error;
    const res = data as PullPage;
    checkStillSignedIn(uid);
    await apply(res, device);
    since = res.version;
    if (!res.more) return;
  }
}

const newId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

async function apply(page: PullPage, device: Device) {
  const db = localDB();
  const copies: Annotation[] = [];
  let readerSettings: unknown;
  let positionsAdded = false;
  const scope = [...SYNCED_TABLES, "remotePositions", "remoteDays", "outbox", "meta"].map((n) => db.table(n));

  await db.transaction("rw", scope, async (tx) => {
    markUntracked(tx.idbtrans);
    for (const { t, r } of page.rows) {
      const target = fromServer(t, r, device);
      if (!target) continue;
      const table = db.table(target.table);

      if (target.table === "remotePositions" || target.table === "remoteDays") {
        if (target.row) await table.put(target.row);
        else await table.delete(target.pk);
        if (target.table === "remotePositions" && target.row) positionsAdded = (await mirrorRemotePosition(target.row as RemotePosition)) || positionsAdded;
        continue;
      }

      const key = outboxKey(target.table, target.pk);
      const pending = await db.outbox.get(key);
      const current = (await table.get(target.pk)) as (Record<string, unknown> & { updatedAt?: number; serverUpdatedAt?: number; note?: string | null }) | undefined;
      const local: LocalState = current
        ? { kind: "row", updatedAt: current.updatedAt ?? 0, serverUpdatedAt: current.serverUpdatedAt, note: current.note, pending: Boolean(pending && !pending.deleted) }
        : pending?.deleted
          ? { kind: "deleted", changedAt: pending.changedAt, base: pending.base }
          : { kind: "none" };
      const decision = decide(local, { updatedAt: r.updated_at, deleted: r.deleted, note: (r.note as string | null | undefined) ?? null }, target.table === "annotations");

      if (decision === "apply" || decision === "apply-copy-local") {
        if (decision === "apply-copy-local" && current) copies.push({ ...(current as Annotation), id: newId(), conflictOf: target.pk, serverUpdatedAt: undefined });
        if (target.row) await table.put(target.row);
        else await table.delete(target.pk);
        if (pending) await db.outbox.delete(key);
        if (target.table === "settings" && target.pk === READER_SETTINGS_KEY) readerSettings = target.row?.value;
        if (target.table === "positions" && target.row) positionsAdded = true;
      } else {
        if (decision === "keep-copy-server" && target.row) copies.push({ ...(target.row as Annotation), id: newId(), conflictOf: target.pk, serverUpdatedAt: undefined });
        // keep ours, but remember we have seen this server version
        if (current) await table.update(target.pk, { serverUpdatedAt: r.updated_at });
        else if (pending?.deleted) await db.outbox.update(key, { base: r.updated_at });
      }
    }
    await db.meta.put({ key: "sync-cursor", value: page.version });
  });

  // conflict copies are new local rows: written normally, so they are pushed
  if (copies.length) await db.annotations.bulkPut(copies);
  if (readerSettings !== undefined) {
    try {
      localStorage.setItem(READER_SETTINGS_KEY, JSON.stringify(readerSettings));
    } catch {
      /* private mode */
    }
  }
  if (positionsAdded) markHasProgress(true);
}

/**
 * A book read on another device shows up here too (Continue Reading, the
 * library): if this device has no place in it yet, it starts from the other
 * device's place. Once read here, this device's own place wins, and the
 * reader offers the other one instead.
 */
async function mirrorRemotePosition(rp: RemotePosition): Promise<boolean> {
  const db = localDB();
  const local = await db.positions.get(rp.workSlug);
  if (local && !local.fromRemote) return false;
  if (local && local.updatedAt >= rp.updatedAt) return false;
  if (!rp.work) return false;
  const row: ReadingPosition = {
    workSlug: rp.workSlug,
    fileSha: rp.fileSha,
    cfi: rp.cfi,
    fraction: rp.fraction,
    chapter: rp.chapter,
    finished: rp.finished,
    openedAt: rp.openedAt,
    updatedAt: rp.updatedAt,
    work: rp.work,
    fromRemote: true,
  };
  await db.positions.put(row);
  return true;
}

// ── leaving ─────────────────────────────────────────────────────────────

async function stopAndThen(fn: () => Promise<void>) {
  paused = true;
  if (timer) clearTimeout(timer);
  try {
    await running?.catch(() => {});
    await fn();
  } finally {
    user = null;
    paused = false;
    setSyncStatus({ phase: "off", pending: 0 });
  }
}

/** Signs out here and removes the account's data from this device (it stays in the account). */
export function signOutAndClear() {
  return stopAndThen(async () => {
    await signOut();
    await clearAccountData();
  });
}

/** After the account was deleted on the server: forget it here too. */
export function forgetAccount() {
  return stopAndThen(async () => {
    await signOut().catch(() => {});
    await clearAccountData();
  });
}
