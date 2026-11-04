"use client";

import { localDB } from "@/lib/local/db";
import { DEFAULT_CPS, DEFAULT_GOAL_MINUTES, dayKey, nextSpeed } from "./goals";

const GOAL_KEY = "goal-minutes";
const SPEED_KEY = "reading-speed";
const CELEBRATED_KEY = "goal-celebrated";

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await localDB().settings.get(key).catch(() => undefined);
  return (row?.value as T | undefined) ?? fallback;
}
async function setSetting(key: string, value: unknown) {
  await localDB().settings.put({ key, value, updatedAt: Date.now() });
}

/** Adds active reading time to today; returns today's total in seconds. */
export async function addReadingTime(seconds: number): Promise<number> {
  const db = localDB();
  const day = dayKey();
  return db.transaction("rw", db.days, async () => {
    const total = ((await db.days.get(day))?.seconds ?? 0) + seconds;
    await db.days.put({ day, seconds: total, updatedAt: Date.now() });
    return total;
  });
}

export const getGoalMinutes = () => getSetting(GOAL_KEY, DEFAULT_GOAL_MINUTES);
export const setGoalMinutes = (minutes: number) => setSetting(GOAL_KEY, minutes);

/** One page read: refines the reader's own speed. */
export async function recordPage(chars: number, seconds: number) {
  const current = await getSetting<{ cps: number; samples: number } | null>(SPEED_KEY, null);
  const next = nextSpeed(current, chars, seconds);
  if (next && next !== current) await setSetting(SPEED_KEY, next);
}

export async function readingSpeed(): Promise<number> {
  return (await getSetting<{ cps: number } | null>(SPEED_KEY, null))?.cps ?? DEFAULT_CPS;
}

/** True once per day: the first time today's goal is reached. */
export async function firstGoalOfDay(): Promise<boolean> {
  const today = dayKey();
  if ((await getSetting<string | null>(CELEBRATED_KEY, null)) === today) return false;
  await setSetting(CELEBRATED_KEY, today);
  return true;
}
