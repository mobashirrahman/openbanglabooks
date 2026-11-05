import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalDB, type Annotation } from "@/lib/local/db";
import { markUntracked, stamp } from "@/lib/local/outbox";
import { decide } from "@/lib/sync/merge";
import { deviceLabel } from "@/lib/sync/device";
import { contextScore, pickAnchor } from "@/lib/reader/reanchor";
import { fromServer, serverId, toChange, toDeletion } from "@/lib/sync/tables";

const work = { slug: "devdas", title_bn: "দেবদাস", subtitle_bn: null, cover_variant: 1, authors: [{ name_bn: "শরৎচন্দ্র" }] };
const device = { id: "dev-1", label: "Chrome · Android" };
const sha = "a".repeat(64);

function annotation(over: Partial<Annotation> = {}): Annotation {
  return {
    id: "n1",
    workSlug: "devdas",
    fileSha: sha,
    cfi: "epubcfi(/6/4!/4/2,/1:0,/1:5)",
    quote: "দেবদাস",
    prefix: "",
    suffix: "",
    color: "yellow",
    style: "highlight",
    note: null,
    chapter: "১",
    fraction: 0.1,
    createdAt: 1000,
    updatedAt: 1000,
    work,
    ...over,
  };
}

describe("merge decisions for pulled rows", () => {
  it("applies when there is nothing local, or nothing pending", () => {
    expect(decide({ kind: "none" }, { updatedAt: 5, deleted: false })).toBe("apply");
    expect(decide({ kind: "row", updatedAt: 9, pending: false }, { updatedAt: 5, deleted: false })).toBe("apply");
  });

  it("keeps a newer pending local change, applies a newer server one", () => {
    expect(decide({ kind: "row", updatedAt: 9, pending: true }, { updatedAt: 5, deleted: false })).toBe("keep");
    expect(decide({ kind: "row", updatedAt: 5, pending: true }, { updatedAt: 9, deleted: false })).toBe("apply");
  });

  it("recognises its own change coming back", () => {
    expect(decide({ kind: "row", updatedAt: 7, pending: true, note: "a" }, { updatedAt: 7, deleted: false, note: "a" }, true)).toBe("keep");
  });

  it("never loses a note when two devices edited it", () => {
    const local = { kind: "row" as const, updatedAt: 3000, serverUpdatedAt: 1000, note: "mine", pending: true };
    expect(decide(local, { updatedAt: 2000, deleted: false, note: "theirs" }, true)).toBe("keep-copy-server");
    expect(decide({ ...local, updatedAt: 1500 }, { updatedAt: 2000, deleted: false, note: "theirs" }, true)).toBe("apply-copy-local");
    // same note text: no copy
    expect(decide(local, { updatedAt: 2000, deleted: false, note: " mine " }, true)).toBe("keep");
    // the server version was already seen here: plain last-writer-wins
    expect(decide({ ...local, serverUpdatedAt: 2000 }, { updatedAt: 2000, deleted: false, note: "theirs" }, true)).toBe("keep");
  });

  it("keeps a note being written here when the highlight was deleted elsewhere", () => {
    expect(decide({ kind: "row", updatedAt: 1500, serverUpdatedAt: 1000, note: "keep", pending: true }, { updatedAt: 2000, deleted: true }, true)).toBe("keep");
    expect(decide({ kind: "row", updatedAt: 1500, serverUpdatedAt: 1000, note: null, pending: true }, { updatedAt: 2000, deleted: true }, true)).toBe("apply");
  });

  it("lets a note changed elsewhere outlive a pending local delete", () => {
    expect(decide({ kind: "deleted", changedAt: 3000, base: 1000 }, { updatedAt: 2000, deleted: false, note: "theirs" }, true)).toBe("apply");
    expect(decide({ kind: "deleted", changedAt: 3000, base: 1000 }, { updatedAt: 2000, deleted: false, note: null }, true)).toBe("keep");
    expect(decide({ kind: "deleted", changedAt: 3000 }, { updatedAt: 4000, deleted: false }, false)).toBe("apply");
  });
});

