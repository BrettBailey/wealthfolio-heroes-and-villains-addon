import type {
  Account,
  ActivityDetails,
  Asset,
  ExchangeRate,
  Holding,
  HostAPI,
  Quote,
  Settings,
  StorageAPI,
} from "@wealthfolio/addon-sdk";

/**
 * In-memory stand-in for the host's durable per-addon storage. Seed it with
 * `initial` to model a value persisted by an earlier session.
 */
export function makeFakeStorage(initial: Record<string, string> = {}): StorageAPI & { entries: Map<string, string> } {
  const entries = new Map(Object.entries(initial));
  return {
    entries,
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: string) => {
      entries.set(key, value);
    },
    delete: async (key: string) => {
      entries.delete(key);
    },
  };
}

/** Minimal in-memory HostAPI covering only what this addon calls, for testing without the real Wealthfolio app. */
export function makeFakeHostApi(
  accounts: Account[],
  holdingsByAccountId: Map<string, Holding[]>,
  options: {
    activitiesByAccountId?: Map<string, ActivityDetails[]>;
    quotesByInstrumentId?: Map<string, Quote[]>;
    baseCurrency?: string;
    /**
     * FX pairs the host knows about. `id` is the FX asset's id, whose quote
     * history is fetched through `quotes.getHistory` like any other asset —
     * so put the rate series in `quotesByInstrumentId` under that same id.
     */
    exchangeRates?: ExchangeRate[];
    /**
     * The *quote* currency per instrument id (`Asset.quoteCcy`), e.g. `GBp` for
     * a pence-quoted London stock. This is a different field from the holding's
     * `instrument.currency` — see `resolveQuoteCurrencies`. Defaults to the
     * holding's own currency when not specified.
     */
    quoteCurrencyByInstrumentId?: Map<string, string>;
  } = {},
): Pick<HostAPI, "accounts" | "portfolio" | "activities" | "quotes" | "settings" | "exchangeRates" | "assets"> {
  const activitiesByAccountId = options.activitiesByAccountId ?? new Map();
  const quotesByInstrumentId = options.quotesByInstrumentId ?? new Map();
  const baseCurrency = options.baseCurrency ?? "GBP";
  const exchangeRates = options.exchangeRates ?? [];
  const quoteCurrencyByInstrumentId = options.quoteCurrencyByInstrumentId ?? new Map();

  const holdingCurrency = (assetId: string) => {
    for (const holdings of holdingsByAccountId.values()) {
      const match = holdings.find((holding) => holding.instrument?.id === assetId);
      if (match?.instrument) {
        return match.instrument.currency;
      }
    }
    return baseCurrency;
  };

  return {
    assets: {
      getProfile: async (assetId: string) =>
        makeFakeAsset({
          id: assetId,
          quoteCcy: quoteCurrencyByInstrumentId.get(assetId) ?? holdingCurrency(assetId),
        }),
      updateProfile: async () => {
        throw new Error("not implemented in fake");
      },
      updateQuoteMode: async () => {
        throw new Error("not implemented in fake");
      },
    },
    exchangeRates: {
      getAll: async () => exchangeRates,
      update: async () => {
        throw new Error("not implemented in fake");
      },
      add: async () => {
        throw new Error("not implemented in fake");
      },
    },
    accounts: {
      getAll: async () => accounts,
      create: async () => {
        throw new Error("not implemented in fake");
      },
    },
    portfolio: {
      getHoldings: async (accountId: string) => holdingsByAccountId.get(accountId) ?? [],
      getHolding: async () => null,
      update: async () => {},
      recalculate: async () => {},
      getIncomeSummary: async () => [],
      getHistoricalValuations: async () => [],
      getLatestValuations: async () => [],
    },
    activities: {
      getAll: async (accountId?: string) =>
        accountId ? (activitiesByAccountId.get(accountId) ?? []) : [...activitiesByAccountId.values()].flat(),
      search: async () => {
        throw new Error("not implemented in fake");
      },
      create: async () => {
        throw new Error("not implemented in fake");
      },
      update: async () => {
        throw new Error("not implemented in fake");
      },
      saveMany: async () => {
        throw new Error("not implemented in fake");
      },
      import: async () => {
        throw new Error("not implemented in fake");
      },
      checkImport: async () => {
        throw new Error("not implemented in fake");
      },
      getImportMapping: async () => {
        throw new Error("not implemented in fake");
      },
      saveImportMapping: async () => {
        throw new Error("not implemented in fake");
      },
    },
    quotes: {
      getHistory: async (assetId: string) => quotesByInstrumentId.get(assetId) ?? [],
      update: async () => {},
    },
    settings: {
      get: async () => makeFakeSettings({ baseCurrency }),
      update: async () => {
        throw new Error("not implemented in fake");
      },
      backupDatabase: async () => {
        throw new Error("not implemented in fake");
      },
    },
  };
}

