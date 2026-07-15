import { daysBetween, walkBack } from "./dates";
import { splitRatio, type Activity, type Holding, type PeriodFlows, type PointInTimeState } from "./types";

/** Units, cost basis, close price, and market value at end-of-day `asOfDate`. */
export function stateOn(holding: Holding, asOfDate: string): PointInTimeState {
  let units = 0;
  let costBasis = 0;

  for (const activity of holding.activities) {
    if (activity.activityDate > asOfDate) {
      break;
    }
    if (activity.kind === "BUY") {
      units += activity.quantity;
      costBasis += activity.amount;
    } else if (activity.kind === "SELL") {
      if (units > 0) {
        // reduce cost basis proportionally to the fraction sold
        costBasis -= costBasis * (activity.quantity / units);
      }
      units -= activity.quantity;
    } else if (activity.kind === "SPLIT") {
      // More shares, same money: units scale, cost basis does not. Quotes are
      // already split-adjusted by the provider, so post-split units must be
      // multiplied up to stay consistent with the price series they multiply.
      units *= splitRatio(activity);
    }
  }

  const close = walkBack(holding.quotesGbp, asOfDate, 30);
  const marketValue = close !== null ? units * close : null;
  return { units, costBasis, close, marketValue };
}

export function lastSellDate(holding: Holding): string | null {
  const sellDates = holding.activities
    .filter((activity) => activity.kind === "SELL")
    .map((activity) => activity.activityDate);
  return sellDates.length > 0 ? sellDates.reduce((a, b) => (a > b ? a : b)) : null;
}

/** Cash flows in (startDate, endDate] — startDate is the opening-snapshot day, excluded. */
export function periodFlows(holding: Holding, startDate: string, endDate: string): PeriodFlows {
  let buys = 0;
  let sells = 0;
  let dividends = 0;

  for (const activity of holding.activities) {
    if (activity.activityDate > startDate && activity.activityDate <= endDate) {
      if (activity.kind === "BUY") {
        buys += activity.amount;
      } else if (activity.kind === "SELL") {
        sells += activity.amount;
      } else if (activity.kind === "DIVIDEND") {
        dividends += activity.amount;
      }
    }
  }

  return { buys, sells, dividends, netInvested: buys - sells - dividends };
}

/** Daily-chained time-weighted return over (startDate, endDate], or null if there's no quote data in range. */
export function twr(holding: Holding, startDate: string, endDate: string): number | null {
  const daysInWindow = [...holding.quotesGbp.keys()]
    .filter((quoteDate) => quoteDate >= startDate && quoteDate <= endDate)
    .sort();
  if (daysInWindow.length === 0) {
    return null;
  }

  const priorQuoteDays = [...holding.quotesGbp.keys()].filter((quoteDate) => quoteDate < startDate).sort();

  let previousDay: string;
  let remainingDays: string[];
  if (priorQuoteDays.length > 0) {
    previousDay = priorQuoteDays[priorQuoteDays.length - 1];
    remainingDays = daysInWindow;
  } else {
    // No prior quote: seed baseline from the first in-window quote day.
    // Activities on/before that seed day are folded into opening units; the
    // "blind" stretch before the first quote contributes 0 return.
    previousDay = daysInWindow[0];
    remainingDays = daysInWindow.slice(1);
  }

  const activitiesByDay = new Map<string, Activity[]>();
  for (const activity of holding.activities) {
    if (activity.activityDate >= startDate && activity.activityDate <= endDate) {
      const dayActivities = activitiesByDay.get(activity.activityDate) ?? [];
      dayActivities.push(activity);
      activitiesByDay.set(activity.activityDate, dayActivities);
    }
  }

  let unitsPrevious = stateOn(holding, previousDay).units;
  let chain = 1;
  let contributed = false;

  for (const day of remainingDays) {
    const closePrevious = holding.quotesGbp.get(previousDay)!;
    const closeToday = holding.quotesGbp.get(day)!;
    const marketValueStart = unitsPrevious * closePrevious;

    let flow = 0; // positive = money in (buys), negative = money out (sells, dividends)
    let unitsToday = unitsPrevious;
    for (const activity of activitiesByDay.get(day) ?? []) {
      if (activity.kind === "BUY") {
        flow += activity.amount;
        unitsToday += activity.quantity;
      } else if (activity.kind === "SELL") {
        flow -= activity.amount;
        unitsToday -= activity.quantity;
      } else if (activity.kind === "DIVIDEND") {
        flow -= activity.amount;
      } else if (activity.kind === "SPLIT") {
        // Deliberately no `flow`: a split is not a cash flow. Scaling the units
        // while the (already split-adjusted) close drops by the same ratio keeps
        // market value continuous, so the day contributes ~0 return rather than
        // a spurious jump.
        unitsToday *= splitRatio(activity);
      }
    }

    const marketValueEnd = unitsToday * closeToday;

    if (marketValueStart > 0) {
      chain *= (marketValueEnd - flow) / marketValueStart;
      contributed = true;
    } else if (marketValueEnd > 0 && flow > 0) {
      contributed = true;
    }

    unitsPrevious = unitsToday;
    previousDay = day;
  }

  return contributed ? chain - 1 : null;
}

