import { describe, expect, it } from "vitest";
import { buildFxRateSeries, isPenceCurrency, rateOn, toMajorCurrency, toMajorUnits } from "./currency";
import { makeFakeQuote } from "../fixtures/fakeHostApi";

describe("pence handling", () => {
  it("treats GBp as pence and GBP as pounds", () => {
    expect(isPenceCurrency("GBp")).toBe(true);
    expect(isPenceCurrency("GBP")).toBe(false);
  });

  it("is case-sensitive: only the exact code GBp means pence", () => {
    // A case-insensitive comparison would wrongly scale genuine GBP holdings by 1/100.
    expect(isPenceCurrency("gbp")).toBe(false);
    expect(isPenceCurrency("GBP")).toBe(false);
  });

  it("scales pence into pounds", () => {
    // SMT quotes at 1447 pence = £14.47 (real value from Brett's DB).
    expect(toMajorUnits(1447, "GBp")).toBeCloseTo(14.47, 10);
  });

  it("leaves a genuine GBP price untouched, however large", () => {
    // Vanguard LifeStrategy 100% is genuinely ~£212-489/unit and is labelled GBP.
    // A "that looks too big to be pounds" heuristic would corrupt exactly this.
    expect(toMajorUnits(489, "GBP")).toBe(489);
  });

  it("leaves other currencies untouched", () => {
    expect(toMajorUnits(399.02, "USD")).toBe(399.02);
  });

  it("resolves GBp to GBP as its major currency, leaving others alone", () => {
    expect(toMajorCurrency("GBp")).toBe("GBP");
    expect(toMajorCurrency("GBP")).toBe("GBP");
    expect(toMajorCurrency("USD")).toBe("USD");
  });
});

describe("historical FX rates", () => {
  const series = buildFxRateSeries([
    makeFakeQuote({ assetId: "fx-usd-gbp", date: "2025-01-02", close: 0.8 }),
    makeFakeQuote({ assetId: "fx-usd-gbp", date: "2025-01-03", close: 0.81 }),
    makeFakeQuote({ assetId: "fx-usd-gbp", date: "2025-01-06", close: 0.79 }),
  ]);

  it("returns the rate on an exact trading day", () => {
    expect(rateOn(series, "2025-01-03")).toBe(0.81);
  });

  it("falls back to the most recent earlier rate on a non-trading day", () => {
    // 4th/5th Jan 2025 is a weekend: the rate has simply not moved since Friday.
    expect(rateOn(series, "2025-01-05")).toBe(0.81);
  });

  it("returns null before the series starts rather than inventing a rate", () => {
    expect(rateOn(series, "2024-12-31")).toBeNull();
  });

  it("holds the last known rate for dates after the series ends", () => {
    expect(rateOn(series, "2025-06-01")).toBe(0.79);
  });
});