describe("row mapping", () => {
  it("keeps positions and reading time per device", () => {
    expect(serverId("positions", "devdas", device)).toBe("dev-1:devdas");
    expect(serverId("days", "2026-11-05", device)).toBe("dev-1:2026-11-05");
    expect(serverId("annotations", "n1", device)).toBe("n1");
  });

  it("only syncs reader settings, goals and speed", () => {
    expect(serverId("settings", "obb:reader-settings", device)).toBe("obb:reader-settings");
    expect(serverId("settings", "goal-celebrated", device)).toBeNull();
    expect(toChange("settings", { key: "goal-celebrated", value: "x", updatedAt: 1 }, "goal-celebrated", device)).toBeNull();
  });

  it("round-trips a highlight with its base version", () => {
    const a = annotation({ note: "ভাবনা", serverUpdatedAt: 900, updatedAt: 1200 });
    const c = toChange("annotations", a, a.id, device)!;
    expect(c).toMatchObject({ t: "annotations", id: "n1", u: 1200, b: 900 });
    expect(c.r).toMatchObject({ work_slug: "devdas", note: "ভাবনা", color: "yellow", file_sha: sha });
    const back = fromServer("annotations", { ...(c.r as object), id: "n1", updated_at: 1200, deleted: false, version: 3 } as never, device)!;
    expect(back.table).toBe("annotations");
    expect(back.row).toMatchObject({ id: "n1", note: "ভাবনা", updatedAt: 1200, serverUpdatedAt: 1200, workSlug: "devdas" });
  });

  it("trims oversized text instead of letting it block a push", () => {
    const c = toChange("annotations", annotation({ quote: "ক".repeat(6000), note: "খ".repeat(12000) }), "n1", device)!;
    expect((c.r!.quote as string).length).toBe(5000);
    expect((c.r!.note as string).length).toBe(10000);
  });

  it("does not push a place copied from another device", () => {
    const p = { workSlug: "devdas", fileSha: sha, cfi: "epubcfi(/6/2)", fraction: 0.4, chapter: null, finished: false, updatedAt: 5, openedAt: 5, work, fromRemote: true };
    expect(toChange("positions", p, "devdas", device)).toBeNull();
  });

  it("sends deletions with their base", () => {
    expect(toDeletion({ key: "bookmarks|b1", t: "bookmarks", pk: "b1", changedAt: 77, deleted: true, base: 50 }, device)).toEqual({
      t: "bookmarks",
      id: "b1",
      u: 77,
      d: true,
      b: 50,
    });
  });

  it("files other devices' places and reading time separately", () => {
    const row = { id: "dev-2:devdas", updated_at: 9, deleted: false, version: 1, device_id: "dev-2", device_label: "Safari · iPhone", work_slug: "devdas", file_sha: sha, cfi: "x", fraction: 0.42, opened_at: 9, work };
    expect(fromServer("reading_positions", row, device)!.table).toBe("remotePositions");
    expect(fromServer("reading_positions", { ...row, device_id: "dev-1", id: "dev-1:devdas" }, device)!.table).toBe("positions");
    const day = { id: "dev-2:2026-11-05", updated_at: 9, deleted: false, version: 1, device_id: "dev-2", day: "2026-11-05", seconds: 600 };
    expect(fromServer("reading_days", day, device)).toMatchObject({ table: "remoteDays", row: { seconds: 600, day: "2026-11-05" } });
  });

  it("names devices plainly", () => {
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/141.0 Mobile Safari/537.36")).toBe("Chrome · Android");
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1")).toBe("Safari · iPhone");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox · Windows");
  });
});

