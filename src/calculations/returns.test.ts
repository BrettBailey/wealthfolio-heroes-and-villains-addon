import { describe, expect, it } from "vitest";
import {
  makeDividendHolding,
  makeEmptyHolding,
  makeMidPeriodTopUpHolding,
  makePartialSellHolding,
  makeSimpleDoublingHolding,
  makeSplitHolding,
} from "../fixtures/holdings";
import { annualise, lastSellDate, periodFlows, portfolioTwr, stateOn, twr } from "./returns";

describe("stateOn", () => {
  it("reflects units and cost basis after a single buy", () => {
    const holding = makeSimpleDoublingHolding();
    const state = stateOn(holding, "2025-01-01");
    expect(state.units).toBe(10);
    expect(state.costBasis).toBe(1000);
    expect(state.close).toBe(100);
    expect(state.marketValue).toBe(1000);
  });

  it("reduces cost basis proportionally on a partial sell", () => {
    const holding = makePartialSellHolding();
    const state = stateOn(holding, "2025-01-05");
    expect(state.units).toBe(5);
    expect(state.costBasis).toBeCloseTo(500, 6); // half the shares sold -> half the cost basis remains
  });

  it("returns zero units and null close for a holding with no activity or quotes", () => {
    const state = stateOn(makeEmptyHolding(), "2025-01-01");
    expect(state.units).toBe(0);
    expect(state.close).toBeNull();
    expect(state.marketValue).toBeNull();
  });

  it("ignores activity after the as-of date", () => {
    const holding = makeMidPeriodTopUpHolding();
    const state = stateOn(holding, "2025-01-01");
    expect(state.units).toBe(10); // the day-5 top-up buy should not count yet
  });

  it("multiplies units on a split, leaving cost basis and market value untouched", () => {
    const holding = makeSplitHolding();

    const before = stateOn(holding, "2025-01-04");
    expect(before.units).toBe(10);
    expect(before.marketValue).toBe(1000);

    const after = stateOn(holding, "2025-01-05");
    expect(after.units).toBe(20); // 2-for-1
    expect(after.costBasis).toBe(1000); // more shares, same money spent
    // The quote halved to £50 as the units doubled: the position is worth what
    // it was worth. This is the whole point — a split moves no wealth.
    expect(after.marketValue).toBe(1000);
  });

  it("compounds successive splits, as Tesla's 5-for-1 then 3-for-1 did", () => {
    const holding = {
      ticker: "TSLA",
      name: "Tesla",
      activities: [
        { activityDate: "2020-03-18", kind: "BUY" as const, quantity: 3, price: 312, amount: 936, fee: 0 },
        { activityDate: "2020-08-31", kind: "SPLIT" as const, quantity: 0, price: 0, amount: 5, fee: 0 },
        { activityDate: "2022-08-25", kind: "SPLIT" as const, quantity: 0, price: 0, amount: 3, fee: 0 },
      ],
      quotesGbp: new Map([["2026-01-02", 325]]),
    };

    // 3 -> x5 -> 15 -> x3 -> 45. Reading the raw BUY quantity alone gives 3,
    // under-counting the real position fifteenfold.
    expect(stateOn(holding, "2026-01-02").units).toBe(45);
  });
});

describe("lastSellDate", () => {
  it("finds the most recent sell", () => {
    expect(lastSellDate(makePartialSellHolding())).toBe("2025-01-05");
  });

  it("returns null when there are no sells", () => {
    expect(lastSellDate(makeSimpleDoublingHolding())).toBeNull();
  });
});

describe("periodFlows", () => {
  it("sums buys, sells, and dividends within the window, excluding the start day", () => {
    const holding = makePartialSellHolding();
    const flows = periodFlows(holding, "2025-01-01", "2025-01-10");
    expect(flows.buys).toBe(0); // the buy is ON 2025-01-01, which is excluded (start is exclusive)
    expect(flows.sells).toBe(750);
    expect(flows.netInvested).toBe(-750);
  });

  it("includes the buy when the window starts before it", () => {
    const holding = makePartialSellHolding();
    const flows = periodFlows(holding, "2024-12-31", "2025-01-10");
    expect(flows.buys).toBe(1000);
    expect(flows.sells).toBe(750);
  });

  it("treats a split as no cash flow at all", () => {
    // A split's `amount` is a ratio (2), not £2. If it ever leaked into the
    // flows it would corrupt the MWR denominator with imaginary money.
    const flows = periodFlows(makeSplitHolding(), "2025-01-01", "2025-01-10");
    expect(flows.buys).toBe(0);
    expect(flows.sells).toBe(0);
    expect(flows.dividends).toBe(0);
    expect(flows.netInvested).toBe(0);
  });
});

describe("twr", () => {
  it("computes +100% for a simple doubling with no interim flows", () => {
    const result = twr(makeSimpleDoublingHolding(), "2025-01-01", "2025-01-10");
    expect(result).toBeCloseTo(1.0, 6);
  });

  it("is unaffected by a mid-period cash top-up when price is flat", () => {
    const result = twr(makeMidPeriodTopUpHolding(), "2025-01-01", "2025-01-10");
    expect(result).toBeCloseTo(0, 6);
  });

  it("counts a dividend as a positive TWR contribution even with flat price", () => {
    // Price is flat throughout, so the entire +5% TWR here comes from the £50
    // dividend on a £1000 position (dividend is a negative "flow", which
    // increases the chained return since it's value paid out, not a price gain).
    const result = twr(makeDividendHolding(), "2025-01-01", "2025-01-10");
    expect(result).toBeCloseTo(0.05, 6);
  });

  it("is unaffected by a split: units double as the quote halves", () => {
    // The regression this guards. Before splits were handled, the units stayed
    // at 10 while the split-adjusted quote dropped 100 -> 50, so the position
    // looked like it had halved and TWR read roughly -50%.
    const result = twr(makeSplitHolding(), "2025-01-01", "2025-01-10");
    expect(result).toBeCloseTo(0, 6);
  });

  it("returns null when there is no quote data in range", () => {
    expect(twr(makeEmptyHolding(), "2025-01-01", "2025-01-10")).toBeNull();
  });
});

describe("portfolioTwr", () => {
  it("matches single-holding twr when given just one holding", () => {
    const holding = makeSimpleDoublingHolding();
    const singleResult = twr(holding, "2025-01-01", "2025-01-10");
    const portfolioResult = portfolioTwr([holding], "2025-01-01", "2025-01-10");
    expect(portfolioResult).toBeCloseTo(singleResult!, 6);
  });

  it("blends two holdings with different returns", () => {
    const doubler = makeSimpleDoublingHolding();
    const flat = makeMidPeriodTopUpHolding();
    const result = portfolioTwr([doubler, flat], "2025-01-01", "2025-01-10");
    // Combined return should land strictly between the flat holding's ~0% and the doubler's +100%.
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeLessThan(1.0);
  });
});

describe("annualise", () => {
  it("returns null below the minimum window", () => {
    expect(annualise(0.5, "2025-01-01", "2025-06-01", 365)).toBeNull();
  });

  it("annualises a return over exactly one year to itself", () => {
    const result = annualise(0.1, "2024-01-01", "2025-01-01", 365);
    expect(result).toBeCloseTo(0.1, 2);
  });

  it("returns null for a total wipeout (base <= 0)", () => {
    expect(annualise(-1, "2024-01-01", "2025-01-01", 365)).toBeNull();
  });
});
