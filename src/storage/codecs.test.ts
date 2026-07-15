import { describe, expect, it } from "vitest";
import { parseAccountFilter, parsePeriodKey, serializeAccountFilter } from "./codecs";

describe("parsePeriodKey", () => {
  it("accepts a period the selector offers", () => {
    expect(parsePeriodKey("6M")).toBe("6M");
  });

  it("rejects a value that isn't a period at all", () => {
    expect(parsePeriodKey("banana")).toBeNull();
  });

  it("rejects a period code we no longer support, so an old stored value can't select a bogus range", () => {
    expect(parsePeriodKey("2Y")).toBeNull();
  });
});

describe("account filter round-trip", () => {
  const known = new Set(["acc-1", "acc-2", "acc-3"]);

  it("round-trips an explicit selection", () => {
    const selected = new Set(["acc-1", "acc-3"]);
    expect(parseAccountFilter(serializeAccountFilter(selected), known)).toEqual(selected);
  });

  it("round-trips the 'all accounts' default without freezing today's account ids", () => {
    expect(serializeAccountFilter(null)).toBe("all");
    expect(parseAccountFilter("all", known)).toBeNull();
  });

  it("drops an account that has been deleted since the selection was saved", () => {
    const raw = JSON.stringify(["acc-1", "acc-deleted"]);
    expect(parseAccountFilter(raw, known)).toEqual(new Set(["acc-1"]));
  });

  it("falls back to all accounts when every saved account is gone, rather than showing an empty ranking", () => {
    const raw = JSON.stringify(["acc-gone", "acc-also-gone"]);
    expect(parseAccountFilter(raw, known)).toBeNull();
  });

  it("falls back to all accounts on corrupt stored JSON", () => {
    expect(parseAccountFilter("{not json", known)).toBeNull();
  });

  it("falls back to all accounts when the stored value is the wrong shape", () => {
    expect(parseAccountFilter(JSON.stringify({ acc: 1 }), known)).toBeNull();
  });

  it("ignores non-string entries in a stored array", () => {
    const raw = JSON.stringify(["acc-2", 42, null]);
    expect(parseAccountFilter(raw, known)).toEqual(new Set(["acc-2"]));
  });
});
