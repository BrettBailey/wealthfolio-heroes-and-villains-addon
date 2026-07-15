import { describe, expect, it } from "vitest";
import {
  makeFakeAccount,
  makeFakeActivity,
  makeFakeCashHolding,
  makeFakeExchangeRate,
  makeFakeHolding,
  makeFakeHostApi,
  makeFakeQuote,
} from "../fixtures/fakeHostApi";
import { buildRankingEntries } from "./buildRankingEntries";

const DATE_RANGE = { startDate: "2025-01-01", endDate: "2025-02-01" };

describe("buildRankingEntries", () => {
  it("keeps distinct symbols as separate entries", async () => {
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
    const holdings = new Map([
      [
        "acc-1",
        [
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "AAPL",
            marketValueBase: 1000,
            totalGainBase: 100,
            totalGainPct: 10,
          }),
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "MSFT",
            marketValueBase: 2000,
            totalGainBase: -50,
            totalGainPct: -2.5,
          }),
        ],
      ],
    ]);

    const entries = await buildRankingEntries(makeFakeHostApi(accounts, holdings), accounts, DATE_RANGE);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.symbol).sort()).toEqual(["AAPL", "MSFT"]);
  });

  it("merges the same symbol held across multiple accounts into one entry", async () => {
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" }), makeFakeAccount({ id: "acc-2", name: "SIPP" })];
    const holdings = new Map([
      [
        "acc-1",
        [
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "AAPL",
            marketValueBase: 1000,
            totalGainBase: 100,
            totalGainPct: 10,
          }),
        ],
      ],
      [
        "acc-2",
        [
          makeFakeHolding({
            accountId: "acc-2",
            symbol: "AAPL",
            marketValueBase: 500,
            totalGainBase: 50,
            totalGainPct: 10,
          }),
        ],
      ],
    ]);

    const entries = await buildRankingEntries(makeFakeHostApi(accounts, holdings), accounts, DATE_RANGE);

    expect(entries).toHaveLength(1);
    const merged = entries[0];
    expect(merged.accountIds.sort()).toEqual(["acc-1", "acc-2"]);
    expect(merged.marketValueBase).toBe(1500);
    expect(merged.totalGainBase).toBe(150);
  });

  it("skips holdings with no instrument", async () => {
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
    const noInstrumentHolding = makeFakeHolding({ accountId: "acc-1", symbol: "CASH", marketValueBase: 500 });
    noInstrumentHolding.instrument = null;
    const holdings = new Map([["acc-1", [noInstrumentHolding]]]);

    const entries = await buildRankingEntries(makeFakeHostApi(accounts, holdings), accounts, DATE_RANGE);

    expect(entries).toHaveLength(0);
  });

  it("skips cash holdings even though the real host populates a synthetic instrument for them", async () => {
    // Regression test: cash holdings have holdingType "cash" but still carry
    // a populated `instrument` (e.g. id "cash:GBP", symbol "GBP") in the real
    // host, confirmed via Wealthfolio.log ("Asset 'cash:GBP': No quote data
    // found"). Filtering on `instrument == null` alone lets these through.
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
    const holdings = new Map([
      ["acc-1", [makeFakeCashHolding({ accountId: "acc-1", currency: "GBP", marketValueBase: 500 })]],
    ]);

    const entries = await buildRankingEntries(makeFakeHostApi(accounts, holdings), accounts, DATE_RANGE);

    expect(entries).toHaveLength(0);
  });

  it("recomputes a blended all-time percentage rather than summing percentages across accounts", async () => {
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" }), makeFakeAccount({ id: "acc-2", name: "SIPP" })];
    // acc-1: £100 position, +£50 gain (50%). acc-2: £900 position, +£9 gain (1%).
    const holdings = new Map([
      [
        "acc-1",
        [
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "AAPL",
            marketValueBase: 100,
            totalGainBase: 50,
            totalGainPct: 50,
          }),
        ],
      ],
      [
        "acc-2",
        [
          makeFakeHolding({
            accountId: "acc-2",
            symbol: "AAPL",
            marketValueBase: 900,
            totalGainBase: 9,
            totalGainPct: 1,
          }),
        ],
      ],
    ]);

    const entries = await buildRankingEntries(makeFakeHostApi(accounts, holdings), accounts, DATE_RANGE);

    // Naive average of 50% and 1% would be 25.5%; correct cash-weighted blend is 59/1000 = 5.9%.
    expect(entries[0].totalGainPct).toBeCloseTo(5.9, 6);
  });

  it("preserves the instrument id alongside the symbol", async () => {
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
    const holdings = new Map([
      [
        "acc-1",
        [
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "SMT",
            instrumentId: "4060f374-asset-id",
            marketValueBase: 1000,
          }),
        ],
      ],
    ]);

    const entries = await buildRankingEntries(makeFakeHostApi(accounts, holdings), accounts, DATE_RANGE);

    expect(entries[0].instrumentId).toBe("4060f374-asset-id");
  });

  it("computes real period-scoped cash/pct figures from activity and quote history for base-currency instruments", async () => {
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
    const holdings = new Map([
      [
        "acc-1",
        [
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "AAPL",
            instrumentId: "asset-aapl",
            currency: "GBP",
            marketValueBase: 1200,
          }),
        ],
      ],
    ]);
    const activitiesByAccountId = new Map([
      [
        "acc-1",
        [
          makeFakeActivity({
            accountId: "acc-1",
            assetId: "asset-aapl",
            assetSymbol: "AAPL",
            activityType: "BUY",
            date: "2025-01-01",
            quantity: "10",
            unitPrice: "10",
            amount: "100",
          }),
        ],
      ],
    ]);
    const quotesByInstrumentId = new Map([
      [
        "asset-aapl",
        [
          makeFakeQuote({ assetId: "asset-aapl", date: "2024-12-31", close: 10 }),
          makeFakeQuote({ assetId: "asset-aapl", date: "2025-02-01", close: 12 }),
        ],
      ],
    ]);

    const api = makeFakeHostApi(accounts, holdings, {
      activitiesByAccountId,
      quotesByInstrumentId,
      baseCurrency: "GBP",
    });
    const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

    expect(entries[0].periodDataAvailable).toBe(true);
    expect(entries[0].periodReturnBase).toBe(20); // (120 end MV - 0 start MV) - 100 invested
    expect(entries[0].periodReturn).toBeCloseTo(0.2, 6); // +20%

    // The breakdown behind the (i) pill must be the *same* sum that produced the
    // figures above, not a plausible-looking recomputation of it.
    expect(entries[0].breakdown).toEqual({
      marketValueStart: 0,
      marketValueEnd: 120,
      buys: 100,
      sells: 0,
      dividends: 0,
    });
  });

  it("leaves the breakdown null when there is no period figure to explain", async () => {
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
    const holdings = new Map([
      [
        "acc-1",
        [
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "AAPL",
            instrumentId: "asset-aapl",
            currency: "GBP",
            marketValueBase: 1200,
          }),
        ],
      ],
    ]);

    // No quotes at all: no market value on either boundary, so no cash return.
    const api = makeFakeHostApi(accounts, holdings, { baseCurrency: "GBP" });
    const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

    expect(entries[0].periodReturnBase).toBeNull();
    expect(entries[0].breakdown).toBeNull();
  });

  it("derives a BUY's cash value from quantity x unitPrice when the host reports a null amount", async () => {
    // Wealthfolio stores `amount` as NULL on every BUY (verified against the real
    // DB: 615/615 rows). Reading it directly made every purchase look like a £0
    // cash flow, so money paid *in* was counted as investment growth: a top-up of
    // an existing position showed a wildly inflated return. This mirrors the real
    // CTY case that exposed it — held from before the period, topped up during it.
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
    const holdings = new Map([
      [
        "acc-1",
        [
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "CTY",
            instrumentId: "asset-cty",
            currency: "GBP",
            marketValueBase: 2400,
          }),
        ],
      ],
    ]);
    const activitiesByAccountId = new Map([
      [
        "acc-1",
        [
          // Opening position, before the window: 100 shares @ £10.
          makeFakeActivity({
            accountId: "acc-1",
            assetId: "asset-cty",
            assetSymbol: "CTY",
            activityType: "BUY",
            date: "2024-12-01",
            quantity: "100",
            unitPrice: "10",
          }),
          // Top-up inside the window: 100 shares @ £11 = £1,100 of new money.
          // Note: no `amount` — exactly as the host reports it.
          makeFakeActivity({
            accountId: "acc-1",
            assetId: "asset-cty",
            assetSymbol: "CTY",
            activityType: "BUY",
            date: "2025-01-15",
            quantity: "100",
            unitPrice: "11",
          }),
        ],
      ],
    ]);
    const quotesByInstrumentId = new Map([
      [
        "asset-cty",
        [
          makeFakeQuote({ assetId: "asset-cty", date: "2024-12-31", close: 10 }),
          makeFakeQuote({ assetId: "asset-cty", date: "2025-02-01", close: 12 }),
        ],
      ],
    ]);

    const api = makeFakeHostApi(accounts, holdings, {
      activitiesByAccountId,
      quotesByInstrumentId,
      baseCurrency: "GBP",
    });
    const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

    // Start MV 100 x £10 = £1,000. End MV 200 x £12 = £2,400. Buys £1,100.
    // Return = (2400 - 1000) - 1100 = £300, on a base of 1000 + 1100 = 14.29%.
    // Treating the buy as £0 would report £1,400 and a nonsense 140%.
    expect(entries[0].periodReturnBase).toBeCloseTo(300, 6);
    expect(entries[0].periodReturn).toBeCloseTo(0.142857, 5); // +14.29%
  });

  it("does not let one instrument's quote/activity lookup failure fail the whole batch", async () => {
    const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
    const holdings = new Map([
      [
        "acc-1",
        [
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "AAPL",
            instrumentId: "asset-aapl",
            currency: "GBP",
            marketValueBase: 1000,
          }),
          makeFakeHolding({
            accountId: "acc-1",
            symbol: "MSFT",
            instrumentId: "asset-msft",
            currency: "GBP",
            marketValueBase: 2000,
          }),
        ],
      ],
    ]);

    const api = makeFakeHostApi(accounts, holdings, { baseCurrency: "GBP" });
    api.quotes.getHistory = async (assetId: string) => {
      if (assetId === "asset-aapl") {
        throw new Error("simulated failure");
      }
      return [];
    };

    const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

    expect(entries).toHaveLength(2);
    const aapl = entries.find((entry) => entry.symbol === "AAPL")!;
    expect(aapl.periodDataAvailable).toBe(false);
    const msft = entries.find((entry) => entry.symbol === "MSFT")!;
    expect(msft.periodDataAvailable).toBe(true);
  });

  describe("currency handling", () => {
    // Verified against Brett's real DB (2026-07-13): Wealthfolio quotes some UK
    // equities in pence (`GBp`, e.g. CTY ~567) while the broker records the
    // matching activities in pounds (`GBP`, e.g. CTY unit price 5.67). Since
    // periodStats subtracts activity cash flows from quote-derived market
    // values, failing to reconcile the two scales is wrong by a factor of 100.
    it("scales pence-quoted (GBp) instruments to pounds so they reconcile with GBP activities", async () => {
      const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
      const holdings = new Map([
        [
          "acc-1",
          [
            makeFakeHolding({
              accountId: "acc-1",
              symbol: "CTY",
              instrumentId: "asset-cty",
              currency: "GBp", // quoted in pence
              marketValueBase: 1200,
            }),
          ],
        ],
      ]);
      // Bought 100 shares at £5.00 = £500 (activity in POUNDS).
      const activitiesByAccountId = new Map([
        [
          "acc-1",
          [
            makeFakeActivity({
              accountId: "acc-1",
              assetId: "asset-cty",
              assetSymbol: "CTY",
              activityType: "BUY",
              date: "2025-01-01",
              quantity: "100",
              unitPrice: "5",
              amount: "500",
            }),
          ],
        ],
      ]);
      // Quotes in PENCE: 500p = £5.00 opening, 600p = £6.00 closing.
      const quotesByInstrumentId = new Map([
        [
          "asset-cty",
          [
            makeFakeQuote({ assetId: "asset-cty", date: "2024-12-31", close: 500, currency: "GBp" }),
            makeFakeQuote({ assetId: "asset-cty", date: "2025-02-01", close: 600, currency: "GBp" }),
          ],
        ],
      ]);

      const api = makeFakeHostApi(accounts, holdings, {
        activitiesByAccountId,
        quotesByInstrumentId,
        baseCurrency: "GBP",
      });
      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      // 100 shares: closing MV £600, £500 invested during the period => £100 gain.
      // Without pence scaling the closing MV would read as £60,000 and the gain
      // would come out at £59,500.
      expect(entries[0].periodDataAvailable).toBe(true);
      expect(entries[0].periodReturnBase).toBeCloseTo(100, 6);
      expect(entries[0].periodReturn).toBeCloseTo(0.2, 6); // 100 / 500 invested = +20%
    });

    it("reads the quote currency from the asset profile, not the holding's instrument.currency", async () => {
      // Regression test for the real-app bug (2026-07-13): the host reports a
      // NORMALISED `GBP` on `Holding.instrument.currency` for London stocks
      // whose quotes are actually in pence. Only `Asset.quoteCcy` carries the
      // true `GBp`. Reading the holding's field meant SMT/CTY/TMPL/RPI/ALW were
      // never scaled and came out 100x too large. Earlier fixtures hid this by
      // making both fields agree, so they must disagree here.
      const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
      const holdings = new Map([
        [
          "acc-1",
          [
            makeFakeHolding({
              accountId: "acc-1",
              symbol: "SMT",
              instrumentId: "asset-smt",
              currency: "GBP", // what the holding claims...
              marketValueBase: 1000,
            }),
          ],
        ],
      ]);
      const activitiesByAccountId = new Map([
        [
          "acc-1",
          [
            makeFakeActivity({
              accountId: "acc-1",
              assetId: "asset-smt",
              assetSymbol: "SMT",
              activityType: "BUY",
              date: "2025-01-01",
              quantity: "100",
              unitPrice: "10", // £10/share, in pounds
              amount: "1000",
            }),
          ],
        ],
      ]);
      const quotesByInstrumentId = new Map([
        [
          "asset-smt",
          [
            makeFakeQuote({ assetId: "asset-smt", date: "2024-12-31", close: 1000 }), // 1000p = £10
            makeFakeQuote({ assetId: "asset-smt", date: "2025-02-01", close: 1200 }), // 1200p = £12
          ],
        ],
      ]);

      const api = makeFakeHostApi(accounts, holdings, {
        activitiesByAccountId,
        quotesByInstrumentId,
        baseCurrency: "GBP",
        // ...versus what the asset profile actually says.
        quoteCurrencyByInstrumentId: new Map([["asset-smt", "GBp"]]),
      });
      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      // 100 shares closing at £12 = £1200, £1000 invested => £200 gain.
      // Trusting instrument.currency ("GBP") would leave the quotes unscaled:
      // a closing value of £120,000 and a nonsense £119,000 gain.
      expect(entries[0].periodDataAvailable).toBe(true);
      expect(entries[0].periodReturnBase).toBeCloseTo(200, 6);
      expect(entries[0].periodReturn).toBeCloseTo(0.2, 6); // +20%
    });

    it("converts a USD instrument using the FX rate on each quote's own date", async () => {
      const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
      const holdings = new Map([
        [
          "acc-1",
          [
            makeFakeHolding({
              accountId: "acc-1",
              symbol: "TSLA",
              instrumentId: "asset-tsla",
              currency: "USD",
              marketValueBase: 1000,
            }),
          ],
        ],
      ]);
      // Bought 10 shares for £800 (broker records activities in GBP).
      const activitiesByAccountId = new Map([
        [
          "acc-1",
          [
            makeFakeActivity({
              accountId: "acc-1",
              assetId: "asset-tsla",
              assetSymbol: "TSLA",
              activityType: "BUY",
              date: "2025-01-01",
              quantity: "10",
              unitPrice: "80",
              amount: "800",
            }),
          ],
        ],
      ]);
      const quotesByInstrumentId = new Map([
        [
          "asset-tsla",
          [
            makeFakeQuote({ assetId: "asset-tsla", date: "2024-12-31", close: 100, currency: "USD" }),
            makeFakeQuote({ assetId: "asset-tsla", date: "2025-02-01", close: 120, currency: "USD" }),
          ],
        ],
        // The FX asset's own quote history: the rate STRENGTHENS over the period.
        [
          "fx-usd-gbp",
          [
            makeFakeQuote({ assetId: "fx-usd-gbp", date: "2024-12-31", close: 0.8 }),
            makeFakeQuote({ assetId: "fx-usd-gbp", date: "2025-02-01", close: 0.9 }),
          ],
        ],
      ]);

      const api = makeFakeHostApi(accounts, holdings, {
        activitiesByAccountId,
        quotesByInstrumentId,
        baseCurrency: "GBP",
        exchangeRates: [makeFakeExchangeRate({ id: "fx-usd-gbp", fromCurrency: "USD", toCurrency: "GBP" })],
      });
      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      // Closing MV: 10 shares x $120 x 0.9 = £1080. £800 invested => £280 gain.
      // Using TODAY's rate (0.9) for both dates would be a different answer, and
      // using no rate at all would be wildly different again — this pins that the
      // rate is applied per quote date.
      expect(entries[0].periodDataAvailable).toBe(true);
      expect(entries[0].periodReturnBase).toBeCloseTo(280, 6);
    });

    it("reports no period data for a foreign currency with no reachable FX pair, rather than guessing a rate", async () => {
      const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
      const holdings = new Map([
        [
          "acc-1",
          [
            makeFakeHolding({
              accountId: "acc-1",
              symbol: "SOMEJP",
              instrumentId: "asset-jp",
              currency: "JPY",
              marketValueBase: 1000,
            }),
          ],
        ],
      ]);
      const quotesByInstrumentId = new Map([
        ["asset-jp", [makeFakeQuote({ assetId: "asset-jp", date: "2025-01-15", close: 100, currency: "JPY" })]],
      ]);

      const api = makeFakeHostApi(accounts, holdings, {
        quotesByInstrumentId,
        baseCurrency: "GBP",
        exchangeRates: [], // no JPY/GBP pair
      });
      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      expect(entries[0].periodDataAvailable).toBe(false);
      expect(entries[0].periodReturnBase).toBeNull();
    });

    it("does not treat a GBp instrument as foreign — it needs no FX pair", async () => {
      const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
      const holdings = new Map([
        [
          "acc-1",
          [
            makeFakeHolding({
              accountId: "acc-1",
              symbol: "SMT",
              instrumentId: "asset-smt",
              currency: "GBp",
              marketValueBase: 1000,
            }),
          ],
        ],
      ]);
      const quotesByInstrumentId = new Map([
        [
          "asset-smt",
          [
            makeFakeQuote({ assetId: "asset-smt", date: "2024-12-31", close: 1000, currency: "GBp" }),
            makeFakeQuote({ assetId: "asset-smt", date: "2025-02-01", close: 1100, currency: "GBp" }),
          ],
        ],
      ]);

      // No exchange rates configured at all: a GBp holding must still work.
      const api = makeFakeHostApi(accounts, holdings, { quotesByInstrumentId, baseCurrency: "GBP" });
      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      expect(entries[0].periodDataAvailable).toBe(true);
    });
  });

  describe("positions closed during the period", () => {
    // A position sold off inside the window is no longer in getHoldings, but it
    // still moved during the period, so it must rank alongside open positions
    // (tagged closed). Discovered from activity history. See PLAN.md item 3.
    const noHoldings = new Map<string, ReturnType<typeof makeFakeHolding>[]>();

    function soldDuringPeriod() {
      const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
      // Bought before the period at £10, sold inside it at £15: a £50 gain on 10 shares.
      // The opening BUY matters: the position on the period's first day is derived
      // from activity history, and `activities.getAll` returns the full history, so
      // omitting it here would model a sale of shares never bought.
      const activitiesByAccountId = new Map([
        [
          "acc-1",
          [
            makeFakeActivity({
              accountId: "acc-1",
              assetId: "asset-tsla",
              assetSymbol: "TSLA",
              activityType: "BUY",
              date: "2024-06-01",
              quantity: "10",
              unitPrice: "10",
              amount: "100",
            }),
            makeFakeActivity({
              accountId: "acc-1",
              assetId: "asset-tsla",
              assetSymbol: "TSLA",
              activityType: "SELL",
              date: "2025-01-20",
              quantity: "10",
              unitPrice: "15",
              amount: "150",
            }),
          ],
        ],
      ]);
      const quotesByInstrumentId = new Map([
        [
          "asset-tsla",
          [
            makeFakeQuote({ assetId: "asset-tsla", date: "2024-12-31", close: 10 }),
            makeFakeQuote({ assetId: "asset-tsla", date: "2025-02-01", close: 15 }),
          ],
        ],
      ]);
      return { accounts, activitiesByAccountId, quotesByInstrumentId };
    }

    it("includes a position sold during the period, flagged as closed", async () => {
      const { accounts, activitiesByAccountId, quotesByInstrumentId } = soldDuringPeriod();
      const api = makeFakeHostApi(accounts, noHoldings, {
        activitiesByAccountId,
        quotesByInstrumentId,
        baseCurrency: "GBP",
      });

      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      expect(entries).toHaveLength(1);
      expect(entries[0].symbol).toBe("TSLA");
      expect(entries[0].isClosed).toBe(true);
      expect(entries[0].instrumentId).toBe("asset-tsla");
      expect(entries[0].marketValueBase).toBe(0); // no longer held
    });

    it("values a closed position over the period: sale proceeds net against the vanished market value", async () => {
      const { accounts, activitiesByAccountId, quotesByInstrumentId } = soldDuringPeriod();
      const api = makeFakeHostApi(accounts, noHoldings, {
        activitiesByAccountId,
        quotesByInstrumentId,
        baseCurrency: "GBP",
      });

      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      // Opening MV £100 (10 @ £10), closing MV £0, £150 of sells:
      // growth = (0 - 100) - (0 - 150) = £50.
      expect(entries[0].periodDataAvailable).toBe(true);
      expect(entries[0].periodReturnBase).toBe(50);
      expect(entries[0].periodReturn).toBeCloseTo(0.5, 6); // 50 / 100 opening = +50%
    });

    it("leaves all-time figures null for a closed position, which has no Holding to read them from", async () => {
      const { accounts, activitiesByAccountId, quotesByInstrumentId } = soldDuringPeriod();
      const api = makeFakeHostApi(accounts, noHoldings, {
        activitiesByAccountId,
        quotesByInstrumentId,
        baseCurrency: "GBP",
      });

      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      expect(entries[0].totalGainBase).toBeNull();
      expect(entries[0].totalGainPct).toBeNull();
    });

    it("ignores a position sold off before the period started — it did not move during it", async () => {
      const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
      const activitiesByAccountId = new Map([
        [
          "acc-1",
          [
            makeFakeActivity({
              accountId: "acc-1",
              assetId: "asset-old",
              assetSymbol: "OLD",
              activityType: "SELL",
              date: "2024-06-01", // well before DATE_RANGE
              quantity: "10",
              unitPrice: "15",
              amount: "150",
            }),
          ],
        ],
      ]);

      const api = makeFakeHostApi(accounts, noHoldings, { activitiesByAccountId, baseCurrency: "GBP" });
      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      expect(entries).toHaveLength(0);
    });

    it("does not flag a still-held position as closed just because it traded during the period", async () => {
      const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" })];
      const holdings = new Map([
        [
          "acc-1",
          [
            makeFakeHolding({
              accountId: "acc-1",
              symbol: "AAPL",
              instrumentId: "asset-aapl",
              currency: "GBP",
              marketValueBase: 1200,
            }),
          ],
        ],
      ]);
      // A partial sell inside the window, but the position is still held.
      const activitiesByAccountId = new Map([
        [
          "acc-1",
          [
            makeFakeActivity({
              accountId: "acc-1",
              assetId: "asset-aapl",
              assetSymbol: "AAPL",
              activityType: "SELL",
              date: "2025-01-15",
              quantity: "5",
              unitPrice: "12",
              amount: "60",
            }),
          ],
        ],
      ]);

      const api = makeFakeHostApi(accounts, holdings, { activitiesByAccountId, baseCurrency: "GBP" });
      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      expect(entries).toHaveLength(1);
      expect(entries[0].isClosed).toBe(false);
      expect(entries[0].marketValueBase).toBe(1200);
    });

    it("merges a closed position traded in more than one account into a single entry", async () => {
      const accounts = [makeFakeAccount({ id: "acc-1", name: "ISA" }), makeFakeAccount({ id: "acc-2", name: "SIPP" })];
      const sell = (accountId: string) =>
        makeFakeActivity({
          accountId,
          assetId: "asset-tsla",
          assetSymbol: "TSLA",
          activityType: "SELL",
          date: "2025-01-20",
          quantity: "10",
          unitPrice: "15",
          amount: "150",
        });
      const activitiesByAccountId = new Map([
        ["acc-1", [sell("acc-1")]],
        ["acc-2", [sell("acc-2")]],
      ]);

      const api = makeFakeHostApi(accounts, noHoldings, { activitiesByAccountId, baseCurrency: "GBP" });
      const entries = await buildRankingEntries(api, accounts, DATE_RANGE);

      expect(entries).toHaveLength(1);
      expect(entries[0].accountIds.sort()).toEqual(["acc-1", "acc-2"]);
    });
  });
});
