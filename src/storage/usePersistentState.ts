import { useCallback, useEffect, useRef, useState } from "react";
import type { StorageAPI } from "@wealthfolio/addon-sdk";

/**
 * React state persisted in the host's durable per-addon storage.
 *
 * Note this is deliberately NOT `localStorage`: addons run in a sandboxed,
 * opaque-origin iframe where `localStorage` is unavailable, which is why the
 * host added this SQLite-backed API in 3.6.2. Anything handed a `storageKey`
 * expecting `localStorage` (the host's own `IntervalSelector`, for one) silently
 * persists nothing in an addon.
 *
 * Loading is asynchronous, so the first render returns `defaultValue` and the
 * stored value arrives a tick later. Two consequences the caller must respect:
 *
 *  - Writes are suppressed until the initial read resolves. Otherwise the
 *    default would be written straight back over the saved value on mount,
 *    erasing it before it ever loaded.
 *  - `isLoaded` reports when the stored value has landed, so a caller that must
 *    not act on a default (e.g. kicking off an expensive query against the wrong
 *    period) can wait.
 *
 * `parse` returns `null` to reject a stored value that is no longer valid — an
 * unknown period code, an account id that has since been deleted — in which case
 * the default is used instead. Storage outlives the addon version that wrote it,
 * so stored values are untrusted input, not a private field.
 */
export function usePersistentState<T>(
  storage: StorageAPI,
  key: string,
  defaultValue: T,
  serialize: (value: T) => string,
  parse: (raw: string) => T | null,
): [T, (next: T) => void, { isLoaded: boolean }] {
  const [value, setValue] = useState<T>(defaultValue);
  const [isLoaded, setIsLoaded] = useState(false);

  // Held in a ref so changing `parse`/`serialize` identity between renders (they
  // are usually inline closures) can't re-trigger the load and clobber state.
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const serializeRef = useRef(serialize);
  serializeRef.current = serialize;

  useEffect(() => {
    let cancelled = false;

    storage
      .get(key)
      .then((raw) => {
        if (cancelled) {
          return;
        }
        if (raw !== null) {
          const parsed = parseRef.current(raw);
          if (parsed !== null) {
            setValue(parsed);
          }
        }
      })
      .catch(() => {
        // A failed read just means we fall back to the default — not worth
        // failing the page over, and the host logs the underlying error.
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storage, key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      if (!isLoaded) {
        return;
      }
      void storage.set(key, serializeRef.current(next)).catch(() => {
        // Persisting is best-effort; the in-memory value is still correct for
        // this session.
      });
    },
    [storage, key, isLoaded],
  );

  return [value, update, { isLoaded }];
}
