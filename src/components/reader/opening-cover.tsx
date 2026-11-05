"use client";

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { animate } from "motion/react";
import { BookCover } from "@/components/cover/book-cover";
import type { WorkSnapshot } from "@/lib/local/db";
import { columnsFor, frameSize } from "@/lib/reader/layout";
import { readOpenOrigin } from "@/lib/reader/open-origin";

const OPENED_KEY = "obb:opened";
const noSubscribe = () => () => {};
const EASE: [number, number, number, number] = [0.2, 0.7, 0.2, 1];

/**
 * Signature transition: the cover you tapped travels to where the book lies,
 * waits while the book loads, then hinges open about its spine to reveal the
 * page beneath. Repeat opens in a session are brief; reduced motion crossfades.
 */
export function OpeningCover({ work, ready, reducedMotion }: { work: WorkSnapshot; ready: boolean; reducedMotion: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  const [placed, setPlaced] = useState(false);
  const repeat = useRef(false);
  // true while hydrating server HTML: the cover has been on screen (placed by CSS) since the first paint
  const hydrating = useSyncExternalStore(
    noSubscribe,
    () => false,
    () => true,
  );
  const fromServer = useRef(hydrating);

  // place the cover where the book will lie, then fly it in from the tapped cover
  useLayoutEffect(() => {
    const book = bookRef.current;
    if (!book) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const mobile = w < 700;
    const cols = mobile ? 1 : columnsFor(w, h, "auto");
    const frame = frameSize(w, h, cols, mobile);
    // a closed book: the front cover sits where the right-hand page will be
    const coverH = mobile ? Math.min(h * 0.62, (w * 0.78) * 1.5) : frame.height;
    const coverW = coverH / 1.5;
    const left = cols === 2 ? w / 2 : (w - coverW) / 2;
    const top = (h - coverH) / 2;
    const shown = book.getBoundingClientRect();
    Object.assign(book.style, { width: `${coverW}px`, height: `${coverH}px`, left: `${left}px`, top: `${top}px` });

    try {
      repeat.current = sessionStorage.getItem(`${OPENED_KEY}:${work.slug}`) === "1";
      sessionStorage.setItem(`${OPENED_KEY}:${work.slug}`, "1");
    } catch {}

    const origin = readOpenOrigin(work.slug);
    if (reducedMotion || repeat.current) {
      setPlaced(true);
      return;
    }
    if (fromServer.current) {
      fromServer.current = false;
      // already showing where CSS put it: settle into the exact place, without a second entrance
      const dx = shown.left - left;
      const dy = shown.top - top;
      const s = shown.width / coverW;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(s - 1) < 0.01) {
        setPlaced(true);
        return;
      }
      book.style.transformOrigin = "0 0";
      book.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      animate(book, { transform: "translate(0px, 0px) scale(1)" }, { duration: 0.24, ease: EASE }).then(() => setPlaced(true));
      return;
    }
    if (origin) {
      const dx = origin.left - left;
      const dy = origin.top - top;
      const s = origin.width / coverW;
      book.style.transformOrigin = "0 0";
      book.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
      animate(book, { transform: "translate(0px, 0px) scale(1)" }, { duration: 0.42, ease: EASE }).then(() => setPlaced(true));
    } else {
      book.style.opacity = "0";
      book.style.transform = "scale(0.94)";
      animate(book, { opacity: 1, transform: "scale(1)" }, { duration: 0.3, ease: EASE }).then(() => setPlaced(true));
    }
  }, [work.slug, reducedMotion]);

  // open once the book is ready and the cover has arrived
  useEffect(() => {
    if (!ready || !placed || done) return;
    const root = rootRef.current;
    const cover = coverRef.current;
    if (!root || !cover) return;
    let cancelled = false;
    (async () => {
      if (reducedMotion) {
        await animate(root, { opacity: 0 }, { duration: 0.2 });
      } else {
        const d = repeat.current ? 0.26 : 0.62;
        await Promise.all([
          animate(cover, { rotateY: -168 }, { duration: d, ease: [0.45, 0.05, 0.25, 1] }),
          animate(root, { opacity: [1, 1, 0] }, { duration: d + 0.12, times: [0, 0.6, 1], ease: "easeOut" }),
        ]);
      }
      if (!cancelled) setDone(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, placed, done, reducedMotion]);

  if (done) return null;
  return (
    <div ref={rootRef} className="fixed inset-0 z-30 bg-[var(--desk)]" aria-hidden={ready}>
      <div ref={bookRef} className="opening-book absolute" style={{ perspective: "1800px" }}>
        {/* the first page, revealed as the cover swings open */}
        <div className="absolute inset-0 rounded-[2px] bg-[var(--paper)] shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)]" />
        <div
          ref={coverRef}
          className="absolute inset-0 [transform-style:preserve-3d]"
          style={{ transformOrigin: "left center", willChange: "transform" }}
        >
          <div className="absolute inset-0 [backface-visibility:hidden]">
            <BookCover work={work} className="h-full w-full shadow-[0_30px_60px_-30px_rgb(0_0_0/0.65)]" />
          </div>
          {/* inside of the cover: endpaper */}
          <div
            className="absolute inset-0 rounded-[2px] [backface-visibility:hidden] [transform:rotateY(180deg)]"
            style={{ background: "color-mix(in oklab, var(--paper), #c2a06c 22%)" }}
          />
        </div>
      </div>
    </div>
  );
}
