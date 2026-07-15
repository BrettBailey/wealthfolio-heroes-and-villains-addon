import { describe, expect, it } from "vitest";
import type { Holding } from "../calculations/types";
import { periodStats } from "./periodStats";

function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    ticker: "AAPL",
    name: "Apple",
    activities: [],
    quotesGbp: new Map(),
    ...overrides,
  };
}

/**
 * Returns are FRACTIONS here, not percentages: 0.2 means +20%. See
 * `PeriodStats.simpleReturn` — the whole pipeline uses fractions, because that
 * is what `twr()` produces and what the host's `GainPercent` consumes.
 */
describe("periodStats", () => {
  it("computes cash total-return and simple return from a straightforward buy-then-appreciate window", () => {
    const holding = makeHolding({
      activities: [{ activityDate: "2025-01-01", kind: "BUY", quantity: 10, price: 10, amount: 100, fee: 0 }],
      quotesGbp: new Map([
        ["2024-12-31", 10],
        ["2025-01-01", 10],
        ["2025-02-01", 12],
      ]),
    });

    const stats = periodStats(holding, "2025-01-01", "2025-02-01");

    // opening snapshot (2024-12-31): 0 units, MV 0. Buy of 100 on 2025-01-01 counted as a flow within the period.
    expect(stats.marketValueStart).toBe(0);
    expect(stats.marketValueEnd).toBe(120); // 10 units * 12
    expect(stats.totalReturnCash).toBe(20); // (120 - 0) - (100 - 0) + 0 dividends
    expect(stats.simpleReturn).toBeCloseTo(0.2, 6); // 20 / (0 + 100) = +20%
  });

  it("includes dividends in the cash total-return", () => {
    const holding = makeHolding({
      activities: [
        { activityDate: "2024-06-01", kind: "BUY", quantity: 10, price: 10, amount: 100, fee: 0 },
        { activityDate: "2025-01-15", kind: "DIVIDEND", quantity: 0, price: 0, amount: 5, fee: 0 },
      ],
      quotesGbp: new Map([
        ["2024-12-31", 10],
        ["2025-02-01", 10],
      ]),
    });

    const stats = periodStats(holding, "2025-01-01", "2025-02-01");

    expect(stats.marketValueStart).toBe(100); // 10 units already held, snapshot at 2024-12-31 close
    expect(stats.marketValueEnd).toBe(100);
    expect(stats.dividends).toBe(5);
    expect(stats.totalReturnCash).toBe(5); // (100 - 100) - 0 + 5
    expect(stats.simpleReturn).toBeCloseTo(0.05, 6); // 5 / 100 = +5%
  });

  it("returns null cash/return when there are no quotes at all (no known market value on either date)", () => {
    const holding = makeHolding();
    const stats = periodStats(holding, "2025-01-01", "2025-02-01");

    expect(stats.marketValueStart).toBe(0);
    expect(stats.marketValueEnd).toBe(0);
    expect(stats.totalReturnCash).toBeNull(); // stateOn found no close price on either boundary date
    expect(stats.simpleReturn).toBeNull();
  });

  it("computes a TWR alongside the simple return", () => {
    const holding = makeHolding({
      activities: [{ activityDate: "2024-06-01", kind: "BUY", quantity: 10, price: 10, amount: 100, fee: 0 }],
      quotesGbp: new Map([
        ["2024-12-31", 10],
        ["2025-01-15", 11],
        ["2025-02-01", 12],
      ]),
    });

    const stats = periodStats(holding, "2025-01-01", "2025-02-01");

    expect(stats.twr).toBeCloseTo(0.2, 6); // price-only growth 10 -> 12 over the window, no flows = +20%
  });

  it("reports the in-period flows, so the UI can show its working", () => {
    const holding = makeHolding({
      activities: [
        { activityDate: "2024-06-01", kind: "BUY", quantity: 10, price: 10, amount: 100, fee: 0 },
        { activityDate: "2025-01-10", kind: "BUY", quantity: 5, price: 12, amount: 60, fee: 0 },
        { activityDate: "2025-01-20", kind: "SELL", quantity: 3, price: 13, amount: 39, fee: 0 },
        { activityDate: "2025-01-25", kind: "DIVIDEND", quantity: 0, price: 0, amount: 7, fee: 0 },
      ],
      quotesGbp: new Map([
        ["2024-12-31", 10],
        ["2025-02-01", 14],
      ]),
    });

    const stats = periodStats(holding, "2025-01-01", "2025-02-01");

    // The pre-period buy is excluded — it is opening value, not an in-period flow.
    expect(stats.buys).toBe(60);
    expect(stats.sells).toBe(39);
    expect(stats.dividends).toBe(7);

    // The flows must reconcile with the headline figures the pill sits next to,
    // or the "working" it claims to show would be a different sum from the one
    // that produced the number beside it.
    expect(stats.marketValueStart).toBe(100); // 10 units @ 10
    expect(stats.marketValueEnd).toBe(168); // 12 units @ 14
    const reconstructed = stats.marketValueEnd - stats.marketValueStart - (stats.buys - stats.sells) + stats.dividends;
    expect(reconstructed).toBeCloseTo(stats.totalReturnCash!, 6);
    expect(stats.totalReturnCash! / (stats.marketValueStart + stats.buys)).toBeCloseTo(stats.simpleReturn!, 6);
  });
});
