import { PERIOD_KEYS, type PeriodKey } from "../periods";

/**
 * Keys are namespaced by addon id; the host scopes storage per addon anyway, but
 * the prefix keeps them legible in the database.
 *
 * There was once a `heroes-villains:rank-mode` key here, persisting a rank-by
 * toggle. The toggle is gone (the page always ranks on cash — see `RANK_MODE` in
 * HeroesAndVillainsPage), so the key is gone with it. Any value left in a user's
 * storage from an older build is simply never read.
 */
export const PERIOD_KEY = "heroes-villains:period";
export const ACCOUNT_FILTER_KEY = "heroes-villains:account-filter";

/** Rejects anything that isn't a period the selector actually offers. */
export function parsePeriodKey(raw: string): PeriodKey | null {
  return (PERIOD_KEYS as readonly string[]).includes(raw) ? (raw as PeriodKey) : null;
}

/**
 * `null` means "no explicit filter — use every active account", which is the
 * page's default and is stored as the literal `"all"` rather than as a snapshot
 * of today's account ids. Storing the ids would silently freeze the filter: open
 * a new account next year and it would be excluded from a selection the user
 * never actually made.
 */
export function serializeAccountFilter(selected: Set<string> | null): string {
  return selected === null ? "all" : JSON.stringify([...selected]);
}

/**
 * Parses a stored account selection, dropping ids that no longer exist.
 *
 * Accounts can be deleted between sessions, so a saved id is not guaranteed to
 * resolve. Ids that survive are kept; if none do, the selection is meaningless
 * and we fall back to `null` (all active accounts) rather than showing an empty
 * ranking the user can't explain.
 */
export function parseAccountFilter(raw: string, knownAccountIds: Set<string>): Set<string> | null {
  if (raw === "all") {
    return null;
  }

  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(stored)) {
    return null;
  }

  const surviving = stored.filter(
    (accountId): accountId is string => typeof accountId === "string" && knownAccountIds.has(accountId),
  );

  return surviving.length === 0 ? null : new Set(surviving);
}
