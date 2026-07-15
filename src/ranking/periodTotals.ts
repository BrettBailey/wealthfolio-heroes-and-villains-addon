import type { RankingEntry } from "./types";

export interface PeriodTotals {
  /** Sum of every positive period cash return, in base currency. */
  totalGains: number;
  /** Sum of every negative period cash return, in base currency (so, <= 0). */
  totalLosses: number;
  /** totalGains + totalLosses. */
  netChange: number;
  /** How many entries contributed a figure. */
  countedEntries: number;
  /** How many entries had no period figure and so are absent from the totals. */
  excludedEntries: number;
}

/**
 * Totals the period cash return across *every* entry, not just the top few shown
 * in the columns — so this is a whole-portfolio figure for the period.
 *
 * Cash only, deliberately: percentages don't sum to anything meaningful, so the
 * totals bar shows the same figures whichever rank mode is active.
 *
 * Entries with no period figure (no price history, or a foreign currency with no
 * reachable FX pair) can't be counted, so `netChange` is the net change across the
 * entries we *could* value — `countedEntries`/`excludedEntries` let the UI say so
 * rather than passing off a partial sum as the portfolio's net change.
 */
export function periodTotals(entries: RankingEntry[]): PeriodTotals {
  let totalGains = 0;
  let totalLosses = 0;
  let countedEntries = 0;
  let excludedEntries = 0;

  for (const entry of entries) {
    const value = entry.periodReturnBase;
    if (value === null) {
      excludedEntries += 1;
      continue;
    }

    countedEntries += 1;
    if (value > 0) {
      totalGains += value;
    } else if (value < 0) {
      totalLosses += value;
    }
  }

  return {
    totalGains,
    totalLosses,
    netChange: totalGains + totalLosses,
    countedEntries,
    excludedEntries,
  };
}