describe("outbox change capture", () => {
  let db: LocalDB;
  beforeEach(async () => {
    await Dexie.delete("openbanglabooks");
    db = new LocalDB();
    await db.open();
  });
  afterEach(() => db.close());

  it("records a write and stamps it, in the same transaction", async () => {
    const before = Date.now();
    await db.annotations.put(annotation({ updatedAt: 1 }));
    const row = await db.annotations.get("n1");
    expect(row!.updatedAt).toBeGreaterThanOrEqual(before);
    const entry = await db.outbox.get("annotations|n1");
    expect(entry).toMatchObject({ t: "annotations", pk: "n1", deleted: false });
    expect(entry!.changedAt).toBe(row!.updatedAt);
  });

  it("coalesces edits to one entry per row, and captures update()", async () => {
    await db.annotations.put(annotation());
    await db.annotations.update("n1", { note: "প্রথম" });
    await db.annotations.update("n1", { note: "দ্বিতীয়" });
    expect(await db.outbox.count()).toBe(1);
    const row = await db.annotations.get("n1");
    expect((await db.outbox.get("annotations|n1"))!.changedAt).toBe(row!.updatedAt);
  });

  it("records deletions with the server version the row had", async () => {
    await db.transaction("rw", db.annotations, async (tx) => {
      markUntracked(tx.idbtrans);
      await db.annotations.put(annotation({ serverUpdatedAt: 1234 }));
    });
    expect(await db.outbox.count()).toBe(0);
    await db.annotations.delete("n1");
    expect(await db.outbox.get("annotations|n1")).toMatchObject({ deleted: true, base: 1234 });
  });

  it("captures clear() as deletions of every row", async () => {
    await db.bookmarks.bulkPut([
      { id: "b1", workSlug: "devdas", fileSha: sha, cfi: "x", fraction: 0, chapter: null, excerpt: "", createdAt: 1, work },
      { id: "b2", workSlug: "devdas", fileSha: sha, cfi: "y", fraction: 0, chapter: null, excerpt: "", createdAt: 1, work },
    ]);
    await db.bookmarks.clear();
    const entries = await db.outbox.toArray();
    expect(entries.map((e) => [e.pk, e.deleted]).sort()).toEqual([
      ["b1", true],
      ["b2", true],
    ]);
  });

  it("ignores untracked (server) writes and local-only tables", async () => {
    await db.transaction("rw", db.library, async (tx) => {
      markUntracked(tx.idbtrans);
      await db.library.put({ workSlug: "devdas", status: "want", addedAt: 1, updatedAt: 1, work });
    });
    await db.files.put({ sha256: sha, bytes: 1, cachedAt: 1 });
    await db.meta.put({ key: "x", value: 1 });
    expect(await db.outbox.count()).toBe(0);
    expect((await db.library.get("devdas"))!.updatedAt).toBe(1);
  });

  it("works inside explicit multi-table transactions", async () => {
    await db.transaction("rw", db.positions, db.library, async () => {
      await db.positions.put({ workSlug: "devdas", fileSha: sha, cfi: "x", fraction: 0.2, chapter: null, finished: false, updatedAt: 0, openedAt: 0, work });
      await db.library.put({ workSlug: "devdas", status: "reading", addedAt: 1, updatedAt: 1, work });
    });
    expect((await db.outbox.toArray()).map((e) => e.key).sort()).toEqual(["library|devdas", "positions|devdas"]);
  });

  it("stamps never repeat", () => {
    const a = stamp();
    const b = stamp();
    expect(b).toBeGreaterThan(a);
  });
});

describe("re-anchoring a highlight in a new file", () => {
  it("takes a single match", () => {
    expect(pickAnchor([{ pre: "x", post: "y" }], "a", "b")).toBe(0);
    expect(pickAnchor([], "a", "b")).toBe(-1);
  });

  it("tells repeated passages apart by their surroundings", () => {
    const candidates = [
      { pre: "…সে বলিল, ", post: " তারপর চলিয়া গেল" },
      { pre: "…পার্বতী ভাবিল, ", post: " কেহ জানিল না" },
    ];
    expect(pickAnchor(candidates, "পার্বতী ভাবিল, ", " কেহ জানিল না")).toBe(1);
    expect(pickAnchor(candidates, "সে বলিল,", " তারপর")).toBe(0);
  });

  it("refuses to guess when the surroundings do not decide", () => {
    const same = [
      { pre: "…এক কথা, ", post: " আর এক" },
      { pre: "…এক কথা, ", post: " আর এক" },
    ];
    expect(pickAnchor(same, "এক কথা, ", " আর এক")).toBe(-1);
    expect(pickAnchor([{ pre: "ক", post: "খ" }, { pre: "গ", post: "ঘ" }], "চ", "ছ")).toBe(-1);
  });

  it("scores context ignoring spacing differences", () => {
    expect(contextScore({ pre: "দেব  দাস ", post: "" }, "দেব দাস", "")).toBeGreaterThan(3);
  });
});
