export type ActivityKind = "BUY" | "SELL" | "DIVIDEND" | "SPLIT";

export interface Activity {
  activityDate: string; // ISO date, "YYYY-MM-DD"
  kind: ActivityKind;
  quantity: number; // shares (BUY/SELL only)
  price: number; // GBP per share (BUY/SELL only)
  /**
   * BUY/SELL: quantity*price + fee (GBP). DIVIDEND: cash in GBP.
   * SPLIT: **not cash** — the split ratio (5 = a 5-for-1 split). Wealthfolio
   * overloads `amount` to carry the ratio, so a split must never be summed into
   * a cash flow; see `splitRatio`.
   */
  amount: number;
  fee: number;
}

/**
 * The share multiplier for a SPLIT, or 1 for anything else.
 *
 * Splits adjust the *units* you hold without moving any cash, so they are the
 * one activity that changes a position's size for free. Tesla split 5-for-1 in
 * 2020 and 3-for-1 in 2022: a 3-share holding from 2018 is 45 shares today.
 * Ignoring these under-counted the position by a factor of 15 and quietly
 * corrupted every market value and percentage derived from it.
 *
 * A ratio of 0 or less would zero out a position, so it is treated as 1 (no-op)
 * rather than trusted — a malformed row should not silently delete a holding.
 */
export function splitRatio(activity: Activity): number {
  if (activity.kind !== "SPLIT") {
    return 1;
  }
  return activity.amount > 0 ? activity.amount : 1;
}

export interface Holding {
  ticker: string;
  name: string;
  activities: Activity[];
  quotesGbp: Map<string, number>; // date -> close price per share, in GBP
}

export interface PointInTimeState {
  units: number;
  costBasis: number;
  close: number | null;
  marketValue: number | null; // null when close is unknown
}

export interface PeriodFlows {
  buys: number;
  sells: number;
  dividends: number;
  netInvested: number;
}
