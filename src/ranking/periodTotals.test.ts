import { describe, expect, it } from "vitest";
import { periodTotals } from "./periodTotals";
import type { RankingEntry } from "./types";

function makeEntry(symbol: string, periodReturnBase: number | null): RankingEntry {
  return {
    symbol,
    instrumentId: `asset-${symbol}`,
    name: symbol,
    accountIds: ["acc-1"],
    marketValueBase: 1000,
    isClosed: false,
    totalGainBase: 1,
    totalGainPct: 1,
    periodReturnBase,
    periodReturn: periodReturnBase === null ? null : 0.05,
    periodTwr: periodReturnBase === null ? null : 0.05,
    breakdown:
      periodReturnBase === null
        ? null
        : { marketValueStart: 1000, marketValueEnd: 1000 + periodReturnBase, buys: 0, sells: 0, dividends: 0 },
    periodDataAvailable: periodReturnBase !== null,
  };
}

describe("periodTotals", () => {
  it("splits gains from losses and nets them", () => {
    const totals = periodTotals([makeEntry("A", 500), makeEntry("B", 250), makeEntry("C", -100), makeEntry("D", -400)]);

    expect(totals.totalGains).toBe(750);
    expect(totals.totalLosses).toBe(-500);
    expect(totals.netChange).toBe(250);
    expect(totals.countedEntries).toBe(4);
    expect(totals.excludedEntries).toBe(0);
  });

  it("totals every entry, not just the ones that would make the top-five columns", () => {
    const entries = Array.from({ length: 8 }, (_, index) => makeEntry(`S${index}`, 100));
    expect(periodTotals(entries).totalGains).toBe(800);
  });

  it("counts a flat entry without adding it to gains or losses", () => {
    const totals = periodTotals([makeEntry("FLAT", 0), makeEntry("A", 100)]);

    expect(totals.totalGains).toBe(100);
    expect(totals.totalLosses).toBe(0);
    expect(totals.countedEntries).toBe(2);
  });

  it("reports entries with no period figure as excluded rather than counting them as zero", () => {
    const totals = periodTotals([makeEntry("A", 100), makeEntry("NODATA", null)]);

    expect(totals.netChange).toBe(100);
    expect(totals.countedEntries).toBe(1);
    expect(totals.excludedEntries).toBe(1);
  });

  it("is all zeroes for an empty list", () => {
    expect(periodTotals([])).toEqual({
      totalGains: 0,
      totalLosses: 0,
      netChange: 0,
      countedEntries: 0,
      excludedEntries: 0,
    });
  });
});
