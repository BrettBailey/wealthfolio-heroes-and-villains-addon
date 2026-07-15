import type { TimePeriod } from "@wealthfolio/ui";
import { addDays } from "./calculations/dates";

/**
 * Periods are keyed by the host's `TimePeriod` codes so the page can use
 * Wealthfolio's own `IntervalSelector` control (1D/1W/1M/3M/6M/YTD/1Y/5Y/ALL).
 *
 * The host's selector hands back a `{ from, to }` pair of `Date` objects, but we
 * resolve the window ourselves instead: the rest of the addon works in
 * "YYYY-MM-DD" strings, and this keeps one tested implementation of the date
 * math. The semantics match the host's own (a plain calendar lookback from
 * today, e.g. `subMonths(now, 3)` for "3M"), so the selector and the figures
 * below it agree.
 */
export type PeriodKey = TimePeriod;

export const DEFAULT_PERIOD_KEY: PeriodKey = "3M";

/**
 * The periods offered, in display order.
 *
 * Listed here rather than taken from the host's `IntervalSelector`, which this
 * addon deliberately does not use: that control is a thin wrapper around
 * `AnimatedToggleGroup` which passes `bg-transparent`, leaving the selected-item
 * pill with no background to sit against — the selection is hard to see. It is
 * also uncontrolled and persists through `localStorage`, which does nothing in
 * the addon sandbox. Driving `AnimatedToggleGroup` directly fixes all three.
 */
export const PERIOD_KEYS: readonly PeriodKey[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "ALL"];

/** Days back from today for each fixed-lookback period. YTD and ALL are computed instead. */
const DAYS_BACK: Partial<Record<PeriodKey, number>> = {
  "1D": 1,
  "1W": 7,
  "1M": 30,
  "3M": 91,
  "6M": 182,
  "1Y": 365,
  "5Y": 365 * 5,
};

/** Earliest date we'll look back to for "ALL" — comfortably before any real activity history. */
const ALL_TIME_START = "1970-01-01";

export interface DateRange {
  startDate: string;
  endDate: string;
}

/** Resolves a period code to a concrete [startDate, endDate] window ending today. */
export function periodDateRange(periodKey: PeriodKey, today: string): DateRange {
  return { startDate: periodStartDate(periodKey, today), endDate: today };
}

function periodStartDate(periodKey: PeriodKey, today: string): string {
  if (periodKey === "ALL") {
    return ALL_TIME_START;
  }
  if (periodKey === "YTD") {
    return `${today.slice(0, 4)}-01-01`;
  }
  const daysBack = DAYS_BACK[periodKey] ?? DAYS_BACK[DEFAULT_PERIOD_KEY];
  return addDays(today, -daysBack!);
}