export function makeFakeSettings(overrides: Partial<Settings> = {}): Settings {
  return {
    theme: "light",
    font: "default",
    baseCurrency: "GBP",
    defaultReturnMetric: "twr",
    onboardingCompleted: true,
    autoUpdateCheckEnabled: false,
    menuBarVisible: true,
    syncEnabled: false,
    ...overrides,
  };
}

/**
 * Models how Wealthfolio actually stores an activity — which is not how you
 * would naively fake one. **A BUY/SELL has a null `amount`**: the trade's cash
 * value is implied by `quantity * unitPrice (+ fee)`, and only cash-only
 * activities (DIVIDEND, INTEREST, DEPOSIT) carry an explicit `amount`. Verified
 * against the real DB (2026-07-14): all 615 BUY rows and 32 of 35 SELL rows have
 * `amount = NULL`, and `ActivityDetails.amount` is typed `string | null`.
 *
 * The default therefore leaves `amount` null unless a caller sets it. An earlier
 * version defaulted it to `"0"` and every test dutifully passed one in for buys,
 * which made a real bug — the loader reading `amount` for BUY/SELL and getting
 * zero for every trade — structurally invisible to the suite. Keep the fixture
 * as stingy as the host is.
 */
export function makeFakeActivity(overrides: {
  accountId: string;
  assetId: string;
  assetSymbol: string;
  activityType: string;
  date: string;
  quantity?: string;
  unitPrice?: string;
  amount?: string | null;
  fee?: string;
  currency?: string;
}): ActivityDetails {
  return {
    id: `${overrides.accountId}-${overrides.assetId}-${overrides.date}-${overrides.activityType}`,
    activityType: overrides.activityType as ActivityDetails["activityType"],
    status: "POSTED",
    date: new Date(`${overrides.date}T00:00:00Z`),
    quantity: overrides.quantity ?? "0",
    unitPrice: overrides.unitPrice ?? "0",
    amount: overrides.amount ?? null,
    fee: overrides.fee ?? "0",
    currency: overrides.currency ?? "GBP",
    needsReview: false,
    createdAt: new Date(`${overrides.date}T00:00:00Z`),
    assetId: overrides.assetId,
    updatedAt: new Date(`${overrides.date}T00:00:00Z`),
    accountId: overrides.accountId,
    accountName: overrides.accountId,
    accountCurrency: "GBP",
    assetSymbol: overrides.assetSymbol,
  };
}

export function makeFakeQuote(overrides: { assetId: string; date: string; close: number; currency?: string }): Quote {
  return {
    id: `${overrides.assetId}-${overrides.date}`,
    createdAt: `${overrides.date}T00:00:00Z`,
    dataSource: "YAHOO",
    timestamp: `${overrides.date}T00:00:00Z`,
    assetId: overrides.assetId,
    open: overrides.close,
    high: overrides.close,
    low: overrides.close,
    volume: 0,
    close: overrides.close,
    adjclose: overrides.close,
    currency: overrides.currency ?? "GBP",
  };
}

/**
 * An asset profile. `quoteCcy` is the currency the asset's *quotes* are
 * denominated in (e.g. `GBp` for a pence-quoted London stock) — the field the
 * addon must read to scale prices correctly, and NOT the same as the holding's
 * `instrument.currency`, which the real host normalises to `GBP`.
 */
