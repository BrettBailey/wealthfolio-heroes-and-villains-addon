import { describe, expect, it } from "vitest";
import type { ActivityDetails, Quote } from "@wealthfolio/addon-sdk";
import { buildFxRateSeries } from "./currency";
import { makeFakeQuote } from "../fixtures/fakeHostApi";
import { toCalcHolding, type CurrencyContext } from "./loadHoldingActivityData";

/** The common case: instrument quoted in the portfolio's own currency, no conversion needed. */
const BASE_CURRENCY_CONTEXT: CurrencyContext = { quoteCurrency: "GBP", baseCurrency: "GBP" };

function makeActivity(overrides: Partial<ActivityDetails> & { activityType: string }): ActivityDetails {
  return {
    id: "act-1",
    subtype: null,
    status: "POSTED",
    date: new Date("2025-01-01T00:00:00Z"),
    quantity: "10",
    unitPrice: "10",
    amount: "100",
    fee: "0",
    currency: "GBP",
    needsReview: false,
    createdAt: new Date("2025-01-01T00:00:00Z"),
    assetId: "asset-1",
    updatedAt: new Date("2025-01-01T00:00:00Z"),
    accountId: "acc-1",
    accountName: "ISA",
    accountCurrency: "GBP",
    assetSymbol: "AAPL",
    ...overrides,
  } as ActivityDetails;
}

function makeQuote(overrides: Partial<Quote>): Quote {
  return {
    id: "q-1",
    createdAt: "2025-01-01T00:00:00Z",
    dataSource: "YAHOO",
    timestamp: "2025-01-01T00:00:00Z",
    assetId: "asset-1",
    open: 10,
    high: 10,
    low: 10,
    volume: 0,
    close: 10,
    adjclose: 10,
    currency: "GBP",
    ...overrides,
  };
}

