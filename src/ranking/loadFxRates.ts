import type { HostAPI } from "@wealthfolio/addon-sdk";
import { buildFxRateSeries, toMajorCurrency, type FxRateSeries } from "./currency";

/**
 * Loads a historical exchange-rate series for each non-base currency held, so
 * period-scoped figures can convert foreign quote history at the rate that
 * applied on each day rather than at today's rate.
 *
 * Wealthfolio stores an FX pair as an ordinary asset (`kind: 'FX'`, e.g.
 * `USD/GBP`) with a full daily quote history — 2,217 daily quotes back to 2018
 * in Brett's DB — so the rate series is fetched with `quotes.getHistory` like
 * any other asset. There is no `assets.findBySymbol` in the SDK, so the FX
 * asset's id is discovered via `exchangeRates.getAll()`, whose `ExchangeRate.id`
 * is that same asset id (there is no separate exchange_rates table in the DB —
 * the rate list is derived from the FX assets themselves).
 *
 * A currency whose pair cannot be found or has no usable history simply gets no
 * series; the caller then reports `periodDataAvailable: false` for instruments
 * in that currency rather than inventing a rate.
 */
export async function loadFxRateSeries(
  api: Pick<HostAPI, "exchangeRates" | "quotes">,
  quoteCurrencies: Iterable<string>,
  baseCurrency: string,
): Promise<Map<string, FxRateSeries>> {
  const foreignCurrencies = new Set<string>();
  for (const currency of quoteCurrencies) {
    // `GBp` is not a foreign currency, just pounds quoted in pence.
    const major = toMajorCurrency(currency);
    if (major !== baseCurrency) {
      foreignCurrencies.add(major);
    }
  }

  if (foreignCurrencies.size === 0) {
    return new Map();
  }

  let exchangeRates;
  try {
    exchangeRates = await api.exchangeRates.getAll();
  } catch {
    return new Map(); // no FX data reachable: callers fall back to "no period data"
  }

  const seriesByCurrency = new Map<string, FxRateSeries>();
  await Promise.all(
    [...foreignCurrencies].map(async (currency) => {
      const pair = exchangeRates.find(
        (rate) => rate.fromCurrency === currency && toMajorCurrency(rate.toCurrency) === baseCurrency,
      );
      if (!pair?.id) {
        return;
      }

      try {
        const quotes = await api.quotes.getHistory(pair.id);
        if (quotes.length > 0) {
          seriesByCurrency.set(currency, buildFxRateSeries(quotes));
        }
      } catch {
        // A missing/unquotable FX asset degrades this currency to "no period
        // data" rather than failing every other instrument's figures.
      }
    }),
  );

  return seriesByCurrency;
}
