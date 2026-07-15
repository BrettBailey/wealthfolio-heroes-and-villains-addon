import type { ActivityDetails, Quote } from "@wealthfolio/addon-sdk";
import type { Activity, ActivityKind, Holding as CalcHolding } from "../calculations/types";
import { rateOn, toMajorCurrency, toMajorUnits, type FxRateSeries } from "./currency";

/**
 * SPLIT is here because it changes how many shares you hold. It moves no cash,
 * so it contributes nothing to the flows — but leaving it out made `stateOn`
 * value Tesla's 2018 position at its pre-split 3 shares instead of the 45 those
 * became, under-counting the holding 15-fold. See `splitRatio`.
 */
const RELEVANT_ACTIVITY_TYPES: ReadonlySet<string> = new Set(["BUY", "SELL", "DIVIDEND", "SPLIT"]);

export interface CurrencyContext {
  /** The instrument's declared quote currency, e.g. "GBp", "GBP", "USD". */
  quoteCurrency: string;
  /** The portfolio's base currency, e.g. "GBP". */
  baseCurrency: string;
  /**
   * Historical rate series converting the instrument's (major-unit) quote
   * currency into base currency. Required when those differ; ignored otherwise.
   */
  fxRates?: FxRateSeries;
}

/**
 * Converts one instrument's raw activities (already filtered to the relevant
 * accounts) and quote history into the plain `Holding` shape `calculations/`
 * operates on, with every monetary figure normalised to base currency.
 *
 * Two separate conversions are needed, and confusing them is the bug this
 * function exists to prevent:
 *
 *  1. **Pence.** Quotes may be denominated in pence (`GBp`) while activities
 *     from the broker are in pounds (`GBP`) — verified against Brett's real DB,
 *     where CTY's quotes sit around 567 (pence) and its buys record a unit
 *     price of 5.67 (pounds). `periodStats` subtracts activity cash flows from
 *     quote-derived market values, so mixing the two scales silently produces
 *     figures that are wrong by 100x. Quotes are scaled to major units here;
 *     activities are left alone, since the broker already reports them in the
 *     major unit.
 *  2. **Foreign currency.** A USD-quoted instrument's prices are converted at
 *     the rate that applied on each quote's own date, not today's rate, so a
 *     multi-year window doesn't conflate currency movement with price movement.
 *     Brett's activities for USD instruments are already recorded in GBP by the
 *     broker, so again only the quotes need converting.
 *
 * Throws when a foreign-currency instrument has no rate series, rather than
 * silently falling back to an unconverted or today's-rate figure — the caller
 * catches this and reports `periodDataAvailable: false`.
 */
export function toCalcHolding(
  symbol: string,
  name: string,
  instrumentActivities: ActivityDetails[],
  quotes: Quote[],
  currency: CurrencyContext,
): CalcHolding {
  const activities = instrumentActivities
    .map(toCalcActivity)
    .filter((activity): activity is Activity => activity !== null)
    .sort((a, b) => (a.activityDate < b.activityDate ? -1 : a.activityDate > b.activityDate ? 1 : 0));

  const quotesGbp = new Map<string, number>();
  for (const quote of quotes) {
    const date = toIsoDate(quote.timestamp);
    quotesGbp.set(date, toBaseCurrency(quote.close, date, currency));
  }

  return { ticker: symbol, name, activities, quotesGbp };
}

/** Scales a quoted price into base currency: pence -> major units, then FX on that date. */
function toBaseCurrency(close: number, date: string, currency: CurrencyContext): number {
  const majorUnits = toMajorUnits(close, currency.quoteCurrency);

  const quoteCurrencyMajor = toMajorCurrency(currency.quoteCurrency);
  if (quoteCurrencyMajor === currency.baseCurrency) {
    return majorUnits;
  }

  if (!currency.fxRates) {
    throw new Error(`No FX rate series for ${quoteCurrencyMajor}->${currency.baseCurrency}`);
  }

  const rate = rateOn(currency.fxRates, date);
  if (rate === null) {
    throw new Error(`No ${quoteCurrencyMajor}->${currency.baseCurrency} rate on or before ${date}`);
  }

  return majorUnits * rate;
}

function toCalcActivity(activity: ActivityDetails): Activity | null {
  if (!RELEVANT_ACTIVITY_TYPES.has(activity.activityType)) {
    return null;
  }
  // Activities are left in their recorded currency: Brett's broker (ii) reports
  // them in GBP (the base currency) even for pence-quoted and USD-quoted
  // instruments, so they need neither the pence scaling nor the FX conversion
  // that quotes do. Revisit if a broker ever records activities in the
  // instrument's own currency instead.
  const kind = activity.activityType as ActivityKind;
  const fee = Number(activity.fee ?? 0);
  const quantity = Number(activity.quantity ?? 0);
  const price = Number(activity.unitPrice ?? 0);

  // Wealthfolio stores `amount` as null on every BUY and (almost) every SELL —
  // the trade's cash value is implied by quantity x unitPrice, and only
  // cash-only activities like DIVIDEND carry an explicit amount. Deriving it is
  // what the Python reference does too (`calculations.py:126`).
  //
  // SPLIT is the exception that isn't cash at all: Wealthfolio overloads
  // `amount` to hold the *ratio* (5 for a 5-for-1), and its `quantity` is 0, so
  // deriving `quantity * price` would silently yield a ratio of 0 and wipe the
  // position out. Pass the ratio straight through — `splitRatio` reads it.
  const amount = kind === "DIVIDEND" || kind === "SPLIT" ? Number(activity.amount ?? 0) : quantity * price + fee;

  return {
    activityDate: toIsoDate(activity.date),
    kind,
    quantity,
    price,
    amount,
    fee,
  };
}

function toIsoDate(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toISOString().slice(0, 10);
}
