import { describe, expect, it } from "vitest";
import { addDays, dayKey, nextSpeed, streak, week } from "@/lib/reading/goals";

describe("reading goals", () => {
  it("uses the local calendar day", () => {
    expect(dayKey(new Date(2026, 10, 4, 23, 59))).toBe("2026-11-04");
    expect(dayKey(new Date(2026, 10, 5, 0, 1))).toBe("2026-11-05");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("counts a streak through yesterday while today is still in progress", () => {
    const goal = 600;
    const days = new Map([
      ["2026-11-01", 700],
      ["2026-11-02", 650],
      ["2026-11-03", 900],
      ["2026-11-04", 120], // today, not met yet
    ]);
    expect(streak(days, goal, "2026-11-04")).toEqual({ days: 3, todayMet: false });
    days.set("2026-11-04", 600);
    expect(streak(days, goal, "2026-11-04")).toEqual({ days: 4, todayMet: true });
  });

  it("a missed day breaks the streak", () => {
    const days = new Map([
      ["2026-11-01", 700],
      ["2026-11-03", 700],
    ]);
    expect(streak(days, 600, "2026-11-04")).toEqual({ days: 1, todayMet: false });
    expect(streak(new Map(), 600, "2026-11-04")).toEqual({ days: 0, todayMet: false });
  });

  it("lists the last seven days, oldest first", () => {
    const w = week(new Map([["2026-11-04", 700]]), 600, "2026-11-04");
    expect(w).toHaveLength(7);
    expect(w[0].day).toBe("2026-10-29");
    expect(w[6]).toEqual({ day: "2026-11-04", seconds: 700, met: true });
  });

  it("learns reading speed from real pages only", () => {
    let s = nextSpeed(null, 600, 40); // 15 chars/s
    expect(s).toEqual({ cps: 15, samples: 1 });
    s = nextSpeed(s, 600, 60); // 10 chars/s
    expect(s!.cps).toBeCloseTo(12.5);
    expect(nextSpeed(s, 600, 2)).toBe(s); // flicked past
    expect(nextSpeed(s, 600, 600)).toBe(s); // left open
    expect(nextSpeed(s, 40, 10)).toBe(s); // a nearly empty page
  });
});
