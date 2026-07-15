import type { Holding } from "../calculations/types";

/** A single buy on day 1, held flat, price doubles by day 10. Simplest possible TWR case: +100%. */
export function makeSimpleDoublingHolding(): Holding {
  return {
    ticker: "TEST",
    name: "Test Corp",
    activities: [{ activityDate: "2025-01-01", kind: "BUY", quantity: 10, price: 100, amount: 1000, fee: 0 }],
    quotesGbp: new Map([
      ["2025-01-01", 100],
      ["2025-01-10", 200],
    ]),
  };
}

/** Buy on day 1, then a top-up buy mid-period, price flat throughout — TWR should be 0 despite a big cash inflow. */
export function makeMidPeriodTopUpHolding(): Holding {
  return {
    ticker: "TEST",
    name: "Test Corp",
    activities: [
      { activityDate: "2025-01-01", kind: "BUY", quantity: 10, price: 100, amount: 1000, fee: 0 },
      { activityDate: "2025-01-05", kind: "BUY", quantity: 10, price: 100, amount: 1000, fee: 0 },
    ],
    quotesGbp: new Map([
      ["2025-01-01", 100],
      ["2025-01-05", 100],
      ["2025-01-10", 100],
    ]),
  };
}

/** Buy on day 1, sell half on day 5 at a higher price, hold rest flat to day 10. */
export function makePartialSellHolding(): Holding {
  return {
    ticker: "TEST",
    name: "Test Corp",
    activities: [
      { activityDate: "2025-01-01", kind: "BUY", quantity: 10, price: 100, amount: 1000, fee: 0 },
      { activityDate: "2025-01-05", kind: "SELL", quantity: 5, price: 150, amount: 750, fee: 0 },
    ],
    quotesGbp: new Map([
      ["2025-01-01", 100],
      ["2025-01-05", 150],
      ["2025-01-10", 150],
    ]),
  };
}

/** Buy on day 1, dividend paid on day 5, price flat — dividend counts as a cash outflow for TWR, and as return for simple total-return. */
export function makeDividendHolding(): Holding {
  return {
    ticker: "TEST",
    name: "Test Corp",
    activities: [
      { activityDate: "2025-01-01", kind: "BUY", quantity: 10, price: 100, amount: 1000, fee: 0 },
      { activityDate: "2025-01-05", kind: "DIVIDEND", quantity: 0, price: 0, amount: 50, fee: 0 },
    ],
    quotesGbp: new Map([
      ["2025-01-01", 100],
      ["2025-01-05", 100],
      ["2025-01-10", 100],
    ]),
  };
}

/**
 * Buy 10 @ £100 on day 1, then a 2-for-1 split on day 5, price flat in real terms.
 *
 * The quote series is **already split-adjusted**, as every market data provider's
 * is: the £100 close becomes £50 the moment the split lands. So the holding goes
 * 10 shares @ £100 -> 20 shares @ £50 — market value stays £1,000 throughout, and
 * a correct TWR is 0%. Getting this wrong in either direction is loud: ignore the
 * split and the position halves to £500 (a phantom -50%); treat the split as a
 * cash flow and the return is nonsense.
 */
export function makeSplitHolding(): Holding {
  return {
    ticker: "TEST",
    name: "Test Corp",
    activities: [
      { activityDate: "2025-01-01", kind: "BUY", quantity: 10, price: 100, amount: 1000, fee: 0 },
      // `amount` carries the ratio, not cash — this is Wealthfolio's own encoding.
      { activityDate: "2025-01-05", kind: "SPLIT", quantity: 0, price: 0, amount: 2, fee: 0 },
    ],
    quotesGbp: new Map([
      ["2025-01-01", 100],
      ["2025-01-05", 50],
      ["2025-01-10", 50],
    ]),
  };
}

/** No activities at all — everything should report as null/zero rather than throwing. */
export function makeEmptyHolding(): Holding {
  return {
    ticker: "EMPTY",
    name: "Empty Corp",
    activities: [],
    quotesGbp: new Map(),
  };
}
