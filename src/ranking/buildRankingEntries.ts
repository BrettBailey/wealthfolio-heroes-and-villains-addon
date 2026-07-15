import type { Account, ActivityDetails, Holding, HostAPI } from "@wealthfolio/addon-sdk";
import type { DateRange } from "../periods";
import { toMajorCurrency, type FxRateSeries } from "./currency";
import { loadFxRateSeries } from "./loadFxRates";
import { toCalcHolding } from "./loadHoldingActivityData";
import { periodStats } from "./periodStats";
import type { RankingEntry } from "./types";

interface HeldInstrument {
  symbol: string;
  instrumentId: string;
  name: string;
  currency: string;
  accountIds: string[];
  /** Zero for a position closed during the period. */
  marketValueBase: number;
  isClosed: boolean;
  totalGainBase: number | null;
  totalGainPct: number | null;
}

/**
 * Fetches holdings for the given accounts and merges same-symbol holdings
 * across accounts into one ranking entry each (a stock held in two ISAs
 * appears once, combined). There is no portfolio-wide aggregate endpoint in
 * the addon SDK, so this loops per-account and merges client-side.
 *
 * Period-scoped cash/percentage figures are computed from real activity and
 * quote history (mirroring `entry_period_stats` in
 * heroes-and-villains-report.py) — `performance.calculateSummary` was tried
 * first but has no portfolio cash-flow context for a bare symbol, so it
 * can't return a dividend-inclusive cash return (see PLAN.md milestone 4.5).
 *
 * Positions closed during the period are included too, ranked alongside open
 * ones and flagged `isClosed` — they still moved during the period, and
 * leaving them out would also understate any portfolio-wide totals. They are
 * discovered from activity history (see `addClosedInstruments`), since
 * `getHoldings` only ever returns what is currently held.
 *
 * Instruments quoted in pence (`GBp`) or in a foreign currency are converted to
 * base currency — see `loadHoldingActivityData` for the two conversions and why
 * mixing them up silently produces figures wrong by 100x. Only an instrument
 * whose currency has no reachable FX history reports
 * `periodDataAvailable: false`; callers then fall back to the all-time
 * `totalGainBase`/`totalGainPct` figures for it.
 */
export async function buildRankingEntries(
  api: Pick<HostAPI, "portfolio" | "activities" | "quotes" | "settings" | "exchangeRates" | "assets">,
  accounts: Account[],
  dateRange: DateRange,
): Promise<RankingEntry[]> {
  const [holdingsByAccount, activitiesByAccount, settings] = await Promise.all([
    Promise.all(accounts.map((account) => api.portfolio.getHoldings(account.id))),
    Promise.all(accounts.map((account) => api.activities.getAll(account.id))),
    api.settings.get(),
  ]);

  const instrumentsBySymbol = new Map<string, HeldInstrument>();
  accounts.forEach((account, accountIndex) => {
    for (const holding of holdingsByAccount[accountIndex]) {
      mergeHoldingIntoInstruments(instrumentsBySymbol, holding, account);
    }
  });

  const allActivities = activitiesByAccount.flat();
  addClosedInstruments(instrumentsBySymbol, allActivities, dateRange);

  const instruments = [...instrumentsBySymbol.values()];
  await resolveQuoteCurrencies(api, instruments);

  const fxRatesByCurrency = await loadFxRateSeries(
    api,
    instruments.map((instrument) => instrument.currency),
    settings.baseCurrency,
  );

  return Promise.all(
    instruments.map((instrument) =>
      buildRankingEntry(api, instrument, allActivities, settings.baseCurrency, fxRatesByCurrency, dateRange),
    ),
  );
}

/**
 * Replaces each instrument's currency with its true **quote** currency, read
 * from the asset profile (`Asset.quoteCcy`).
 *
 * This is not the same field as `Holding.instrument.currency`, and the
 * difference is the whole ballgame for pence-quoted stocks. Confirmed against
 * the real app 2026-07-13: `instrument.currency` reports a normalised `GBP` for
 * London stocks whose quotes are actually denominated in pence, so a
 * `GBp` check against it never fires and SMT/CTY/TMPL/RPI/ALW all came out 100x
 * too large. `Asset.quoteCcy` is the field that maps to `assets.quote_ccy` in
 * the DB — the value Brett curates by hand — and it is the unit the *quote
 * history* is actually in, which is what the conversion needs to know.
 *
 * An asset whose profile can't be fetched keeps whatever currency the holding
 * reported: no worse than before, and the entry still degrades safely if that
 * turns out to need an FX rate that isn't there.
 */
async function resolveQuoteCurrencies(api: Pick<HostAPI, "assets">, instruments: HeldInstrument[]): Promise<void> {
  await Promise.all(
    instruments.map(async (instrument) => {
      try {
        const asset = await api.assets.getProfile(instrument.instrumentId);
        if (asset?.quoteCcy) {
          instrument.currency = asset.quoteCcy;
        }
      } catch {
        // Keep the holding-reported currency; the entry degrades safely if wrong.
      }
    }),
  );
}

/**
 * Adds instruments that were traded during the period but are no longer held —
 * i.e. sold off entirely at some point inside the window.
 *
 * `portfolio.getHoldings` only reports current positions, so these are
 * invisible to the merge above despite having moved during the period. They
 * are recovered from activity history, which is already fetched for the
 * period-return maths.
 *
 * Only activity *within the window* counts: an instrument sold off before the
 * period started did not move during it and must not appear. `periodStats`
 * then values it correctly with no further special-casing (its closing market
 * value is zero and the sale proceeds show up as `sells`).
 */
