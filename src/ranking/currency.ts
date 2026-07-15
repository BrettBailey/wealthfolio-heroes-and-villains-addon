import type { Quote } from "@wealthfolio/addon-sdk";

/**
 * Wealthfolio quotes some instruments in pence rather than pounds, flagged by
 * the exact currency code `GBp` (lowercase p) on the asset — a Yahoo Finance
 * convention that Wealthfolio carries through.
 *
 * This is decided per security and is *not* derivable from the instrument type,
 * the exchange, or the magnitude of the price: Brett curates `quote_ccy` by
 * hand where Yahoo gets it wrong, and the real DB holds genuine `GBP` funds
 * priced at £100+ per unit alongside `GBp` equities priced in the hundreds of
 * pence. A "that number looks too big to be pounds" heuristic would corrupt
 * exactly those funds, so there is deliberately no such heuristic here: the
 * asset's declared currency is the single source of truth. If a security is
 * labelled wrongly, the fix belongs in Wealthfolio, not in a guess here.
 */
const PENCE_CURRENCY = "GBp";
const PENCE_PER_POUND = 100;

/** True when `currency` denotes a minor unit (pence) rather than the major unit (pounds). */
export function isPenceCurrency(currency: string): boolean {
  return currency === PENCE_CURRENCY;
}

/**
 * The major-unit currency code an instrument's prices resolve to once scaled:
 * `GBp` (pence) is really `GBP` (pounds); everything else is already major.
 */
export function toMajorCurrency(currency: string): string {
  return isPenceCurrency(currency) ? "GBP" : currency;
}

/** Scales a price from the instrument's quoted unit into its major unit (pence -> pounds). */
export function toMajorUnits(value: number, currency: string): number {
  return isPenceCurrency(currency) ? value / PENCE_PER_POUND : value;
}

/**
 * A historical exchange-rate series, keyed by ISO date, converting one currency
 * into another (e.g. USD -> GBP).
 */
export interface FxRateSeries {
  ratesByDate: Map<string, number>;
  /** Ordered ISO dates, ascending, for as-of lookups on non-trading days. */
  dates: string[];
}

export function buildFxRateSeries(quotes: Quote[]): FxRateSeries {
  const ratesByDate = new Map<string, number>();
  for (const quote of quotes) {
    ratesByDate.set(toIsoDate(quote.timestamp), quote.close);
  }
  const dates = [...ratesByDate.keys()].sort();
  return { ratesByDate, dates };
}

/**
 * The exchange rate on `date`, falling back to the most recent earlier rate
 * when `date` is not a trading day (weekend, holiday) — the rate simply has not
 * moved since. Returns null when the series has no rate at or before `date`,
 * i.e. the window predates the FX history, in which case the caller must not
 * invent one.
 */
export function rateOn(series: FxRateSeries, date: string): number | null {
  const exact = series.ratesByDate.get(date);
  if (exact !== undefined) {
    return exact;
  }

  let mostRecentEarlier: string | null = null;
  for (const candidate of series.dates) {
    if (candidate > date) {
      break;
    }
    mostRecentEarlier = candidate;
  }

  return mostRecentEarlier === null ? null : (series.ratesByDate.get(mostRecentEarlier) ?? null);
}

function toIsoDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}