describe("toCalcHolding", () => {
  it("converts BUY/SELL/DIVIDEND/SPLIT activities and drops the rest", () => {
    const activities = [
      makeActivity({ activityType: "BUY", quantity: "10", unitPrice: "10", amount: "100" }),
      makeActivity({ activityType: "DIVIDEND", quantity: "0", unitPrice: "0", amount: "5" }),
      makeActivity({ activityType: "SPLIT", quantity: "0", unitPrice: "0", amount: "5" }),
      makeActivity({ activityType: "FEE", amount: "1" }),
    ];

    const holding = toCalcHolding("AAPL", "Apple", activities, [], BASE_CURRENCY_CONTEXT);

    expect(holding.activities).toHaveLength(3);
    expect(holding.activities.map((activity) => activity.kind)).toEqual(["BUY", "DIVIDEND", "SPLIT"]);
  });

  it("passes a SPLIT's ratio through in `amount` rather than deriving a cash value", () => {
    // A split carries quantity 0, so the usual `quantity x unitPrice` derivation
    // would produce a ratio of 0 and wipe the position out entirely. The host
    // stores the ratio in `amount` (5 = 5-for-1); it must survive untouched.
    const activities = [makeActivity({ activityType: "SPLIT", quantity: "0", unitPrice: "0", amount: "5" })];

    const holding = toCalcHolding("TSLA", "Tesla", activities, [], BASE_CURRENCY_CONTEXT);

    expect(holding.activities[0].amount).toBe(5);
  });

  it("parses string amount/quantity/price fields into numbers", () => {
    const activities = [makeActivity({ activityType: "BUY", quantity: "12.5", unitPrice: "3.4", amount: "42.5" })];

    const holding = toCalcHolding("AAPL", "Apple", activities, [], BASE_CURRENCY_CONTEXT);

    expect(holding.activities[0]).toMatchObject({ quantity: 12.5, price: 3.4, amount: 42.5 });
  });

  it("derives a BUY/SELL cash amount from quantity x unitPrice + fee when the host reports no amount", () => {
    // Wealthfolio leaves `amount` null on trades (615/615 BUYs in the real DB) —
    // it is implied by quantity x unitPrice. Reading the null as 0 made every
    // purchase look like free money and wildly inflated period returns.
    const activities = [
      makeActivity({ activityType: "BUY", quantity: "100", unitPrice: "5.59", amount: null, fee: "1.5" }),
      makeActivity({ activityType: "SELL", quantity: "40", unitPrice: "6.25", amount: null, fee: "0" }),
    ];

    const holding = toCalcHolding("CTY", "City of London", activities, [], BASE_CURRENCY_CONTEXT);

    expect(holding.activities[0].amount).toBeCloseTo(560.5, 6); // 100 x 5.59 + 1.50
    expect(holding.activities[1].amount).toBeCloseTo(250, 6); // 40 x 6.25
  });

  it("still reads the stored amount for a DIVIDEND, which has no quantity or price", () => {
    const activities = [makeActivity({ activityType: "DIVIDEND", quantity: "0", unitPrice: "0", amount: "303.57" })];

    const holding = toCalcHolding("CTY", "City of London", activities, [], BASE_CURRENCY_CONTEXT);

    expect(holding.activities[0].amount).toBeCloseTo(303.57, 6);
  });

  it("sorts activities by date ascending", () => {
    const activities = [
      makeActivity({ activityType: "BUY", date: new Date("2025-03-01T00:00:00Z") }),
      makeActivity({ activityType: "BUY", date: new Date("2025-01-01T00:00:00Z") }),
      makeActivity({ activityType: "BUY", date: new Date("2025-02-01T00:00:00Z") }),
    ];

    const holding = toCalcHolding("AAPL", "Apple", activities, [], BASE_CURRENCY_CONTEXT);

    expect(holding.activities.map((activity) => activity.activityDate)).toEqual([
      "2025-01-01",
      "2025-02-01",
      "2025-03-01",
    ]);
  });

  it("builds a date-keyed quote map from close prices", () => {
    const quotes = [
      makeQuote({ timestamp: "2025-01-01T00:00:00Z", close: 10 }),
      makeQuote({ timestamp: "2025-01-02T00:00:00Z", close: 11 }),
    ];

    const holding = toCalcHolding("AAPL", "Apple", [], quotes, BASE_CURRENCY_CONTEXT);

    expect(holding.quotesGbp.get("2025-01-01")).toBe(10);
    expect(holding.quotesGbp.get("2025-01-02")).toBe(11);
  });

  it("scales a pence-quoted (GBp) instrument's quotes into pounds", () => {
    const quotes = [makeQuote({ timestamp: "2025-01-01T00:00:00Z", close: 1447 })]; // SMT, in pence

    const holding = toCalcHolding("SMT", "Scottish Mortgage", [], quotes, {
      quoteCurrency: "GBp",
      baseCurrency: "GBP",
    });

    expect(holding.quotesGbp.get("2025-01-01")).toBeCloseTo(14.47, 10);
  });

  it("converts a foreign-currency instrument's quotes at that date's FX rate", () => {
    const quotes = [
      makeQuote({ timestamp: "2025-01-01T00:00:00Z", close: 100 }),
      makeQuote({ timestamp: "2025-01-02T00:00:00Z", close: 200 }),
    ];
    const fxRates = buildFxRateSeries([
      makeFakeQuote({ assetId: "fx", date: "2025-01-01", close: 0.8 }),
      makeFakeQuote({ assetId: "fx", date: "2025-01-02", close: 0.9 }),
    ]);

    const holding = toCalcHolding("TSLA", "Tesla", [], quotes, {
      quoteCurrency: "USD",
      baseCurrency: "GBP",
      fxRates,
    });

    // Each date uses its own rate, not the latest one.
    expect(holding.quotesGbp.get("2025-01-01")).toBeCloseTo(80, 10);
    expect(holding.quotesGbp.get("2025-01-02")).toBeCloseTo(180, 10);
  });

  it("throws for a foreign-currency instrument with no rate series, rather than leaving prices unconverted", () => {
    const quotes = [makeQuote({ timestamp: "2025-01-01T00:00:00Z", close: 100 })];

    expect(() => toCalcHolding("TSLA", "Tesla", [], quotes, { quoteCurrency: "USD", baseCurrency: "GBP" })).toThrow(
      /No FX rate series/,
    );
  });

  it("leaves activity figures in their recorded currency: the broker reports them in base currency already", () => {
    // CTY: quotes in pence, but the buy is recorded in pounds (unit price 5.67,
    // not 567). Scaling activities as well as quotes would be wrong by 100x.
    const activities = [
      makeActivity({
        activityType: "BUY",
        date: new Date("2025-01-01T00:00:00Z"),
        quantity: "100",
        unitPrice: "5.67",
        amount: "567",
      }),
    ];

    const holding = toCalcHolding("CTY", "City of London", activities, [], {
      quoteCurrency: "GBp",
      baseCurrency: "GBP",
    });

    expect(holding.activities[0].price).toBeCloseTo(5.67, 10);
    expect(holding.activities[0].amount).toBeCloseTo(567, 10);
  });
});