function addClosedInstruments(
  instrumentsBySymbol: Map<string, HeldInstrument>,
  allActivities: ActivityDetails[],
  dateRange: DateRange,
): void {
  for (const activity of allActivities) {
    const symbol = activity.assetSymbol;
    if (!symbol || !activity.assetId) {
      continue;
    }
    if (!isWithinPeriod(activity.date, dateRange)) {
      continue;
    }
    // A split is not a trade: on its own it can neither open nor close a
    // position, and treating it as evidence of one would resurrect a holding
    // that was sold long ago as a phantom zero-value "closed" entry.
    if (activity.activityType === "SPLIT") {
      continue;
    }

    const existing = instrumentsBySymbol.get(symbol);
    if (existing) {
      // Either still held (the holdings merge already covered it), or a closed
      // instrument we have already seen an activity for in another account.
      if (existing.isClosed && !existing.accountIds.includes(activity.accountId)) {
        existing.accountIds.push(activity.accountId);
      }
      continue;
    }

    instrumentsBySymbol.set(symbol, {
      symbol,
      instrumentId: activity.assetId,
      name: activity.assetName ?? symbol,
      // The activity's currency, not strictly the instrument's quote currency —
      // close enough to exclude non-base-currency entries the same way open
      // holdings are, but don't lean on it for anything finer (see PLAN.md).
      currency: activity.currency,
      accountIds: [activity.accountId],
      marketValueBase: 0, // no longer held
      isClosed: true,
      totalGainBase: null, // all-time figures come from `Holding`, and there isn't one
      totalGainPct: null,
    });
  }
}

function isWithinPeriod(activityDate: Date, dateRange: DateRange): boolean {
  const date = toIsoDate(activityDate);
  return date >= dateRange.startDate && date <= dateRange.endDate;
}

function toIsoDate(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}

async function buildRankingEntry(
  api: Pick<HostAPI, "quotes">,
  instrument: HeldInstrument,
  allActivities: ActivityDetails[],
  baseCurrency: string,
  fxRatesByCurrency: Map<string, FxRateSeries>,
  dateRange: DateRange,
): Promise<RankingEntry> {
  const base: RankingEntry = {
    symbol: instrument.symbol,
    instrumentId: instrument.instrumentId,
    name: instrument.name,
    accountIds: instrument.accountIds,
    marketValueBase: instrument.marketValueBase,
    isClosed: instrument.isClosed,
    totalGainBase: instrument.totalGainBase,
    totalGainPct: instrument.totalGainPct,
    periodReturnBase: null,
    periodReturn: null,
    periodTwr: null,
    breakdown: null,
    periodDataAvailable: false,
  };

  try {
    const instrumentActivities = allActivities.filter((activity) => activity.assetId === instrument.instrumentId);
    const quotes = await api.quotes.getHistory(instrument.instrumentId);
    const calcHolding = toCalcHolding(instrument.symbol, instrument.name, instrumentActivities, quotes, {
      quoteCurrency: instrument.currency,
      baseCurrency,
      fxRates: fxRatesByCurrency.get(toMajorCurrency(instrument.currency)),
    });
    const stats = periodStats(calcHolding, dateRange.startDate, dateRange.endDate);

    return {
      ...base,
      periodReturnBase: stats.totalReturnCash,
      periodReturn: stats.simpleReturn,
      periodTwr: stats.twr,
      breakdown:
        stats.totalReturnCash === null
          ? null
          : {
              marketValueStart: stats.marketValueStart,
              marketValueEnd: stats.marketValueEnd,
              buys: stats.buys,
              sells: stats.sells,
              dividends: stats.dividends,
            },
      periodDataAvailable: true,
    };
  } catch (_error) {
    // A single instrument failing — no quotes, or a foreign currency with no
    // reachable FX history — degrades that entry only, rather than the batch.
    return base;
  }
}

function mergeHoldingIntoInstruments(
  instrumentsBySymbol: Map<string, HeldInstrument>,
  holding: Holding,
  account: Account,
): void {
  if (holding.holdingType !== "security") {
    return; // cash and other non-priceable holdings have no return series to rank
  }

  const symbol = holding.instrument?.symbol;
  const instrumentId = holding.instrument?.id;
  const currency = holding.instrument?.currency;
  if (!symbol || !instrumentId || !currency) {
    return;
  }

  const existing = instrumentsBySymbol.get(symbol);
  if (existing) {
    existing.accountIds.push(account.id);
    existing.marketValueBase += holding.marketValue.base;
    existing.totalGainBase = addNullable(existing.totalGainBase, holding.totalGain?.base ?? null);
    existing.totalGainPct = derivePercentFromCash(existing.totalGainBase, existing.marketValueBase);
    return;
  }

  instrumentsBySymbol.set(symbol, {
    symbol,
    instrumentId,
    name: holding.instrument?.name ?? symbol,
    currency,
    accountIds: [account.id],
    marketValueBase: holding.marketValue.base,
    isClosed: false,
    totalGainBase: holding.totalGain?.base ?? null,
    totalGainPct: holding.totalGainPct ?? null,
  });
}

function addNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) {
    return null;
  }
  return (a ?? 0) + (b ?? 0);
}

/**
 * Re-derives a percentage once a second account's holding is merged in, since
 * the host's per-holding totalGainPct can't simply be summed or averaged
 * across accounts.
 */
function derivePercentFromCash(cash: number | null, marketValueBase: number): number | null {
  if (cash === null || marketValueBase <= 0) {
    return null;
  }
  return (cash / marketValueBase) * 100;
}