export function makeFakeAsset(overrides: { id: string; quoteCcy: string }): Asset {
  return {
    id: overrides.id,
    kind: "INVESTMENT",
    quoteMode: "MARKET",
    quoteCcy: overrides.quoteCcy,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  } as Asset;
}

/**
 * An FX pair as the host reports it. `id` is the underlying FX asset's id — the
 * real host derives its exchange-rate list from `kind: 'FX'` assets (there is no
 * exchange_rates table), so this id is what `quotes.getHistory` takes to fetch
 * the historical rate series.
 */
export function makeFakeExchangeRate(overrides: {
  id: string;
  fromCurrency: string;
  toCurrency: string;
  rate?: number;
}): ExchangeRate {
  return {
    id: overrides.id,
    fromCurrency: overrides.fromCurrency,
    toCurrency: overrides.toCurrency,
    rate: overrides.rate ?? 1,
    source: "YAHOO",
    timestamp: "2025-01-01T00:00:00Z",
  };
}

export function makeFakeAccount(overrides: Partial<Account> & { id: string; name: string }): Account {
  return {
    accountType: "SECURITIES",
    group: undefined,
    balance: 0,
    currency: "GBP",
    isDefault: false,
    isActive: true,
    isArchived: false,
    trackingMode: "TRANSACTIONS",
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

export function makeFakeHolding(overrides: {
  accountId: string;
  symbol: string;
  /** Defaults to a distinct fake id, distinguishing it from `symbol` the way the real host's asset UUIDs do. */
  instrumentId?: string;
  name?: string;
  /** Instrument quote currency. Defaults to GBP; set to something else to exercise the non-base-currency fallback. */
  currency?: string;
  marketValueBase: number;
  totalGainBase?: number | null;
  totalGainPct?: number | null;
  totalReturnBase?: number | null;
  totalReturnPct?: number | null;
}): Holding {
  return {
    id: `${overrides.accountId}-${overrides.symbol}`,
    holdingType: "security",
    accountId: overrides.accountId,
    instrument: {
      id: overrides.instrumentId ?? `asset-id-${overrides.symbol}`,
      symbol: overrides.symbol,
      name: overrides.name ?? overrides.symbol,
      currency: overrides.currency ?? "GBP",
      quoteMode: "MARKET",
    },
    quantity: 1,
    localCurrency: "GBP",
    baseCurrency: "GBP",
    marketValue: { local: overrides.marketValueBase, base: overrides.marketValueBase },
    totalGain:
      overrides.totalGainBase == null ? null : { local: overrides.totalGainBase, base: overrides.totalGainBase },
    totalGainPct: overrides.totalGainPct ?? null,
    totalReturn:
      overrides.totalReturnBase == null ? null : { local: overrides.totalReturnBase, base: overrides.totalReturnBase },
    totalReturnPct: overrides.totalReturnPct ?? null,
    weight: 0,
    asOfDate: "2025-01-01",
  };
}

/**
 * Cash holdings carry `holdingType: "cash"` and, in the real host, still
 * populate `instrument` with a synthetic id/symbol (e.g. `cash:GBP`/`GBP`)
 * rather than leaving it null — confirmed 2026-07-13 via Wealthfolio.log
 * (`Asset 'cash:GBP': No quote data found ...`) when this addon mistakenly
 * tried to rank a cash balance. Must be filtered by `holdingType`, not by
 * checking whether `instrument` is present.
 */
export function makeFakeCashHolding(overrides: {
  accountId: string;
  currency: string;
  marketValueBase: number;
}): Holding {
  return {
    id: `${overrides.accountId}-cash-${overrides.currency}`,
    holdingType: "cash",
    accountId: overrides.accountId,
    instrument: {
      id: `cash:${overrides.currency}`,
      symbol: overrides.currency,
      name: overrides.currency,
      currency: overrides.currency,
      quoteMode: "MANUAL",
    },
    quantity: overrides.marketValueBase,
    localCurrency: overrides.currency,
    baseCurrency: "GBP",
    marketValue: { local: overrides.marketValueBase, base: overrides.marketValueBase },
    totalGain: null,
    totalGainPct: null,
    totalReturn: null,
    totalReturnPct: null,
    weight: 0,
    asOfDate: "2025-01-01",
  };
}
