"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Relocation } from "@/lib/reader/engine";
import { DEFAULT_CPS, secondsFor } from "@/lib/reading/goals";
import { addReadingTime, firstGoalOfDay, getGoalMinutes, readingSpeed, recordPage } from "@/lib/reading/store";

const TICK = 15; // seconds
const IDLE_AFTER = 3 * 60 * 1000; // no page turn, tap or key for this long: the book was left open

/**
 * Reading time, as Apple Books counts it: only while the book is on screen
 * and the reader is actually reading (something happened in the last three
 * minutes). Feeds the daily goal, and learns the reader's own speed from
 * ordinary page turns to estimate the time left in the chapter and the book.
 */
export function useReadingTime({
  location,
  active,
  onGoalReached,
}: {
  location: Relocation | null;
  active: boolean;
  onGoalReached: (minutes: number) => void;
}) {
  const [cps, setCps] = useState(DEFAULT_CPS);
  const lastActivity = useRef(0);
  const lastPage = useRef<{ at: number; loc: Relocation } | null>(null);
  const goalCallback = useRef(onGoalReached);
  useEffect(() => {
    goalCallback.current = onGoalReached;
  });

  const bump = useCallback(() => {
    lastActivity.current = Date.now();
  }, []);

  useEffect(() => {
    let live = true;
    void readingSpeed().then((v) => live && setCps(v));
    return () => {
      live = false;
    };
  }, []);

  // any input in the reader's own document counts as reading (the book's frames report through `bump`)
  useEffect(() => {
    const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, bump, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, bump);
    };
  }, [bump]);

  // a page turn: activity, and one sample of reading speed
  useEffect(() => {
    if (!location) return;
    const now = Date.now();
    lastActivity.current = now;
    const prev = lastPage.current;
    lastPage.current = { at: now, loc: location };
    const turned = location.reason === "page" || location.reason === "snap";
    if (!prev || !turned || location.fraction <= prev.loc.fraction || !prev.loc.range) return;
    const chars = prev.loc.range.toString().replace(/\s+/g, " ").trim().length;
    void recordPage(chars, (now - prev.at) / 1000)
      .then(readingSpeed)
      .then(setCps);
  }, [location]);

  useEffect(() => {
    if (!active) return;
    lastActivity.current = Date.now();
    const id = setInterval(async () => {
      if (document.visibilityState !== "visible" || Date.now() - lastActivity.current > IDLE_AFTER) return;
      const total = await addReadingTime(TICK);
      const goal = (await getGoalMinutes()) * 60;
      if (total >= goal && total - TICK < goal + TICK && (await firstGoalOfDay())) goalCallback.current(Math.round(total / 60));
    }, TICK * 1000);
    return () => clearInterval(id);
  }, [active]);

  const left = location?.charsLeft;
  const timeLeft = left ? { chapter: secondsFor(left.chapter, cps), book: secondsFor(left.book, cps) } : null;
  return { timeLeft, bump };
}
