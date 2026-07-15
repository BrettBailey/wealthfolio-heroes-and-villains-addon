import { describe, expect, it } from "vitest";
import { rankEntries } from "./rankEntries";
import type { RankingEntry } from "./types";

/** `periodReturn` is a fraction (0.5 = +50%), but ranking only compares sign and magnitude. */
function makeEntry(symbol: string, periodReturn: number, periodReturnBase: number): RankingEntry {
  return {
    symbol,
    instrumentId: `asset-${symbol}`,
    name: symbol,
    accountIds: ["acc-1"],
    marketValueBase: 1000,
    isClosed: false,
    totalGainBase: periodReturnBase,
    totalGainPct: periodReturn,
    periodReturnBase,
    periodReturn,
    periodTwr: periodReturn,
    breakdown: { marketValueStart: 1000, marketValueEnd: 1000 + periodReturnBase, buys: 0, sells: 0, dividends: 0 },
    periodDataAvailable: true,
  };
}

describe("rankEntries", () => {
  it("splits into heroes (best first) and villains (worst first) with no overlap", () => {
    const entries = [
      makeEntry("A", 50, 500),
      makeEntry("B", 30, 300),
      makeEntry("C", 10, 100),
      makeEntry("D", -10, -100),
      makeEntry("E", -30, -300),
      makeEntry("F", -50, -500),
    ];
    const { heroes, villains } = rankEntries(entries, "return-pct", 2);
    expect(heroes.map((e) => e.symbol)).toEqual(["A", "B"]);
    expect(villains.map((e) => e.symbol)).toEqual(["F", "E"]);
  });

  it("never lists a profitable holding as a villain, even when it is the worst performer", () => {
    // Everything gained this period: the bottom entries are still heroes-or-nothing.
    const entries = [makeEntry("A", 50, 500), makeEntry("B", 10, 100), makeEntry("C", 2, 20)];
    const { heroes, villains } = rankEntries(entries, "return-pct", 2);
    expect(heroes.map((e) => e.symbol)).toEqual(["A", "B"]);
    expect(villains).toHaveLength(0);
  });

  it("never lists a losing holding as a hero, even when it is the best performer", () => {
    const entries = [makeEntry("A", -2, -20), makeEntry("B", -10, -100)];
    const { heroes, villains } = rankEntries(entries, "return-pct", 2);
    expect(heroes).toHaveLength(0);
    expect(villains.map((e) => e.symbol)).toEqual(["B", "A"]);
  });

  it("treats a flat entry as neither hero nor villain", () => {
    const entries = [makeEntry("A", 10, 100), makeEntry("FLAT", 0, 0), makeEntry("B", -10, -100)];
    const { heroes, villains } = rankEntries(entries, "return-pct", 5);
    expect(heroes.map((e) => e.symbol)).toEqual(["A"]);
    expect(villains.map((e) => e.symbol)).toEqual(["B"]);
  });

  it("caps each list at topCount independently", () => {
    const entries = [
      makeEntry("A", 50, 500),
      makeEntry("B", 30, 300),
      makeEntry("C", 10, 100),
      makeEntry("D", -50, -500),
    ];
    const { heroes, villains } = rankEntries(entries, "return-pct", 2);
    expect(heroes.map((e) => e.symbol)).toEqual(["A", "B"]);
    expect(villains.map((e) => e.symbol)).toEqual(["D"]);
  });

  it("excludes entries with a null value for the active rank field", () => {
    const entries = [makeEntry("A", 50, 500), { ...makeEntry("B", 0, 0), periodReturn: null }];
    const { heroes } = rankEntries(entries, "return-pct", 5);
    expect(heroes.map((e) => e.symbol)).toEqual(["A"]);
  });

  it("ranks by cash when mode is gain-cash, independent of percent ranking", () => {
    // C has the highest % return but the smallest absolute cash gain.
    const entries = [{ ...makeEntry("A", 5, 1000) }, { ...makeEntry("B", 8, 800) }, { ...makeEntry("C", 90, 90) }];
    const { heroes } = rankEntries(entries, "gain-cash", 3);
    expect(heroes.map((e) => e.symbol)).toEqual(["A", "B", "C"]);
  });

  it("splits by the sign of the active rank field, so a mode switch can move an entry between columns", () => {
    // Same entry, opposite signs in the two modes (e.g. a cash loss on a position
    // whose percentage is positive) must land in different columns per mode.
    const entries = [{ ...makeEntry("MIXED", 5, -100) }, { ...makeEntry("OTHER", -5, 100) }];

    const byPct = rankEntries(entries, "return-pct", 5);
    expect(byPct.heroes.map((e) => e.symbol)).toEqual(["MIXED"]);
    expect(byPct.villains.map((e) => e.symbol)).toEqual(["OTHER"]);

    const byCash = rankEntries(entries, "gain-cash", 5);
    expect(byCash.heroes.map((e) => e.symbol)).toEqual(["OTHER"]);
    expect(byCash.villains.map((e) => e.symbol)).toEqual(["MIXED"]);
  });
});
