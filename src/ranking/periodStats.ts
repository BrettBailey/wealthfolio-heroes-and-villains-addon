import { addDays } from "../calculations/dates";
import { periodFlows, stateOn, twr } from "../calculations/returns";
import type { Holding as CalcHolding } from "../calculations/types";

export interface PeriodStats {
  marketValueStart: number;
  marketValueEnd: number;
  /** Cash spent buying during the period (including fees). */
  buys: number;
  /** Cash received selling during the period (net of fees). */
  sells: number;
  dividends: number;
  totalReturnCash: number | null;
  /**
   * Simple return as a **fraction**, not a percentage: 0.226 means +22.6%.
   * Fractions are the unit throughout — `twr()` in the calculation core already
   * returns one, and `@wealthfolio/ui`'s `GainPercent` expects one (it formats
   * via `Intl.NumberFormat({ style: "percent" })`, which scales by 100 itself).
   * A `* 100` here previously made this the one link in the chain using a
   * different unit, and the UI duly rendered every figure 100x too large.
   *
   * Money-weighted: its denominator is `marketValueStart + buys`, which counts a
   * pound invested on the last day of the period the same as one invested on the
   * first. That flatters a position bought late into a rise and punishes one
   * topped up before a dip — see `twr` for the figure that doesn't.
   */
  simpleReturn: number | null;
  /**
   * Daily-chained time-weighted return, as a fraction. See `simpleReturn`.
   *
   * Unlike `simpleReturn` this is immune to the *timing and size* of your own
   * buys and sells: it measures how the holding itself performed, which is what
   * you want when comparing one holding against another. The two diverge exactly
   * when money moved mid-period.
   */
  twr: number | null;
}

/**
 * Mirrors `entry_period_stats` in heroes-and-villains-report.py: simple/cash
 * total-return plus TWR for one holding over (startDate, endDate].
 * `startDate` is the requested window start (the day itself is included in
 * the period); the opening snapshot is taken the day before, matching the
 * Python reference's `start - timedelta(days=1)` convention.
 *
 * Returns are **fractions** (0.226 = +22.6%) — see `PeriodStats.simpleReturn`.
 */
export function periodStats(holding: CalcHolding, startDate: string, endDate: string): PeriodStats {
  const snapshotDate = addDays(startDate, -1);
  const { marketValue: marketValueStart } = stateOn(holding, snapshotDate);
  const { marketValue: marketValueEnd } = stateOn(holding, endDate);
  const { buys, sells, dividends } = periodFlows(holding, snapshotDate, endDate);

  const startValue = marketValueStart ?? 0;
  const endValue = marketValueEnd ?? 0;
  const growth = endValue - startValue - (buys - sells);
  const totalReturnCash = marketValueStart === null && marketValueEnd === null ? null : growth + dividends;

  const denominator = startValue + buys;
  const simpleReturn = totalReturnCash !== null && denominator > 0 ? totalReturnCash / denominator : null;

  return {
    marketValueStart: startValue,
    marketValueEnd: endValue,
    buys,
    sells,
    dividends,
    totalReturnCash,
    simpleReturn,
    twr: twr(holding, startDate, endDate),
  };
}
