import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EARLY_BOOK, earlyBookScript, forgetBooksHere, markBookHere, takeEarlyBook } from "@/lib/reader/early-book";

const SHA = "ab".repeat(32);
const URL_ = `/api/books/${SHA}`;

/** A window with just what the inline script and the helpers touch. */
function fakeWindow(storage: Map<string, string> | null) {
  const localStorage = storage
    ? { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => void storage.set(k, v), removeItem: (k: string) => void storage.delete(k) }
    : {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      };
  const fetch = vi.fn(async () => new Response("epub"));
  const win: Record<string, unknown> = { localStorage, fetch };
  win.window = win;
  return { win, fetch };
}

/** Runs the page's inline script as the browser would, with `win` as the global object. */
const run = (script: string, win: Record<string, unknown>) =>
  new Function("window", "localStorage", "fetch", script)(win, win.localStorage, win.fetch);

describe("the book's early download", () => {
  let storage: Map<string, string>;
  beforeEach(() => {
    storage = new Map();
    const { win } = fakeWindow(storage);
    vi.stubGlobal("window", win);
    vi.stubGlobal("localStorage", win.localStorage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts when the book is not on the device, and is taken over once", async () => {
    const { win, fetch } = fakeWindow(storage);
    run(earlyBookScript(URL_, SHA), win);
    expect(fetch).toHaveBeenCalledWith(URL_);
    vi.stubGlobal("window", win);
    expect(takeEarlyBook("/api/books/other")).toBeNull();
    const res = await takeEarlyBook(URL_);
    expect(await res!.text()).toBe("epub");
    expect(win[EARLY_BOOK]).toBeUndefined();
    expect(takeEarlyBook(URL_)).toBeNull();
  });

  it("is skipped for a book the device keeps, and starts again once the device is emptied", () => {
    markBookHere(SHA);
    const first = fakeWindow(storage);
    run(earlyBookScript(URL_, SHA), first.win);
    expect(first.fetch).not.toHaveBeenCalled();
    expect(first.win[EARLY_BOOK]).toBeUndefined();

    forgetBooksHere();
    const second = fakeWindow(storage);
    run(earlyBookScript(URL_, SHA), second.win);
    expect(second.fetch).toHaveBeenCalledOnce();
  });

  it("still starts where storage is refused", () => {
    const { win, fetch } = fakeWindow(null);
    run(earlyBookScript(URL_, SHA), win);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("a failed download leaves null, for the reader to try again", async () => {
    const { win } = fakeWindow(storage);
    win.fetch = vi.fn(async () => {
      throw new TypeError("offline");
    });
    run(earlyBookScript(URL_, SHA), win);
    vi.stubGlobal("window", win);
    expect(await takeEarlyBook(URL_)).toBeNull();
  });

  it("the list of kept books stays short, newest kept", () => {
    const sha = (i: number) => i.toString(16).padStart(12, "0") + "f".repeat(52);
    for (let i = 0; i < 320; i++) markBookHere(sha(i));
    markBookHere(sha(30)); // opened again: moves to the end, not added twice
    const list = storage.get("obb:books-here")!.split(" ");
    expect(list).toHaveLength(300);
    expect(new Set(list).size).toBe(300);
    expect(list.at(-1)).toBe(sha(30).slice(0, 12));
    expect(list).not.toContain(sha(0).slice(0, 12));
    expect(list).toContain(sha(319).slice(0, 12));
  });
});
