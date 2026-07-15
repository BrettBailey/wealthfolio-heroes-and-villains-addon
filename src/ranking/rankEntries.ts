import type { RankingEntry, RankMode } from "./types";

export interface RankedEntries {
  heroes: RankingEntry[];
  villains: RankingEntry[];
}

const SORT_FIELD: Record<RankMode, keyof RankingEntry> = {
  "return-pct": "periodReturn",
  "gain-cash": "periodReturnBase",
};

/**
 * Splits entries into heroes (biggest gains, best first) and villains (biggest
 * losses, worst first) by the given rank mode, dropping entries with no data.
 *
 * The split is by sign, not by position: a holding that made money is never a
 * villain, so in a period where everything rose the villains list is legitimately
 * empty (and vice versa). Entries worth exactly zero are neither. Each list is
 * capped at `topCount`.
 */
export function rankEntries(entries: RankingEntry[], mode: RankMode, topCount: number): RankedEntries {
  const field = SORT_FIELD[mode];
  const valueOf = (entry: RankingEntry) => entry[field] as number;

  const rankable = entries.filter((entry) => entry[field] !== null);
  const gainers = rankable.filter((entry) => valueOf(entry) > 0);
  const losers = rankable.filter((entry) => valueOf(entry) < 0);

  const heroes = [...gainers].sort((a, b) => valueOf(b) - valueOf(a)).slice(0, topCount);
  const villains = [...losers].sort((a, b) => valueOf(a) - valueOf(b)).slice(0, topCount);

  return { heroes, villains };
}
