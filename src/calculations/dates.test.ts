import { describe, expect, it } from "vitest";
import { addDays, daysBetween, prevQuarter, quarterBounds, quarterLabel, walkBack } from "./dates";

describe("addDays", () => {
  it("adds positive days", () => {
    expect(addDays("2025-01-01", 10)).toBe("2025-01-11");
  });

  it("subtracts with negative days", () => {
    expect(addDays("2025-01-01", -1)).toBe("2024-12-31");
  });

  it("crosses year boundary", () => {
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
  });
});

describe("daysBetween", () => {
  it("counts whole days", () => {
    expect(daysBetween("2025-01-01", "2025-01-11")).toBe(10);
  });

  it("is zero for the same day", () => {
    expect(daysBetween("2025-01-01", "2025-01-01")).toBe(0);
  });
});

describe("walkBack", () => {
  const series = new Map([
    ["2025-01-01", 100],
    ["2025-01-05", 105],
  ]);

  it("returns the exact match when present", () => {
    expect(walkBack(series, "2025-01-05", 30)).toBe(105);
  });

  it("walks back to the most recent prior value", () => {
    expect(walkBack(series, "2025-01-08", 30)).toBe(105);
  });

  it("returns null when nothing is found within maxDaysBack", () => {
    expect(walkBack(series, "2025-01-08", 2)).toBeNull();
  });
});

describe("quarterBounds", () => {
  it("finds Q1 bounds", () => {
    expect(quarterBounds("2025-02-15")).toEqual({ start: "2025-01-01", end: "2025-03-31" });
  });

  it("finds Q4 bounds spanning into December", () => {
    expect(quarterBounds("2025-11-01")).toEqual({ start: "2025-10-01", end: "2025-12-31" });
  });
});

describe("prevQuarter", () => {
  it("steps back one quarter", () => {
    expect(prevQuarter("2025-02-15")).toEqual({ start: "2024-10-01", end: "2024-12-31" });
  });
});

describe("quarterLabel", () => {
  it("labels Q1", () => {
    expect(quarterLabel("2025-01-01")).toBe("2025-Q1");
  });

  it("labels Q4", () => {
    expect(quarterLabel("2025-10-01")).toBe("2025-Q4");
  });
});