/**
 * Daily-chained TWR across a combined set of holdings (e.g. all accounts, or all
 * member stocks of a theme). Each day, market value = sum of per-holding market
 * values (using last-known GBP quote); flow = sum of per-holding flows.
 */
export function portfolioTwr(holdings: Holding[], startDate: string, endDate: string): number | null {
  const allQuoteDays = new Set<string>();
  for (const holding of holdings) {
    for (const quoteDate of holding.quotesGbp.keys()) {
      if (quoteDate >= startDate && quoteDate <= endDate) {
        allQuoteDays.add(quoteDate);
      }
    }
  }
  const daysInWindow = [...allQuoteDays].sort();
  if (daysInWindow.length === 0) {
    return null;
  }

  const priorQuoteDays = new Set<string>();
  for (const holding of holdings) {
    for (const quoteDate of holding.quotesGbp.keys()) {
      if (quoteDate < startDate) {
        priorQuoteDays.add(quoteDate);
      }
    }
  }

  let previousDay: string;
  let remainingDays: string[];
  if (priorQuoteDays.size > 0) {
    previousDay = [...priorQuoteDays].sort().slice(-1)[0];
    remainingDays = daysInWindow;
  } else {
    previousDay = daysInWindow[0];
    remainingDays = daysInWindow.slice(1);
  }

  const activitiesByDay = new Map<string, Array<{ holding: Holding; activity: Activity }>>();
  for (const holding of holdings) {
    for (const activity of holding.activities) {
      if (activity.activityDate >= startDate && activity.activityDate <= endDate) {
        const dayEntries = activitiesByDay.get(activity.activityDate) ?? [];
        dayEntries.push({ holding, activity });
        activitiesByDay.set(activity.activityDate, dayEntries);
      }
    }
  }

  // Keyed by holding identity: the same ticker can appear as a separate Holding
  // instance in multiple accounts when rolling up the whole portfolio.
  const unitsByHolding = new Map<Holding, number>(
    holdings.map((holding) => [holding, stateOn(holding, previousDay).units]),
  );

  function portfolioMarketValueOn(day: string): number {
    let total = 0;
    for (const holding of holdings) {
      const units = unitsByHolding.get(holding)!;
      if (units === 0) {
        continue;
      }
      const price = walkBack(holding.quotesGbp, day, 30);
      if (price === null) {
        continue;
      }
      total += units * price;
    }
    return total;
  }

  let chain = 1;
  let contributed = false;

  for (const day of remainingDays) {
    const marketValueStart = portfolioMarketValueOn(previousDay);

    let flow = 0;
    for (const { holding, activity } of activitiesByDay.get(day) ?? []) {
      if (activity.kind === "BUY") {
        flow += activity.amount;
        unitsByHolding.set(holding, unitsByHolding.get(holding)! + activity.quantity);
      } else if (activity.kind === "SELL") {
        flow -= activity.amount;
        unitsByHolding.set(holding, unitsByHolding.get(holding)! - activity.quantity);
      } else if (activity.kind === "DIVIDEND") {
        flow -= activity.amount;
      } else if (activity.kind === "SPLIT") {
        // Units scale, no cash moves — see `twr`.
        unitsByHolding.set(holding, unitsByHolding.get(holding)! * splitRatio(activity));
      }
    }

    const marketValueEnd = portfolioMarketValueOn(day);

    if (marketValueStart > 0) {
      chain *= (marketValueEnd - flow) / marketValueStart;
      contributed = true;
    } else if (marketValueEnd > 0) {
      contributed = true;
    }

    previousDay = day;
  }

  return contributed ? chain - 1 : null;
}

/** Converts a cumulative return to an annualised figure. Returns null if the window is shorter than `annualiseMinDays`. */
export function annualise(
  cumulativeReturn: number | null,
  startDate: string,
  endDate: string,
  annualiseMinDays: number,
): number | null {
  if (cumulativeReturn === null) {
    return null;
  }
  const days = daysBetween(startDate, endDate);
  if (days < annualiseMinDays) {
    return null;
  }
  const years = days / 365.25;
  const base = 1 + cumulativeReturn;
  if (base <= 0) {
    return null;
  }
  return base ** (1 / years) - 1;
}
