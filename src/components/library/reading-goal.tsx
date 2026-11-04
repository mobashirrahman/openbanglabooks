"use client";

import { useLiveQuery } from "dexie-react-hooks";
import { localDB } from "@/lib/local/db";
import { dayKey, GOAL_CHOICES, streak, week } from "@/lib/reading/goals";
import { getGoalMinutes, setGoalMinutes } from "@/lib/reading/store";
import { formatNumber } from "@/lib/i18n/format";
import { localeTag, type Locale } from "@/lib/i18n/config";
import { t } from "@/lib/i18n/t";
import type { Dictionary } from "@/lib/i18n/dictionaries/bn";
import { cn } from "@/lib/utils";

type Labels = Pick<
  Dictionary["library"],
  "goalTitle" | "goalOf" | "goalMet" | "streak" | "streakHint" | "dailyGoal" | "minutes" | "lastSevenDays"
>;

/** Today's reading against the daily goal, the streak, and the last seven days. All on this device. */
export function ReadingGoal({ locale, labels }: { locale: Locale; labels: Labels }) {
  const data = useLiveQuery(async () => {
    const [days, goal] = await Promise.all([localDB().days.toArray(), getGoalMinutes()]);
    return { days: new Map(days.map((d) => [d.day, d.seconds])), goal };
  }, []);
  if (!data) return <div className="h-44" aria-busy />;

  const goalSeconds = data.goal * 60;
  const today = dayKey();
  const todaySeconds = data.days.get(today) ?? 0;
  const minutes = Math.floor(todaySeconds / 60);
  const s = streak(data.days, goalSeconds, today);
  const days = week(data.days, goalSeconds, today);
  const progress = Math.min(1, todaySeconds / goalSeconds);
  const n = (x: number) => formatNumber(x, locale);
  const short = new Intl.DateTimeFormat(localeTag[locale], { weekday: "narrow" });
  const long = new Intl.DateTimeFormat(localeTag[locale], { weekday: "long" });
  const dateOf = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d);
  };
  const R = 46;
  const C = 2 * Math.PI * R;

  return (
    <section aria-labelledby="goal-title" className="flex flex-col gap-6 rounded-[16px] border border-line bg-surface p-5 sm:flex-row sm:items-center sm:p-6">
      <div className="relative mx-auto size-28 shrink-0 sm:mx-0">
        <svg viewBox="0 0 112 112" className="size-28 -rotate-90" aria-hidden>
          <circle cx="56" cy="56" r={R} fill="none" strokeWidth="8" className="stroke-line" />
          <circle
            cx="56"
            cy="56"
            r={R}
            fill="none"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${C * progress} ${C}`}
            className={cn("transition-[stroke-dasharray] duration-700 ease-paper", s.todayMet ? "stroke-cloth dark:stroke-foil" : "stroke-accent")}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl leading-none">{n(minutes)}</span>
          <span className="mt-1 text-xs text-fg-muted">{t(labels.minutes, { count: "" }).trim()}</span>
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <h2 id="goal-title" className="font-display text-2xl">
          {labels.goalTitle}
        </h2>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-fg-muted">
          <span>{s.todayMet ? labels.goalMet : t(labels.goalOf, { goal: t(labels.minutes, { count: n(data.goal) }) })}</span>
          {s.days > 1 || (s.days === 1 && !s.todayMet) ? <span>{t(labels.streak, { count: n(s.days) })}</span> : null}
        </p>
        {s.days === 0 && !s.todayMet ? <p className="mt-1 text-sm text-fg-subtle">{labels.streakHint}</p> : null}

        <ol aria-label={labels.lastSevenDays} className="mt-4 flex gap-2.5">
          {days.map((d) => {
            const date = dateOf(d.day);
            const isToday = d.day === today;
            return (
              <li key={d.day} className="flex flex-col items-center gap-1.5">
                <span aria-hidden className={cn("text-xs", isToday ? "text-fg" : "text-fg-subtle")}>
                  {short.format(date)}
                </span>
                <span
                  role="img"
                  aria-label={`${long.format(date)}: ${t(labels.minutes, { count: n(Math.floor(d.seconds / 60)) })}`}
                  className={cn(
                    "size-7 rounded-full border",
                    d.met ? "border-cloth bg-cloth dark:border-foil dark:bg-foil" : d.seconds > 0 ? "border-accent bg-accent-soft" : "border-line-strong",
                    isToday && "ring-2 ring-accent/50 ring-offset-2 ring-offset-surface",
                  )}
                />
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex items-center gap-3 sm:flex-col sm:items-end">
        <label htmlFor="daily-goal" className="text-sm text-fg-muted">
          {labels.dailyGoal}
        </label>
        <select
          id="daily-goal"
          value={data.goal}
          onChange={(e) => void setGoalMinutes(Number(e.target.value))}
          className="h-10 rounded-control border border-line-strong bg-bg px-3 text-sm text-fg"
        >
          {GOAL_CHOICES.map((m) => (
            <option key={m} value={m}>
              {t(labels.minutes, { count: n(m) })}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
