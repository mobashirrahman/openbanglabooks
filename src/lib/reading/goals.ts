/**
 * Reading goals, streaks and time-left estimates. Pure functions (unit
 * tested); the IndexedDB side lives in ./store.ts.
 */

export const DEFAULT_GOAL_MINUTES = 10;
export const GOAL_CHOICES = [5, 10, 15, 20, 30, 45, 60] as const;
/** Characters per second before we know the reader (≈ 150 Bengali words a minute). */
export const DEFAULT_CPS = 13;

/** The local calendar day, e.g. "2026-11-04" (a day ends at the reader's midnight, not UTC's). */
export function dayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

/**
 * Consecutive days that met the goal, ending today – or yesterday, when today
 * is still in progress (a streak is not broken until the day is over).
 */
export function streak(seconds: Map<string, number>, goalSeconds: number, today: string = dayKey()) {
  const met = (k: string) => (seconds.get(k) ?? 0) >= goalSeconds;
  const todayMet = met(today);
  let n = 0;
  for (let k = todayMet ? today : addDays(today, -1); met(k); k = addDays(k, -1)) n++;
  return { days: n, todayMet };
}

/** The last `n` days, oldest first, with whether each met the goal. */
export function week(seconds: Map<string, number>, goalSeconds: number, today: string = dayKey(), n = 7) {
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(today, i - (n - 1));
    const s = seconds.get(day) ?? 0;
    return { day, seconds: s, met: s >= goalSeconds };
  });
}

/**
 * Updates the reading speed with one page: an exponentially weighted average,
 * ignoring pages that were skimmed (too fast) or left open (too slow).
 */
export function nextSpeed(current: { cps: number; samples: number } | null, chars: number, seconds: number) {
  if (seconds < 4 || seconds > 240 || chars < 120) return current;
  const sample = chars / seconds;
  if (sample < 2 || sample > 60) return current; // not reading
  if (!current) return { cps: sample, samples: 1 };
  const w = current.samples < 10 ? 1 / (current.samples + 1) : 0.1;
  return { cps: current.cps * (1 - w) + sample * w, samples: current.samples + 1 };
}

export function secondsFor(chars: number, cps: number) {
  return chars / Math.max(1, cps);
}
