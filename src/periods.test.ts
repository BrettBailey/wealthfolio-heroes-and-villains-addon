import { describe, expect, it } from "vitest";
import { DEFAULT_PERIOD_KEY, periodDateRange, type PeriodKey } from "./periods";

const ALL_PERIOD_KEYS: PeriodKey[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "5Y", "ALL"];

describe("periodDateRange", () => {
  const today = "2026-07-13";

  it("resolves every period the host's IntervalSelector can emit to a startDate before endDate", () => {
    for (const periodKey of ALL_PERIOD_KEYS) {
      const range = periodDateRange(periodKey, today);
      expect(range.endDate).toBe(today);
      expect(range.startDate < range.endDate).toBe(true);
    }
  });

  it("defaults to the 3M window, matching the host selector's own default", () => {
    expect(DEFAULT_PERIOD_KEY).toBe("3M");
    expect(periodDateRange(DEFAULT_PERIOD_KEY, today)).toEqual(periodDateRange("3M", today));
  });

  it("computes the 3M window as 91 days back", () => {
    expect(periodDateRange("3M", today)).toEqual({
      startDate: "2026-04-13",
      endDate: today,
    });
  });

  it("starts YTD at January 1st of the current year", () => {
    expect(periodDateRange("YTD", today)).toEqual({
      startDate: "2026-01-01",
      endDate: today,
    });
  });

  it("reaches back far enough for ALL to cover any real activity history", () => {
    const range = periodDateRange("ALL", today);
    expect(range.startDate).toBe("1970-01-01");
    expect(range.endDate).toBe(today);
  });
});
