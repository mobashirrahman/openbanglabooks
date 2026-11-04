import { expect, test, type Page } from "@playwright/test";
import { strToU8, zipSync } from "fflate";
import { bookPoint, clearLocalData, readerState, shot, showControls, waitForReader } from "./helpers";

const BOOK = "devdas";

async function openReader(page: Page, path = `/read/${BOOK}`) {
  await page.goto(path);
  return waitForReader(page);
}

/** Turns forward (edge tap on touch screens, → elsewhere) and waits until the reader has moved. */
async function next(page: Page, isMobile: boolean) {
  await turnAndWait(page, async () => {
    if (isMobile) {
      const vp = page.viewportSize()!;
      await page.touchscreen.tap(vp.width - 20, vp.height / 2);
    } else {
      await page.keyboard.press("ArrowRight");
    }
  });
}

/** Runs an input that should turn the page, then waits for the new location (a chapter may need loading). */
async function turnAndWait(page: Page, input: () => Promise<void>) {
  const before = (await readerState(page)).cfi;
  await input();
  await expect.poll(async () => (await readerState(page)).cfi, { timeout: 10_000 }).not.toBe(before);
  await page.waitForTimeout(450); // let the slide settle before reading the page
}

test.describe("reader", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/robots.txt"); // any same-origin page will do, the lighter the better
    await clearLocalData(page);
  });

  test("opens a real EPUB with the right page layout for the viewport", async ({ page }, info) => {
    await openReader(page);
    const { columns } = await readerState(page);
    const vp = page.viewportSize()!;
    const expected = vp.width >= 1100 && vp.width / vp.height >= 1.15 ? 2 : 1;
    expect(columns, `columns at ${vp.width}×${vp.height}`).toBe(expected);
    // the site navigation is gone: the reader is immersive
    await expect(page.locator("header nav")).toHaveCount(0);
    await next(page, Boolean(info.project.use.isMobile));
    await next(page, Boolean(info.project.use.isMobile));
    const s = await readerState(page);
    expect(s.visible.length).toBeGreaterThan(20);
    expect(s.visible).toMatch(/[ঀ-৿]/); // Bengali text is on the page
    await shot(page, info, "reader-text");
  });

  test("two facing pages show consecutive, different text", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop-1440" && info.project.name !== "desktop-1920", "spread is a desktop layout");
    await openReader(page);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    const s1 = await readerState(page);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    const s2 = await readerState(page);
    expect(s2.cfi).not.toBe(s1.cfi);
    expect(s2.visible).not.toBe(s1.visible);
    expect(s2.fraction).toBeGreaterThan(s1.fraction);
    await shot(page, info, "reader-spread");
  });

  test("keyboard and tap navigation move forward and back", async ({ page }, info) => {
    const mobile = Boolean(info.project.use.isMobile);
    await openReader(page);
    await next(page, mobile);
    const a = await readerState(page);
    await next(page, mobile);
    const b = await readerState(page);
    expect(b.cfi).not.toBe(a.cfi);
    // back: on a phone, a tap at the very edge (foliate's margin, outside the text frame)
    await turnAndWait(page, async () => {
      if (mobile) await page.touchscreen.tap(15, page.viewportSize()!.height / 2);
      else await page.keyboard.press("ArrowLeft");
    });
    expect((await readerState(page)).cfi).toBe(a.cfi);
  });

  test("taps made while a chapter is loading are not lost", async ({ page }) => {
    await openReader(page);
    // the title page is a single page: the first turn loads chapter 1, the second arrives during that load
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect.poll(async () => (await readerState(page)).section, { timeout: 10_000 }).toBe(1);
    await expect
      .poll(async () => (await readerState(page)).cfi, { timeout: 10_000 })
      .not.toMatch(/^epubcfi\(\/6\/4!\/4\/2\/2,\/1:0,/); // past chapter 1's first page
  });

  test("tapping the centre toggles the reader controls", async ({ page }, info) => {
    test.skip(!info.project.use.hasTouch, "touch interaction");
    await openReader(page);
    await page.waitForTimeout(2600); // controls auto-hide after opening
    const vp = page.viewportSize()!;
    const contents = page.getByRole("button", { name: "সূচিপত্র" });
    await expect(contents).toBeHidden();
    await page.touchscreen.tap(vp.width / 2, vp.height / 2);
    await expect(contents).toBeVisible();
    await shot(page, info, "reader-controls");
  });

  test("a tap while text is selected does not turn the page", async ({ page }, info) => {
    const mobile = Boolean(info.project.use.isMobile);
    await openReader(page);
    await next(page, mobile);
    const before = await readerState(page);
    // select text inside the rendered section
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      await frame.evaluate(() => {
        const p = document.querySelector("p");
        if (p) getSelection()?.selectAllChildren(p);
      });
    }
    // a tap in the "next page" zone of the book only dismisses the selection…
    const p = await bookPoint(page, 0.9);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(600);
    expect((await readerState(page)).cfi).toBe(before.cfi);
    // …and the next one turns the page
    await turnAndWait(page, () => page.mouse.click(p.x, p.y));
  });

  test("changing text size reflows but keeps the reading position", async ({ page }, info) => {
    const mobile = Boolean(info.project.use.isMobile);
    await openReader(page);
    for (let i = 0; i < 3; i++) await next(page, mobile);
    const before = await readerState(page);
    const anchor = before.visible.slice(0, 14);
    await showControls(page);
    await page.getByRole("button", { name: "পড়ার সেটিংস" }).click();
    await page.getByRole("button", { name: "বড় করুন" }).click();
    await page.getByRole("button", { name: "বড় করুন" }).click();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);
    const after = await readerState(page);
    expect(after.section).toBe(before.section);
    // the first words that were visible before are still on the (re-paginated) page
    expect(after.visible).toContain(anchor);
    await shot(page, info, "reader-larger-text");
  });

  test("reading position survives a reload", async ({ page }, info) => {
    const mobile = Boolean(info.project.use.isMobile);
    await openReader(page);
    for (let i = 0; i < 4; i++) await next(page, mobile);
    const before = await readerState(page);
    await page.waitForTimeout(800); // debounce
    await openReader(page);
    const after = await readerState(page);
    expect(after.cfi).toBe(before.cfi);
    // and the book now shows as "continue reading"
    await page.goto(`/books/${BOOK}`);
    await expect(page.getByRole("link", { name: "পড়া চালিয়ে যান" })).toBeVisible();
  });

  test("resizing switches between one page and a spread", async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-1920", "desktop resize");
    await openReader(page);
    expect((await readerState(page)).columns).toBe(2);
    await page.setViewportSize({ width: 820, height: 1000 });
    await expect(page.locator(".reader")).toHaveAttribute("data-columns", "1");
    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect(page.locator(".reader")).toHaveAttribute("data-columns", "2");
  });

  test("a book can be read through to the end", async ({ page }, info) => {
    test.skip(!["mobile-390", "desktop-1920"].includes(info.project.name), "long test: two viewports");
    await openReader(page, "/read/bardidi");
    // jump close to the end with the progress slider, then turn pages to the last one
    await showControls(page);
    const slider = page.getByRole("slider");
    await slider.focus();
    await slider.press("End");
    await page.waitForTimeout(1200);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (let i = 0; i < 40; i++) {
      if (await page.getByRole("heading", { name: "বই শেষ" }).isVisible()) break;
      await page.keyboard.press("ArrowRight");
      await page.waitForTimeout(350);
    }
    await expect(page.getByRole("heading", { name: "বই শেষ" })).toBeVisible();
    await shot(page, info, "reader-end");
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "পড়া শেষ" })).toBeVisible();
  });

  test("respects reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openReader(page);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
    expect(await page.locator(".leaf-sweep").count()).toBe(0);
  });

  test("security: the reader CSP blocks scripts in blob: section frames", async ({ page }) => {
    await openReader(page);
    const csp = await page.evaluate(() => fetch(location.href).then((r) => r.headers.get("content-security-policy")));
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-inline' 'strict-dynamic'");
    const result = await page.evaluate(async () => {
      const html = `<!doctype html><body><script>parent.document.documentElement.dataset.pwned="inline"<\/script>
        <img src="x" onerror="parent.document.documentElement.dataset.pwned='onerror'"></body>`;
      const iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-same-origin allow-scripts"); // as foliate does
      iframe.src = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      document.body.append(iframe);
      await new Promise((r) => setTimeout(r, 1500));
      return document.documentElement.dataset.pwned ?? "safe";
    });
    expect(result).toBe("safe");
  });

  test("security: a hostile EPUB renders without running its scripts", async ({ page }, info) => {
    test.skip(info.project.name !== "laptop-1440", "one viewport is enough");
    let sha = "";
    page.on("request", (r) => {
      const m = r.url().match(/\/api\/books\/([0-9a-f]{64})/);
      if (m) sha = m[1];
    });
    await openReader(page);
    expect(sha).toMatch(/^[0-9a-f]{64}$/);

    const chapter = `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>x</title>
      <script>parent.document.documentElement.dataset.pwned = "script";</script></head>
      <body onload="parent.document.documentElement.dataset.pwned='onload'">
      <p>নিরাপত্তা পরীক্ষা</p>
      <img src="missing.png" onerror="parent.document.documentElement.dataset.pwned='onerror'"/>
      <a href="javascript:parent.document.documentElement.dataset.pwned='js'">লিংক</a>
      <iframe src="https://example.com"></iframe></body></html>`;
    const epub = zipSync({
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "META-INF/container.xml": strToU8(
        `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="c.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
      ),
      "c.opf": strToU8(
        `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="u"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="u">x</dc:identifier><dc:title>x</dc:title><dc:language>bn</dc:language></metadata><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/><item id="n" href="n.xhtml" media-type="application/xhtml+xml" properties="nav"/></manifest><spine><itemref idref="c"/></spine></package>`,
      ),
      "n.xhtml": strToU8(
        `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><ol><li><a href="c.xhtml">c</a></li></ol></nav></body></html>`,
      ),
      "c.xhtml": strToU8(chapter),
    });

    // plant the hostile file in the local cache under the real file's hash
    await page.evaluate(
      async ({ sha, bytes }) => {
        localStorage.clear();
        await new Promise<void>((resolve, reject) => {
          const open = indexedDB.open("openbanglabooks");
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(["files", "positions"], "readwrite");
            tx.objectStore("positions").clear();
            tx.objectStore("files").put({
              sha256: sha,
              blob: new Blob([new Uint8Array(bytes)], { type: "application/epub+zip" }),
              bytes: bytes.length,
              cachedAt: Date.now(),
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
        });
      },
      { sha, bytes: [...epub] },
    );
    await openReader(page);
    await page.waitForTimeout(1500);
    const visible = (await readerState(page)).visible;
    expect(visible).toContain("নিরাপত্তা পরীক্ষা");
    expect(await page.evaluate(() => document.documentElement.dataset.pwned ?? "safe")).toBe("safe");
  });
});
