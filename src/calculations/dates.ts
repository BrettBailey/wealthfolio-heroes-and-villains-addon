/** Dates are represented as "YYYY-MM-DD" strings throughout — comparable with plain string comparison. */

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Finds the most recent key in `series` on or before `targetDate`, up to `maxDaysBack` days back. */
export function walkBack(series: Map<string, number>, targetDate: string, maxDaysBack: number): number | null {
  let current = targetDate;
  for (let step = 0; step <= maxDaysBack; step += 1) {
    const value = series.get(current);
    if (value !== undefined) {
      return value;
    }
    current = addDays(current, -1);
  }
  return null;
}

export function quarterBounds(isoDate: string): { start: string; end: string } {
  const [year, month] = isoDate.split("-").map(Number);
  const quarterIndex = Math.floor((month - 1) / 3); // 0=Q1 .. 3=Q4
  const startMonth = quarterIndex * 3 + 1;
  const start = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const nextQuarterStartMonth = startMonth + 3;
  const nextQuarterStart =
    nextQuarterStartMonth > 12 ? `${year + 1}-01-01` : `${year}-${String(nextQuarterStartMonth).padStart(2, "0")}-01`;
  const end = addDays(nextQuarterStart, -1);
  return { start, end };
}

export function prevQuarter(isoDate: string): { start: string; end: string } {
  const { start: quarterStart } = quarterBounds(isoDate);
  return quarterBounds(addDays(quarterStart, -1));
}

export function quarterLabel(startDate: string): string {
  const [year, month] = startDate.split("-").map(Number);
  const quarterNumber = Math.floor((month - 1) / 3) + 1;
  return `${year}-Q${quarterNumber}`;
}
