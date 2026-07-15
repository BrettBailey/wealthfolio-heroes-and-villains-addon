/**
 * How a period's cash return was arrived at, in base currency. Everything here
 * is an input to one of two identities the UI can then state outright:
 *
 *   cash return = (end - start) - (buys - sells) + dividends
 *   simple %    = cash return / (start + buys)
 */
export interface PeriodBreakdown {
  /** Market value the day before the period opened. Zero if not held then. */
  marketValueStart: number;
  /** Market value on the period's last day. Zero for a position closed in-period. */
  marketValueEnd: number;
  buys: number;
  sells: number;
  dividends: number;
}

export interface RankingEntry {
  /** Ticker symbol, used to merge the same holding across multiple accounts and for display. */
  symbol: string;
  /**
   * The instrument's internal asset id (a UUID). Quotes and activities are
   * stored keyed by this id, not by the plain ticker symbol.
   */
  instrumentId: string;
  name: string;
  /** Account ids this entry's holdings are drawn from. */
  accountIds: string[];
  /** Zero for a position closed during the period — it is no longer held. */
  marketValueBase: number;
  /**
   * True when the position was sold off entirely during the selected period.
   * It still moved during the period, so it ranks alongside open positions
   * (see PLAN.md outstanding-work item 3), but the UI tags it as closed so a
   * holding the user no longer owns doesn't look like a mistake.
   */
  isClosed: boolean;
  /**
   * All-time figures from `Holding`, host-computed. Both null for a closed
   * position, which has no `Holding` to read them from.
   *
   * NOTE: `totalGainPct` is the host's own figure and its unit is *unverified* —
   * unlike the period fields below, it is not ours. It is currently never
   * rendered and never ranked on. Check the convention before displaying it, and
   * do not assume it matches `periodReturn`.
   */
  totalGainBase: number | null;
  totalGainPct: number | null;
  /**
   * Cash total-return over the selected period (growth + dividends), in base
   * currency, computed from real activity + quote history. Null when
   * `periodDataAvailable` is false, or when there's no market value on
   * either boundary date of the period.
   */
  periodReturnBase: number | null;
  /**
   * Simple (money-weighted) return over the selected period, as a **fraction**:
   * 0.226 = +22.6%. Fractions are the unit everywhere our own maths flows, from
   * `twr()` through to `GainPercent` (which scales by 100 when formatting).
   */
  periodReturn: number | null;
  /**
   * Daily-chained time-weighted return over the period, as a fraction.
   *
   * Differs from `periodReturn` precisely when money moved mid-period: TWR
   * ignores the timing and size of your own buys and sells, so it measures the
   * holding, not your luck in funding it. Both are shown, since neither answers
   * the other's question ("how did this investment do?" vs "what did my money
   * actually make?").
   */
  periodTwr: number | null;
  /**
   * The figures `periodReturnBase` and `periodReturn` are computed from, so the
   * UI can show its working. Null exactly when `periodReturnBase` is.
   *
   * These are free: `periodStats` already computes every one of them to produce
   * the headline numbers, and previously discarded them.
   */
  breakdown: PeriodBreakdown | null;
  /**
   * False when this instrument's quote currency doesn't match the
   * portfolio's base currency — the addon SDK exposes no historical FX rate
   * series, so period-scoped figures can't be faithfully computed for
   * non-base-currency holdings (see loadHoldingActivityData.ts). Callers
   * should fall back to all-time `Holding` figures and note why.
   */
  periodDataAvailable: boolean;
}

/**
 * How a column is ordered. **The page always uses `gain-cash`** — there is no
 * longer a user-facing toggle (see `RANK_MODE` in HeroesAndVillainsPage for why:
 * "which holdings drove my portfolio's move?" is inherently a cash question, and
 * a percentage ranking is dominated by whichever positions are small enough to
 * swing wildly).
 *
 * `return-pct` is retained because `rankEntries` is parameterised by it and it
 * is worth keeping that seam open — but note it ranks on `periodReturn`, the
 * money-weighted figure, and *nothing* ever ranks on `periodTwr`. TWR ignores
 * position size by design, so ranking on it would let a £200 punt that doubled
 * outrank a £50k holding that made thousands.
 */
export type RankMode = "return-pct" | "gain-cash";
