# Heroes & Villains — Wealthfolio Addon Plan

## Goal

Turn the existing `heroes-and-villains-report.py` (static HTML snapshot, reads
Wealthfolio's SQLite DB directly) into a native Wealthfolio addon: a page
inside the running Wealthfolio app, driven by live data via the addon SDK,
with the same period selector (day/week/month/qtr/6mth/12mth/3yr/5yr) and
rank-by toggle (simple % vs cash £ total-return) as the Python version.

This will become its own git repository, separate from `wealthfolio-reports`.
The Python scripts were copied into `python-reference/` as the reference
implementation — they are the source of truth for calculation semantics
during the port, not something this project runs.

## Background reading

- `python-reference/calculations.py` — shared data loading + return math
  (TWR, simple return, split adjustment, FX conversion). This is what gets
  ported to TypeScript.
- `python-reference/heroes-and-villains-report.py` — period/ranking/HTML
  layout logic. This is what gets ported to a React page + addon manifest.
- `python-reference/config.py` — user-tunable settings (accounts, themes,
  benchmark, recently-closed window). Becomes addon settings/storage,
  possibly with a UI instead of a hand-edited file.

## Key facts about the Wealthfolio addon platform

Corrected 2026-07-13 after installing the real `@wealthfolio/addon-sdk`
package (v3.6.1) and reading its actual `.d.ts` files directly — the initial
research pass (secondhand, from docs/README prose) got the manifest and
mounting mechanism wrong. Trust the `.d.ts` files in
`node_modules/@wealthfolio/addon-sdk/dist/src/` over README prose if they
ever conflict again; the README contains stale/inconsistent sections (e.g.
mentions of a `getAddonContext()` helper and a `marketData` API that don't
exist in `index.d.ts`/`host-api.d.ts`).

- Repo: `github.com/wealthfolio/wealthfolio` (moved from `afadil/wealthfolio`).
  TS SDK on npm: `@wealthfolio/addon-sdk`, real and installable via plain
  `npm install` (no pnpm required, despite pnpm being used in Wealthfolio's
  own docs/scaffold).
- An addon is a folder: `manifest.json` + `src/addon.tsx` (default-exports an
  `enable(context: AddonContext)` function), built with Vite.
- **The host owns the React root — never call `createRoot`.** _(Changed in
  3.6.2; this section previously said the opposite.)_ Pass a React component as
  `context.router.add({ id, path, component })` and let the host mount it. Per
  the SDK's own types, the host "owns a single React root per addon and swaps
  the mounted component on navigation, so addons must NOT call `createRoot`
  themselves — doing so leaves orphaned trees whose re-renders never reach the
  DOM (the 3.6 'buttons do nothing' bug)." The old imperative
  `render: ({ root }) => createRoot(root).render(...)` still works as a legacy
  escape hatch — so this fails _quietly_, and "it still works after upgrading"
  is not evidence you are on the supported path.
- **The sandbox has no react-router provider.** Never call
  `useLocation()`/`useParams()`; the host passes the current `location` to the
  route component as a prop.
- **Declare routes and sidebar links in the manifest's `contributes` block.**
  _(New in 3.6.2.)_ `contributes.routes` (`{id, path?}`) plus
  `contributes.links.sidebar` (`{route, label, icon?, order?}`) let the host
  build the nav **without executing addon code**, so the addon boots lazily on
  first visit rather than at every app start. The declared route `id` must equal
  the id passed to `context.router.add`. This _declares_ the route; the
  imperative `sidebar.addItem`/`router.add` calls are still also required.
  Without it the log reads `Eager-loaded 1 out of 1 pinned addons`; with it,
  `0 out of 0 ... (1 lazy addon(s) will boot on first visit)`.
- UI is React by convention (the whole ecosystem assumes it) — the
  calculation/logic layer has no framework constraint either way.
- `react`, `react-dom`, `react-dom/client`, `react/jsx-runtime`, and
  `@tanstack/react-query` must be Vite `build.rollupOptions.external` entries
  — the host provides them, don't bundle them.
- `context.api.query.getClient()` returns `unknown` (untyped in the SDK) but
  is documented to be a real shared `QueryClient` — cast it to the SDK's
  re-exported `QueryClient` type when passing to `QueryClientProvider`.
- Manifest `permissions[].functions` is `FunctionPermission[]`
  (`{ name, isDeclared, isDetected, detectedAt? }` objects), not a plain
  `string[]` as the README's example JSON shows. Risk tiers by category:
  accounts/activities/settings = high, portfolio/files/financial-planning =
  medium, ui/market-data/events/currency = low.
- **Baseline permissions need no declaration:** `ui`, `query`, `toast`,
  `logger`, `storage` (`BASELINE_PERMISSION_CATEGORIES` / `isBaselineCategory`).
  _(New in 3.6.2.)_ Legacy manifests that still declare them keep parsing — the
  host simply ignores them — so removing them is cleanup, not a fix.
  **Historical note, because the underlying lesson still applies to every
  non-baseline category:** before 3.6.2, `sidebar.addItem`/`router.add` required
  a `ui` permission entry, and omitting it cost hours on 2026-07-13. The addon
  installed and "loaded" with no error, but both calls were **silently denied at
  runtime** (`AddonPermissionDenied: ... not allowed to call ui.sidebar.addItem`
  in `Wealthfolio.log`) — no sidebar link, no page, and no signal anywhere
  except the log file and a transient toast. **A missing permission does not
  fail loudly. If something an addon registers simply never appears, check
  `Wealthfolio.log` for a denial before debugging the code.**
- **No portfolio-wide aggregate endpoint.** `portfolio.getHoldings(accountId)`
  is single-account only. Must call `accounts.getAll()` then loop
  `getHoldings(accountId)` per account and merge — same shape of work the
  Python version already does across the SQLite DB.
- `performance.calculateAccountsSimple(accountIds: string[])` is the one
  genuinely batch call (per-account rows: `totalValue`, `totalGainLossAmount`,
  `cumulativeReturnPercent`, etc.) but doesn't merge into a single total and
  has no per-symbol breakdown.
- `performance.calculateHistory` / `calculateSummary` accept
  `itemType: 'account'|'symbol'`, one scope at a time (no batch-by-symbol).
  Returns both TWR (`returns.twr`, `annualizedTwr`) and MWR/IRR
  (`returns.irr`, `annualizedIrr`), plus attribution and risk stats.
- **`Holding` objects from `getHoldings()` already carry per-symbol
  `totalGainPct`, `totalReturnPct`, `unrealizedGainPct`, `realizedGainPct`,
  `dayChangePct`, `weight`, plus `marketValue`/`totalGain`/`totalReturn` as
  `{ local, base }` `MonetaryValue` objects (not flat numbers as first
  assumed)** — computed by the host. This is the fast path to a
  heroes/villains ranking without reimplementing TWR math at all. `Holding`
  also carries `instrument?: Instrument | null` (with `.symbol`/`.name`, not
  a flat `ticker`/`name` field) and `accountId` — the latter is what makes
  the multi-account merge in milestone 3 possible.
- No ESLint, no Prettier, no test framework ships with the SDK itself — we
  added Vitest + Testing Library + ESLint ourselves (matches the host repo's
  own choices: React 19, Vitest 4, `@testing-library/react`). `tsc --noEmit`
  is our `type-check` gate.
- `Account` objects expose `isActive`/`isArchived`/`isDefault`/`group` — usable
  for an account filter UI. No ready-made multi-select component or
  documented storage pattern exists in the SDK, so the account filter is a
  hand-rolled checkbox list (see `HeroesAndVillainsPage.tsx`); persisting the
  selection via `ctx.api` has no dedicated generic-storage API in the actual
  `HostAPI` (there's no `storage` property — only `secrets` for per-addon
  secret strings). **Open question, not yet resolved**: whether to persist
  the account filter via `secrets` (awkward fit — it's for secrets, not
  preferences) or accept that the filter resets each session for now.

## Design decisions

1. **Hybrid calculation strategy (iterate before committing).** Phase 1 uses
   `Holding` fields directly (fast, matches host's own numbers). In parallel,
   port the Python TWR/simple-return math to TypeScript and run it
   side-by-side on the same symbols/period. Compare. If they diverge,
   investigate why (dividend handling, FX conversion, split adjustment) before
   deciding which one the shipped UI shows. This avoids two failure modes:
   shipping numbers that don't match the host's own displayed returns
   elsewhere in the app, and silently trusting host numbers that might not
   include dividends the same way `calculations.py` does.

2. **Portfolio-level view, built by the addon.** Since there's no "TOTAL"
   pseudo-account, the addon fetches `accounts.getAll()`, then
   `getHoldings(accountId)` per account, and merges by ticker — mirroring
   `_load_entries()` in the Python version (same-ticker holdings across
   multiple accounts merge into one ranking entry).

3. **Account filter UI is in scope from the start**, not a later add-on. A
   simple checkbox list (backed by `Account.name`/`isActive`) feeding into
   which accounts are included in the merge step. Persisted via
   `ctx.api.storage`. This directly replaces `config.py`'s `ACCOUNTS` list,
   but user-adjustable at runtime instead of hand-edited.

4. **Themes (stock groupings) stay out of v1.** `config.py`'s `THEMES` dict
   (e.g. the "Space" theme) is a nice-to-have; the addon should get a working
   per-stock heroes/villains ranking first, then decide whether themes belong
   in addon settings/storage or a config file bundled with the addon.

5. **Recently-closed positions stay out of v1** for the same reason —
   `RECENTLY_CLOSED_DAYS` logic needs `last_sell_date` derived from activities
   history, which is extra plumbing. Add once the core ranking works.

## Testing & verification strategy

No official unit-testing story exists for Wealthfolio addons — their own docs
describe verification as "run the dev server, run the app, look at it." We
add a proper layer underneath that:

- **Pure calculation functions, framework-free.** Anything ported from
  `calculations.py` (`stateOn`, `periodFlows`, `twr`, `portfolioTwr`,
  `quarterBounds`, etc.) takes plain data in and returns plain data out — no
  `AddonContext` dependency. These are unit-testable with **Vitest** using
  fixture data (small hand-built activity/quote series with known expected
  returns, plus optionally real numbers pulled from the existing SQLite DB as
  a cross-check against the Python output).
- **Fake `AddonContext` for React component tests.** A hand-written object
  literal implementing just the methods this addon calls
  (`portfolio.getHoldings`, `accounts.getAll`, `activities.search`, `storage`)
  backed by fixtures, so page components are testable with
  **`@testing-library/react`** without the real Wealthfolio app running.
- **Type-check as a gate.** `tsc --noEmit` (from the scaffold) run before
  handing code back, every iteration.
- **ESLint**, added on top of the scaffold (which doesn't include it), for
  dead-code/style issues `tsc` won't catch.
- **`npm run publish-addon` (`scripts/publish.mjs`, added 2026-07-13) is the
  one command to run before every real-app smoke test.** It chains
  `prettier --write .` → `eslint . && tsc --noEmit` → `vitest run` →
  `vite build` → repackage `heroes-villains-addon.zip`, stopping at the
  first failing step (so a broken test, for instance, never reaches build
  or produce a stale zip). Prefer this over running the individual steps by
  hand — see [[feedback_use_publish_script]].
- **Real app smoke test last, saved for milestones, not every iteration.**
  The `addon-dev-tools`/`dev:server`/`VITE_ENABLE_ADDON_DEV_MODE` workflow
  mentioned in early research was never actually verified to exist/work —
  what we've actually used successfully (2026-07-13) is: `npm run
publish-addon` → Settings → Addons → Install Addon in the real running
  Wealthfolio app → manually approve the permissions prompt. **Always check
  `Wealthfolio.log` immediately afterward** (see
  `%LOCALAPPDATA%\com.teymz.wealthfolio\logs\Wealthfolio.log`) — the app UI
  reports "successfully loaded" and shows no error even when an addon's
  calls are being silently denied at runtime (e.g. missing `ui` permission
  for `sidebar.addItem`/`router.add`, discovered this way). Don't rely on
  Brett's on-screen impression alone; grep the log for `AddonPermissionDenied`,
  `runtime error`, or `[ERROR]` lines mentioning the addon id every time.

## Milestones

1. **DONE** — Scaffold: manifest, package.json, tsconfig, vite config, folder
   layout, ESLint config, Vitest config.
2. **DONE** — Calculation core: TS port of `calculations.py`'s pure functions
   (`src/calculations/`) + Vitest tests.
3. **DONE** — Data layer: `buildRankingEntries` calls `accounts.getAll` +
   `getHoldings` per account and merges same-symbol holdings across accounts
   into ranking entries; fake-HostAPI tests in `buildRankingEntries.test.ts`.
4. **DONE (2026-07-13)** — React page v1: rank-by toggle + heroes/villains
   columns + account filter, using `Holding` fields directly (no custom TWR
   yet). **Smoke-tested successfully in the real Wealthfolio app (v3.6.1)**:
   built, zipped, installed, sidebar link and page render with live data
   confirmed working. Two real bugs were found and fixed during this smoke
   test (see "Key facts" above): missing `ui` category permission for
   `sidebar.addItem`/`router.add`, and `minWealthfolioVersion` left at a
   placeholder `1.0.0` instead of the actual installed version `3.6.1`.
   **Still missing from v1**: the period selector (day/week/month/qtr/6mth/
   12mth/3yr/5yr) — the page currently only shows a single point-in-time
   gain/loss, not a selectable period. This blocks a meaningful milestone 5
   comparison (need the same period on both sides), so do this before or
   alongside milestone 5.
   4.5. **DONE (implementation), pending real-app smoke test (2026-07-13)** —
   Period selector: `src/periods.ts` defines the same 8 periods as the Python
   `PERIODS` list (day/week/month/3-months/6-months/12-months/3-years/
   5-years, default `3-months`), with `periodDateRange(periodKey, today)`
   resolving a key to a calendar-day-lookback `{startDate, endDate}` window.
   The "Day" period intentionally uses a plain yesterday-to-today window
   rather than the Python version's quote-calendar walk-back (which exists
   there to avoid a false 0% over a weekend/holiday) — decided to try the
   simple version first since `performance.calculateSummary` is a mature host
   calculation engine that may already handle non-trading days sensibly;
   revisit only if the real smoke test shows "Day" going stale/zero over a
   weekend.
   **Data source changed from milestone 4**: `buildRankingEntries` no longer
   reads `Holding.totalReturn`/`totalReturnPct` (those were all-time, not
   period-scoped). It now calls `ctx.api.performance.calculateSummary({
itemType: 'symbol', itemId: symbol, startDate, endDate })` per merged
   symbol and uses `summary.summary.amount`/`.percent` for the period cash/pct
   figures. This call takes only a symbol (no account parameter) so it is
   portfolio-wide for that symbol across every account, not scoped to the
   accounts passed in — `Holding` fetches are still needed to know which
   symbols are currently held and for market value/weight, but no longer
   supply the period return numbers. `totalGainBase`/`totalGainPct` on
   `RankingEntry` remain all-time figures from `Holding` (unchanged, shown
   alongside the period figures — not yet surfaced in the UI, only
   `totalReturnBase`/`totalReturnPct` are period-scoped and rendered).
   Added `performance` category (function `calculateSummary`) to
   `manifest.json` permissions — confirmed 2026-07-13 no `AddonPermissionDenied`
   for it; the `performance` permission itself is fine.

   **Bug found and fixed during first real-app smoke test (2026-07-13)**: the
   page hung "loading" for ~2 minutes then showed "Failed to load holdings."
   `Wealthfolio.log` showed repeated `calculate_performance_summary` failures
   (`Market data operation failed: No data found`, Yahoo `NoDataForRange`)
   every ~2 seconds. Root cause: `buildRankingEntries` called
   `performance.calculateSummary` for every held symbol inside one
   `Promise.all`, and that whole call is wrapped in a single React Query
   `entriesQuery` on the host's shared `QueryClient` (default retry: 3
   attempts, exponential backoff — matches the ~2s gaps observed). One symbol
   with no Yahoo price coverage for the selected period (e.g. delisted/
   renamed/wrong-symbol instrument) rejected the whole `Promise.all`, which
   failed the whole query, which retried the _entire batch_ (re-querying every
   symbol again) 3 times before finally giving up — turning one bad symbol
   into a 2-minute hang and a total page failure.
   **Fix**: wrapped each symbol's `calculateSummary` call in its own
   try/catch inside `buildRankingEntries` — a failing symbol now just leaves
   that entry's `totalReturnBase`/`totalReturnPct` as `null` (renders as "–",
   same as the existing no-data case), instead of failing every other entry
   too. Added a regression test
   (`buildRankingEntries.test.ts`: "does not let one symbol's
   calculateSummary rejection fail the whole batch").

   **Second, more fundamental bug found on the next real-app retest**: page
   loaded promptly this time, but every entry showed "No data for this
   selection" — _every_ symbol was failing, not just one. `Wealthfolio.log`
   showed `No historical quotes returned for 'SMT'/'TMPL'/'RPI'/'GBP'
between ... ` — including `GBP`, a currency, meaning the ticker symbol
   itself (not a real market-data problem) was the issue. Cross-checked the
   app's own SQLite DB (`assets`/`quotes` tables, via the sqlite MCP server —
   see [[reference_wealthfolio_db]]): `quotes.asset_id` is a UUID (e.g.
   `4060f374-2e0a-4f84-af52-44670adc9a2b` for SMT), confirmed thousands of
   quote rows exist for that id covering the requested range. So
   `performance.calculateSummary({ itemType: 'symbol', itemId })` needs
   `itemId` = the instrument's **asset id** (`holding.instrument.id`, a
   UUID), not `holding.instrument.symbol` (the plain ticker, e.g. `"SMT"`) —
   passing the ticker fails to resolve to any quotes at all, for every
   holding, since quotes aren't indexed by ticker string.
   **Fix**: added `RankingEntry.instrumentId` (`src/ranking/types.ts`),
   populated from `holding.instrument.id` in `mergeHoldingIntoEntries`, and
   `calculateSummary` now receives `itemId: entry.instrumentId` instead of
   `entry.symbol`. Also fixed `makeFakeHolding` in `src/fixtures/fakeHostApi.ts`
   — it previously set `instrument.id = symbol` (same string), which
   coincidentally made this exact bug invisible to unit tests; the fixture
   now defaults `instrumentId` to a distinct fake value
   (`asset-id-<symbol>`) so future regressions of this kind fail the test
   suite instead of only surfacing in the real app. Added an explicit
   regression test asserting `calculateSummary` is called with the
   instrument id, not the ticker.

   **Third bug found on the next real-app retest**: the instrument-id fix
   worked — `Wealthfolio.log` confirmed `performance_service` (the local
   cache) resolving quotes with no more Yahoo calls or `NoDataForRange`
   errors. But heroes/villains still showed "No data for this selection."
   Log showed `Asset 'cash:GBP': No quote data found between ... Returning
empty response.` — a cash balance was being sent through
   `calculateSummary` and (correctly) failing, since cash has no price
   series. `mergeHoldingIntoEntries` was filtering cash out by checking
   `holding.instrument == null`, on the assumption cash holdings have no
   instrument — wrong: the real host populates a synthetic `instrument` for
   cash too (`id: "cash:GBP"`, `symbol: "GBP"`), confirmed by checking the
   `Holding` type's `holdingType` field (`HoldingType = "cash" | "security" |
"AlternativeAsset"`). Every stock entry was silently being tried as well,
   but the log's last lines only showed the cash failure at the point
   checked — cash was at minimum swallowing one entry's data and adding
   noise, and any real "why is X still blank" case should be re-diagnosed
   against `holdingType`, not instrument presence.
   **Fix**: `mergeHoldingIntoEntries` now returns early unless
   `holding.holdingType === "security"`, checked before looking at
   `instrument` at all. Added `makeFakeCashHolding` to
   `src/fixtures/fakeHostApi.ts` (models the real `cash:GBP`-style synthetic
   instrument) and a regression test ("skips cash holdings even though the
   real host populates a synthetic instrument for them").

   **Fourth and final finding — a structural API limitation, not a bug
   (2026-07-13)**: with all three bugs above fixed, `calculateSummary` calls
   were succeeding with no errors, yet the page still showed "No data" (Cash
   £ mode) and untrustworthy-looking numbers (Simple % mode). Added
   temporary logging via `ctx.api.logger` (no permission entry needed —
   `logger` isn't in `PERMISSION_CATEGORIES`) to print the raw
   `PerformanceResult` per symbol straight to `Wealthfolio.log`. The logged
   results showed, for every single symbol: `amountStatus: "unavailable"`,
   `method: "symbolPriceBased"`, and explicit reasons — _"TWR unavailable
   for symbol-only price performance because there is no portfolio
   cash-flow scope"_, _"IRR unavailable ... because there are no user cash
   flows"_, and a warning that _"Symbol-only performance uses price quotes
   only; dividends and distributions are excluded unless the quote series
   is total-return adjusted."_ This is not fixable by changing how the
   addon calls the API: `calculateSummary({ itemType: 'symbol' })` has no
   portfolio cash-flow context by design, so it can never return a cash
   total-return figure, and its percentage figure is price-only (excludes
   dividends) — explaining both symptoms Brett reported (no cash figures,
   and percentages that "don't look trustworthy," correctly, since a
   dividend-payer's true total return is higher than its price-only
   return). Checked whether `itemType: 'account'` might expose a per-symbol
   breakdown instead — it doesn't; `PerformanceResult.attribution` is
   whole-account aggregate fields only (`contributions`, `distributions`,
   `realizedPnl`, etc.), no per-symbol split. **There is no
   `performance.*` call that returns a period-scoped, dividend-inclusive,
   per-symbol cash return** — that requires activity-level cash-flow math
   (buys/sells/dividends over the period), i.e. exactly what the ported
   `calculations.py` logic in `src/calculations/` is for. That was always
   milestone 5's job; it turns out to be a hard _requirement_ for any
   correct period-scoped figure, not an optional enhancement layered on
   top of `calculateSummary`.
   **Reverted** `buildRankingEntries` to the milestone-4 approach: merges
   `Holding.totalGain`/`totalReturn`/`totalGainPct`/`totalReturnPct`
   directly (all-time, real cash amounts including dividends, host-computed
   per account) — no `performance.calculateSummary` call, no `dateRange`
   parameter, removed the `performance` manifest permission (unused again).
   The period selector UI (`PeriodSelector` in `HeroesAndVillainsPage.tsx`)
   stays visible (kept as a `fieldset` for visual separation from Rank-by,
   per Brett's request) but now carries an explicit note — "Not yet wired
   up — figures below are all-time totals regardless of the period
   selected" — rather than silently doing nothing. `src/periods.ts` and its
   tests are unchanged and unused by the ranking data for now; they'll be
   the period-window input to milestone 5's real cash-flow math once that
   lands.

5. **DONE (implementation), pending real-app smoke test (2026-07-13)** — Real
   period-scoped cash/dividend returns. `src/calculations/returns.ts`
   (`stateOn`, `periodFlows`, `twr`, `portfolioTwr`) already existed from
   milestone 2; this milestone wires it to real data instead of
   `performance.calculateSummary`:
   - `src/ranking/loadHoldingActivityData.ts` (`toCalcHolding`) converts raw
     `ActivityDetails[]` (from `ctx.api.activities.getAll(accountId)`, string
     fields parsed to numbers, filtered to BUY/SELL/DIVIDEND) and `Quote[]`
     (from `ctx.api.quotes.getHistory(instrumentId)`) into the plain
     `Holding` shape `calculations/` operates on.
   - `src/ranking/periodStats.ts` (`periodStats`) mirrors
     `entry_period_stats` from the Python reference: opening market-value
     snapshot the day before `startDate`, closing snapshot at `endDate`,
     `periodFlows` for buys/sells/dividends in between, `growth = (mv_end -
mv_start) - (buys - sells)`, `totalReturnCash = growth + dividends`,
     `simplePct = totalReturnCash / (mv_start + buys) * 100`, plus a TWR %
     via `twr()`.
   - `buildRankingEntries` now takes a `dateRange: DateRange` parameter
     (from `periods.ts`), fetches `accounts.getAll`-scoped holdings (for
     symbol/instrument discovery and the all-time fallback figures),
     `activities.getAll` once per account (not per instrument — avoids an
     N-instruments × M-accounts call explosion), and `quotes.getHistory`
     per instrument, then computes `periodStats` per merged instrument.
   - **Non-base-currency instruments are out of scope for period-scoped
     figures, by explicit decision (2026-07-13).** The SDK exposes no
     historical FX rate series callable from an addon — only today's
     static rate (`ExchangeRatesAPI.getAll()` / `Holding.fxRate`) — so
     there's no faithful way to convert e.g. USD quote history to GBP over
     a multi-year window without either fabricating historical rates or
     depending on an FX-pair asset existing in the user's DB (the Python
     reference's `USD/GBP` `display_code` asset lookup isn't guaranteed to
     exist for every currency pair, so wasn't adopted here either).
     `buildRankingEntries` compares `holding.instrument.currency` against
     `ctx.api.settings.get().baseCurrency`; a mismatch sets
     `RankingEntry.periodDataAvailable = false` and leaves
     `periodReturnBase`/`periodReturn`/`periodTwr` all `null` — the
     UI excludes these from ranking (both rank modes filter null values)
     and lists them in a small note ("Excluded from period ranking...")
     rather than silently dropping them with no explanation.
   - `RankingEntry` (`src/ranking/types.ts`) now separates all-time fields
     (`totalGainBase`/`totalGainPct`, unchanged, host-computed) from
     period-scoped fields (`periodReturnBase`/`periodReturn`/
     `periodTwr`/`breakdown`/`periodDataAvailable`, computed here). `rankEntries`
     sorts by `periodReturn`/`periodReturnBase` instead of the old
     `totalReturnPct`/`totalReturnBase` names — never by `periodTwr`.
   - Added `activities` (high risk), `quotes` (low risk), and `settings`
     (medium risk) permission categories to `manifest.json` — exact
     category ids/risk levels confirmed from the SDK's compiled
     `PERMISSION_CATEGORIES` source (`chunk-SEHD46ND.js`), not just the
     `.d.ts` (which doesn't include the actual category list).
   - `HeroesAndVillainsPage.tsx`'s `PeriodSelector` no longer shows the
     "not yet wired up" note — clicking a period button now recomputes
     `dateRange` via `periodDateRange(periodKey, today())` and refetches
     real period-scoped figures.
   - A single instrument's `quotes.getHistory`/activity-lookup failure is
     caught per-instrument in `buildRankingEntry` (try/catch around the
     async work) and degrades to `periodDataAvailable: false` for that
     entry only — mirrors the retry-storm lesson from milestone 4.5, this
     time by construction rather than as a bug fix.
   - Tests added: `periodStats.test.ts` (cash/dividends/TWR math against
     hand-built holdings), `loadHoldingActivityData.test.ts` (activity
     type filtering, string-to-number parsing, date sorting, quote map
     building), and new cases in `buildRankingEntries.test.ts` (real
     period-scoped computation end-to-end via fakes, non-base-currency
     fallback, per-instrument failure isolation).
   - **Not yet done**: real-app smoke test. Needs checking against actual
     Wealthfolio data that `activities.getAll(accountId)` and
     `quotes.getHistory(instrumentId)` return the volumes/shapes assumed
     here (e.g. confirming `ActivityDetails.assetId` reliably matches
     `Holding.instrument.id` the same way it did for `calculateSummary`'s
     `itemId`), and checking real permission-prompt behaviour for the three
     new categories.
     **Install outage during this milestone — root-caused and fixed
     (2026-07-13).** For a stretch of the session every install attempt failed
     with the toast "Permission analysis failed — Could not analyze addon
     permissions," with nothing logged to `Wealthfolio.log` at all. The cause
     was not in the addon: `scripts/publish.mjs` packaged the zip with
     PowerShell's `Compress-Archive`, which writes entry names using Windows
     path separators, so the archive literally contained `dist\addon.js`
     instead of `dist/addon.js`. The ZIP spec requires forward slashes, so the
     host (Tauri/Rust) could not resolve `"main": "dist/addon.js"` out of the
     archive and its permission analyzer — which reads the bundle to populate
     `isDetected` — failed before any Rust command ran, which is why the log
     was silent. Every earlier hypothesis (manifest contents, permission
     categories, minification, optional catch binding, stale state, zip
     filename) was about what was _inside_ the addon; the archive container
     was the one thing never opened. It also explains the timeline: the last
     working install predated `publish.mjs` and so was zipped by other means.
     **Fix**: `scripts/writeZip.mjs`, a dependency-free ZIP writer that emits
     forward-slash entry names and throws if an entry name ever contains a
     backslash. Never reintroduce `Compress-Archive` for the addon zip. To
     inspect an archive: `[System.IO.Compression.ZipFile]::OpenRead(path)` and
     check `.Entries.FullName` for backslashes.

6. **Heroes/villains split is by sign, not position (2026-07-13).** The
   original `rankEntries` (a faithful port of the Python
   `heroes-and-villains-report.py:312-316`) sorted descending and took the
   top N as heroes and the bottom N as villains _regardless of sign_ — so in
   a period where everything rose, profitable holdings were still listed as
   villains. This was a design flaw inherited from the Python, not a porting
   slip (the Python's own docstring says "villains = top losers," which the
   code doesn't honour). `rankEntries` now filters heroes to entries with a
   positive value and villains to entries with a negative value in the active
   rank mode (zero is neither), each sorted best/worst-first and capped at
   `topCount`. Consequences: a column can legitimately be empty (an all-green
   period has no villains), so `MoversColumn` takes an `emptyNote` prop and
   shows "No villains this period." / "No heroes this period." rather than
   the old, now-misleading "No data for this selection." Because the split
   keys off the _active_ rank field, an entry can move columns when the
   Cash £ / Simple % toggle flips (a position can be up in percent but down
   in cash) — this is intended, and covered by a test.

## Outstanding work

Ordered roughly by how much they hurt. Items 1–2 are known gaps against the
Python reference reported by Brett after a real-app run; the rest are the
remaining ports and polish.

0. **THE PERCENTAGES LOOK WELL OFF — ROOT-CAUSED AND FIXED (2026-07-14).**
   Reported by Brett after the styling smoke test. **A BUY's cash value was being
   read as £0**, so money paid _into_ a position was counted as investment
   _growth_. Fixed in `toCalcActivity` (`src/ranking/loadHoldingActivityData.ts`).

   **The cause: `ActivityDetails.amount` is null on every trade.** Wealthfolio
   does not store a cash `amount` for a BUY or SELL — the trade's value is implied
   by `quantity * unitPrice (+ fee)`. Only cash-only activities (DIVIDEND,
   INTEREST, DEPOSIT) carry an explicit amount. Verified against the real DB:
   **all 615 BUY rows and 32 of 35 SELL rows have `amount = NULL`**, and the SDK
   types it `string | null` accordingly. `toCalcActivity` did
   `Number(activity.amount ?? 0)` for _all_ kinds, so `periodFlows` summed
   `buys = 0` for every purchase ever made.

   Then in `periodStats`:
   `growth = (mvEnd - mvStart) - (buys - sells)` — with `buys` stuck at zero, a
   position's growth absorbed the entire top-up, and the same wrong numerator
   flowed into `simplePct`.

   **Real impact, 3-month window (Brett's DB):** CTY was shown as **+129%
   (£39,523)** when it actually returned **+2.4% (£1,676)** — the £37,847 he put
   in during the window was reported as profit. SPXL +45.7% → **+8.4%**;
   0P00013P6I +16.5% → **+8.7%**. The distortion tracked buy size exactly, so the
   biggest recent purchases became the biggest fake heroes. Positions _closed_ in
   the window (ALW, 0P0000Z8P7) were understated instead, since their sells netted
   correctly while their buys did not.

   **The fix** mirrors the Python reference, which never had this bug because it
   derives the amount rather than reading it (`calculations.py:126`:
   `amount = quantity * price + fee`, with the stored `amount` used only for
   DIVIDEND at line 131). Cross-check: on the 3 SELL rows that _do_ carry a stored
   amount, the derived value agrees to the penny — so deriving is consistent with
   the host wherever the host commits to a number.

   **Why the earlier hypothesis was wrong, and the lesson.** This item previously
   argued the fault was "almost certainly in the denominator, not the return
   maths", reasoning that the cash column looked right while the percentage looked
   wrong, so the shared numerator must be sound. **That inference was false**: the
   numerator was wrong too, and the cash column merely _looked_ plausible because
   nobody had checked a specific number against the DB. Two real failure modes in
   the denominator (a position opened mid-period; a large late top-up) are
   genuinely described there and remain worth revisiting — but they were not what
   Brett was seeing. **Check one concrete figure against the source data before
   theorising about which term in the formula is at fault.**

   **The fixture hid it, exactly as PLAN.md warned.** `makeFakeActivity` defaulted
   `amount` to `"0"` and every test then passed an explicit amount for its buys,
   so no test ever exercised the null-amount path that production _always_ takes.
   This is the fourth instance of the same class of bug (see "Make fixtures
   disagree where reality can disagree"). The fixture now defaults `amount` to
   **null**, as the host does. Regression tests: "derives a BUY's cash value from
   quantity x unitPrice when the host reports a null amount"
   (`buildRankingEntries.test.ts`) and two loader-level cases in
   `loadHoldingActivityData.test.ts`. Confirmed to fail against the old code.

   **SECOND BUG, found straight after: every percentage rendered 100x too large.**
   With the maths fixed, the page still showed nonsense — `-5,493%` on LUNR,
   `+2,264%` on the L&G fund. Brett spotted the giveaway: **you cannot lose more
   than 100% of what you invested**, so a four-digit loss is arithmetically
   impossible and had to be a display fault, not a maths one. Confirmed by
   replaying the real calculation code against the real DB: the cash figures
   matched the screen to the penny while every percentage was exactly 100x its
   true value (-54.9% shown as -5,493%).

   **Cause: a units mismatch at the UI boundary.** `@wealthfolio/ui`'s
   `GainPercent` expects a **fraction** — it formats via
   `Intl.NumberFormat({ style: "percent" })`, which multiplies by 100 itself
   (confirmed by reading its compiled source; `normalizeDisplayPercent` passes the
   value straight through). We were handing it a value already scaled by 100.

   **Fix (Brett's suggestion, and the better one): fractions everywhere.** Rather
   than divide by 100 at the render site — a round-trip that invites exactly this
   class of bug — the `* 100` was removed from `periodStats` altogether. This also
   removes an inconsistency that had been there all along: `twr()` in the
   calculation core natively returns a fraction (`chain - 1`), and `periodStats`
   was scaling it up purely to store a percentage. The layer below and the layer
   above both wanted fractions; the ranking layer was the odd one out. Renamed to
   make the type honest: `PeriodStats.simplePct`/`twrPct` -> `simpleReturn`/`twr`,
   and `RankingEntry.periodReturnPct`/`periodTwrPct` -> `periodReturn`/`periodTwr`.
   **`RankingEntry.totalGainPct` is deliberately NOT part of this**: it is the
   _host's_ figure, its unit is unverified, and it is currently neither rendered
   nor ranked on. Check its convention before ever displaying it.

   **Verified against the real DB** by replaying the shipped `toCalcHolding` +
   `periodStats` code over Brett's actual activities/quotes (3M window): L&G Global
   Tech +22.6% (£58,282), SMT +6.2% (£17,458), LUNR -54.9% (-£3,273). All within
   sane bounds.

   **RESOLVED (2026-07-14): rank on cash only; show TWR on the row and MWR in the
   (i). The rank-mode toggle is gone.**

   The decisive input was Brett's account of _why he built the report_: he'd see the
   portfolio move (or fail to move when Tesla had) and couldn't tell which holdings
   drove it. **That is inherently a cash question.** £17k from SMT moves the
   portfolio; SPCX's +39% on £3.6k does not. A percentage _ranking_ answers a
   different question and answers it badly at these position sizes — it is dominated
   by whichever holdings are small enough to swing wildly.

   So: **`RANK_MODE = "gain-cash"` is now a constant** in HeroesAndVillainsPage. The
   toggle, `RANK_MODE_KEY`, `parseRankMode` and `RANK_MODES` are all deleted.
   `RankMode` survives only as the seam `rankEntries` is parameterised by.
   `TOP_COUNT` went 5 -> 7, so the smaller speculative holdings get a chance to
   surface past the large core positions.

   Both returns are shown per row, because **they answer different questions and
   neither is wrong**:

   - `periodTwr` (daily-chained) = _how the holding performed_ — **this is the
     pill**, since it adds what cash can't tell you (was the pick any good?).
   - `periodReturn` (simple/money-weighted) = _what my money actually made_ — in the
     (i) card, since it only differs from TWR when money moved and needs context.

   **Nothing ever ranks on TWR.** It ignores position size by design. The decisive
   case, which Brett arrived at himself: buy £1k, it doubles (+100%), pile in £10k,
   it falls 25%. TWR = **+50%**, MWR = **-18.2%**, cash = **-£2,000**. Ranking on TWR
   would put that at the top of the Heroes column while the account was down.
   Ranking on cash correctly files it as a Villain _with a +50% pill_ — the whole
   story in one row.

   Each mover carries an (i) hover-card showing the working:
   `start / bought / sold / dividends / end`, then both percentages. These come free
   — `periodStats` already computed every one of them and was discarding them.
   `PeriodStats` now returns `buys`/`sells`, and `RankingEntry.breakdown` (a
   `PeriodBreakdown`, null exactly when `periodReturnBase` is) carries them to the
   UI. A test asserts the breakdown reconciles to the headline figures, so the
   "working" can never drift into being a different sum from the number beside it.

   **A wrong hypothesis, recorded so it isn't re-derived:** I believed TWR needed
   "clamping" to the first purchase date, because ASTS (bought mid-window) showed
   -16.2% TWR vs -8.1% MWR and I assumed TWR was charging Brett for a pre-purchase
   fall. **It was not.** `twr()`'s existing `marketValueStart > 0` guard already
   skips every day with no position — verified: TWR over the full 6M window and TWR
   started on the buy date both return **exactly -16.16%**. The real cause of the
   gap is the **fill price**: Brett paid £56.57 while that day's close was £61.99.
   TWR is close-to-close (£61.99 -> £51.97 = -16.2%); MWR uses what was actually paid
   (£56.57 -> £51.97 = -8.1%). No code change was needed. Full docs in DOCS.md.

   **Deferred to a separate addon (Brett's call):** a watchlist / themes view for
   monitoring the speculative sleeve (Tesla, RPI, the space stocks). A top-7 ranking
   only surfaces those when they're extreme, which is precisely when you least need
   telling — that job wants a stable, always-visible list, not a leaderboard. The
   Python reference's `themes` concept is the seed for it.

   **Dividends are confirmed included** in the cash figure — see below — so
   they were never the explanation.

0b. **STOCK SPLITS WERE IGNORED — ROOT-CAUSED AND FIXED (2026-07-14).** Found
because Brett questioned Tesla's YTD figures (`+£4,629.74`, `+17.21%`). Both
were wrong. **`SPLIT` activities were dropped entirely**, so a position's unit
count was frozen at its pre-split quantity.

**Real impact:** Brett's 2020 Tesla buy of **3 shares** became **45** after the
5-for-1 (Aug 2020) and 3-for-1 (Aug 2022) splits. The addon still counted
**3** — under-counting that holding **fifteenfold** and valuing his January
2026 Tesla position at **£6,345 instead of £20,370**. Correct YTD figures:
cash **£3,025**, MWR **+7.39%**, TWR **-11.6%**.

**Why it hid so well:** the cash figure still _looked_ plausible, because the
under-count largely cancels between the opening and closing market value. Only
the percentage was visibly odd. A wrong number that looks right is worse than
one that looks wrong — and it took Brett querying it twice to shake it out.

**The two traps in Wealthfolio's encoding** (see also
`reference_wealthfolio_splits` memory):

- **`amount` holds the RATIO, not cash** (`5` = 5-for-1), with `quantity` and
  `unitPrice` both 0. So the standard `quantity * unitPrice + fee` derivation
  yields **0**, which would wipe the position out; and summing `amount` into a
  cash flow would invent money from nowhere. A split must contribute **nothing**
  to `periodFlows`.
- **Quote history is already split-adjusted** by the provider — the close drops
  by the ratio on the split date — so units _must_ be scaled up to match, or the
  holding appears to lose value for free.

**Fixed in:** `calculations/types.ts` (new `splitRatio()` helper + `SPLIT` added
to `ActivityKind`), `calculations/returns.ts` (`stateOn`, `twr`, `portfolioTwr`
all scale units; `periodFlows` deliberately still ignores splits),
`loadHoldingActivityData.ts` (`SPLIT` added to `RELEVANT_ACTIVITY_TYPES`; ratio
passed through instead of derived), `buildRankingEntries.ts`
(`addClosedInstruments` skips splits — a split is not a trade and can neither
open nor close a position).

**Still untested:** reverse splits. `REVERSE_SPLIT` is a _subtype_ of `SPLIT`,
not a separate activity type, so it flows through the same path — correctly
**if** the ratio is recorded as a fraction (`0.1` for a 1-for-10). If the host
stores `10` and leans on the subtype to signal direction, units would be
multiplied instead of divided. No holding has ever reverse-split. Check
`amount` before trusting it.

**Lesson for the next investigation:** three times during this hunt a
hand-computed figure disagreed with the app, and **every time the app was right
and the hand calculation was wrong** (bad FIFO assumption, then a stale FX rate,
then a stale close). Replay the _shipped code_ against the real DB and treat
that as the reference; hand arithmetic is a hypothesis, not ground truth.

1. **CURRENCY HANDLING IS BROKEN IN TWO WAYS — verified against the real DB
   2026-07-13.** Investigating item 1 turned up a second, worse bug, and
   overturned the milestone-5 decision that created item 1 in the first place.
   Both are now the top priority: between them they exclude or corrupt _most_
   of the portfolio.

   **(a) `GBp` (pence) is not `GBP` (pounds).** Wealthfolio quotes UK equities
   in **pence**, with `quote_ccy = 'GBp'` (lowercase p) — confirmed in the real
   `assets` table for SMT, TMPL, RPI, CHRY, CTY, BYG, CLI, ALW, VWRA, and
   confirmed as a deliberate platform convention by the SDK's own type comment
   on `quoteCcy` ("Resolved quote currency hint (e.g., GBp)"). SMT's latest
   close is `1447` = £14.47, not £1,447. Consequences:
   - `buildRankingEntries` compares `instrument.currency !== baseCurrency`
     against `"GBP"`, so **every `GBp` holding currently fails the check and is
     silently excluded from period figures** — i.e. most of Brett's UK stocks,
     not just the USD ones. This is very likely why so much showed as
     "excluded"/blank.
   - Worse, a naive fix (case-insensitive compare) would let them through
     **with prices 100× too large**. `GBp` must be detected and divided by 100,
     not merely accepted.

   **(b) The historical FX series DOES exist — the milestone-5 decision to
   exclude non-base-currency holdings was based on an unverified assumption
   and is wrong.** PLAN.md previously stated "the SDK exposes no historical FX
   rate series — only today's static rate." Checked the real DB: there is an
   `assets` row with `kind: 'FX'`, `display_code: 'USD/GBP'`, id
   `4d000275-5b74-43eb-be3e-ea5296d96503`, carrying **2,217 daily quotes from
   2018-01-12 to today** (latest close 0.7475, i.e. USD→GBP). This is exactly
   the FX-pair asset the Python reference looks up, and it is reachable from
   the addon via `quotes.getHistory(fxAssetId)` like any other asset — no new
   permission needed (`quotes` is already declared). So USD holdings can get
   faithful, historically-correct period figures; nothing needs fabricating.

   **(c) THE QUOTE CURRENCY IS NOT ON THE HOLDING — it is on the ASSET.**
   Found in the first real-app test of the (a)/(b) fix (2026-07-13): SMT, CTY,
   TMPL, RPI and ALW still came out ~100x too large. The log was clean (the
   `currency` permission registered fine, no `AddonPermissionDenied`), so this
   was a data bug, not a permissions one. Cause: the fix read the currency from
   **`Holding.instrument.currency`**, which the host reports as a _normalised_
   `GBP` even for stocks whose quote history is denominated in pence — so
   `isPenceCurrency` never fired and nothing was ever scaled. The `GBp` value
   lives on a _different type_: **`Asset.quoteCcy`** (maps to `assets.quote_ccy`
   in the DB — the field Brett curates by hand), reachable only via
   `assets.getProfile(assetId)`. `Holding` also has a `localCurrency`, which is
   likewise normalised and likewise not the quote currency. **Three plausible
   currency fields; only `Asset.quoteCcy` is the one the quote history is
   actually denominated in.**
   **Fix**: `resolveQuoteCurrencies` in `buildRankingEntries.ts` fetches each
   instrument's asset profile and overwrites the holding-reported currency with
   `quoteCcy` before any conversion happens. Added the `assets` permission
   category (risk `medium`, function `getProfile`) to `manifest.json`. This also
   fixes closed positions for free, which had been falling back to the shakier
   `ActivityDetails.currency` guess.
   **Testing lesson**: every earlier fixture set `instrument.currency` and the
   quote currency to the _same_ value, which made this bug structurally
   invisible to the unit tests — the same class of mistake as the
   `instrument.id = symbol` fixture bug in milestone 4.5. The regression test
   ("reads the quote currency from the asset profile, not the holding's
   instrument.currency") deliberately makes the two fields _disagree_. When a
   fixture models two fields that can differ in reality, make them differ.

   **DONE and VERIFIED IN THE REAL APP (2026-07-13).** Brett confirmed the
   figures look right after the (c) fix; `Wealthfolio.log` clean, no
   `AddonPermissionDenied`, all eight categories registered
   (`accounts,portfolio,activities,quotes,assets,settings,currency,ui`).
   **This also confirms the FX-asset-id inference below was correct**:
   `ExchangeRate.id` really is the FX asset's id, and `quotes.getHistory`
   accepts it — the one assumption that could not be checked offline.
   `src/ranking/currency.ts` holds the pure rules (`isPenceCurrency`,
   `toMajorUnits`, `toMajorCurrency`, `buildFxRateSeries`, `rateOn`);
   `src/ranking/loadFxRates.ts` discovers and loads the rate series;
   `toCalcHolding` now takes a `CurrencyContext` and normalises every quote to
   base currency at load time. Key points:
   - **Only quotes are converted, not activities.** Confirmed against the real
     DB: Brett's broker (ii) records activities in `GBP` — the base currency —
     even for pence-quoted and USD-quoted instruments (CTY's quotes are ~567
     pence while its buys record a unit price of 5.67 pounds; TSLA's activities
     are in GBP with a null `fx_rate`). So activities need _neither_ the pence
     scaling nor the FX conversion. Applying either to them would reintroduce
     the 100x error from the other direction. Revisit if a broker is ever added
     that records activities in the instrument's own currency.
   - **FX asset discovery**: there is no `assets.findBySymbol` in the SDK, so
     the FX asset's UUID is found via `exchangeRates.getAll()`, whose
     `ExchangeRate.id` _is_ the FX asset's id (there is no `exchange_rates`
     table in the DB — the host derives that list from the `kind: 'FX'` assets),
     and its history then comes from `quotes.getHistory(thatId)` like any other
     asset. **This id-equivalence is inferred, not documented — verify it in the
     smoke test.** If it is wrong, USD entries degrade to
     `periodDataAvailable: false` (today's behaviour) rather than breaking.
   - **The rate is applied per quote date** (`rateOn`), with a walk-back to the
     most recent earlier rate for weekends/holidays, and a hard null before the
     series starts — never today's rate for a historical day, which would
     conflate currency movement with price movement over a long window.
   - **Permission gotcha**: the exchange-rates API lives under the permission
     category id **`currency`** (risk `low`, functions `getAll`/`update`/`add`),
     _not_ `exchangeRates`. Added to `manifest.json`. Per the `ui` lesson, a
     missing category fails silently at runtime, so this one matters.
   - `periodDataAvailable: false` now means only "no price history, or a foreign
     currency with no reachable FX pair" — not "anything not in base currency."

   **This blocked testing**: Brett's one recently-closed position (item 3) is
   USD, so closed positions could not be verified in the real app until this
   landed.

2. **USD (non-base-currency) stocks are missing from the ranking.** _Superseded
   by item 0 above — retained for context._ Currently
   `buildRankingEntries` compares `holding.instrument.currency` against
   `settings.get().baseCurrency` and, on a mismatch, sets
   `periodDataAvailable = false` — the entry gets `null` period figures and is
   excluded from both columns, listed only in the small "Excluded from period
   ranking" note. So a US holding can be the biggest mover in the portfolio
   and never appear. This was a deliberate milestone-5 decision (see above:
   the SDK exposes no historical FX rate series — only today's static rate via
   `ExchangeRatesAPI.getAll()` / `Holding.fxRate`), but it makes the report
   materially wrong for anyone holding USD stocks, which Brett does.
   The Python reference solves this by looking up an FX-pair asset (e.g. a
   `USD/GBP` `display_code` row) in the DB and using its quote history as the
   historical rate series. Options, none yet chosen:
   - Try the same FX-pair-asset lookup through `quotes.getHistory` — if
     Wealthfolio stores FX pairs as assets with quote history, this is a
     faithful port and the problem disappears. **Check this first**: it may
     just work, and the milestone-5 decision to punt was made without
     verifying whether the pair asset is reachable from the addon SDK.
   - Compute the period figures in the instrument's _local_ currency and
     display them as such (honest, no FX fabrication, but the Cash £ ranking
     then can't compare a USD holding against a GBP one).
   - Convert using today's static rate for every historical point (simple,
     but silently wrong — conflates FX movement with stock movement; probably
     unacceptable for a multi-year period).

3. **DONE (implementation), pending real-app smoke test (2026-07-13) — Totals
   summary bar.** `src/ranking/periodTotals.ts` (`periodTotals`) mirrors the
   Python `_totals_bar_html` (`heroes-and-villains-report.py` ~line 285):
   **Total gains** (sum of every positive `periodReturnBase`), **Total losses**
   (sum of every negative one) and **Net change** (the two added), computed
   across _every_ entry — not just the top-5 shown in the columns — and
   rendered green/red by `TotalsBar` in `HeroesAndVillainsPage.tsx`.
   Decisions worth keeping:
   - **Cash only, in both rank modes.** The bar does not change when the
     Cash £ / Simple % toggle flips: a sum of percentages across holdings of
     different sizes is meaningless, so there is deliberately no percent
     variant.
   - **The bar says what it covers**, per the concern raised when this item was
     first written. An entry with no period figure (`periodReturnBase === null`
     — no price history, or a foreign currency with no reachable FX pair)
     cannot be counted, and counting it as zero would quietly understate the
     net change. `periodTotals` therefore returns `countedEntries` /
     `excludedEntries` alongside the money, and the bar reads "Across N of M
     holdings — K could not be valued for this period" whenever anything was
     dropped (falling back to a plain "across all N holdings" when nothing
     was). Closed positions are already in the entry list (item 3), so they
     are in the totals.

4. **Positions closed during the period** (replaces the Python's
   `RECENTLY_CLOSED_DAYS` concept). Positions sold during the period still
   moved during it, but the addon only ever sees _current_ holdings via
   `portfolio.getHoldings`, so a stock sold last week is invisible — and would
   be missing from the totals bar too, making "Net change" wrong.

   **Decided with Brett (2026-07-13):**
   - A position closed **within the selected period** ranks in the **same
     heroes/villains lists as open positions** — "they still moved." Not a
     separate list or section.
   - It carries a **"closed" badge/tag** in the UI (the Python reference does
     this too — `span.badge.closed`), so the reader can see why a holding they
     no longer own is in the list.
   - **`RECENTLY_CLOSED_DAYS` is therefore dropped entirely.** "Closed" is
     defined _by the selected period_, not by a fixed recent-days window. This
     is simpler than the Python (which mixes the two rules, and whose fixed
     window diverges badly from the period on e.g. a 5-year selection) and it
     is what makes the totals bar honest: every entry that moved during the
     period is in the list, so the totals actually total the period.

   **Implementation notes (from reading the code, 2026-07-13):**
   - `periodStats` needs **no change**. A closed position is simply one whose
     `stateOn(holding, endDate)` market value is zero/null with a large `sells`
     figure in `periodFlows`; `growth = end - start - (buys - sells)` already
     nets the sale proceeds against the vanished market value correctly. The
     calculation core was ported from a Python version that always supported
     closed entries.
   - The real work is **discovery**, in `buildRankingEntries`: the instrument
     list is currently built purely from `getHoldings`, so anything sold is
     never considered. But `allActivities` (already fetched, one
     `activities.getAll` per account) contains the sold instruments — we simply
     never look. Discovery = instruments with activity in the period that have
     no current holding.
   - `ActivityDetails` carries `assetId`, `assetSymbol`, `assetName` and
     `currency`, which is enough to build a `RankingEntry` with no `Holding`.
     A closed entry has `marketValueBase: 0` and no all-time
     `totalGainBase`/`totalGainPct` (those come from `Holding`; leave null).
   - **Caveat to watch:** `ActivityDetails.currency` is the _activity's_
     currency, not guaranteed to be the instrument's quote currency, so the
     base-currency check for a closed position is slightly less trustworthy
     than the `holding.instrument.currency` check used for open ones. In
     practice a non-base-currency closed position is excluded from period
     figures anyway (same as an open one), so this is consistent — but don't
     lean on `ActivityDetails.currency` for anything finer without verifying.

5. **Generalise the minor-unit ("pence") handling beyond GBP.** The currency fix
   (item 0) hardcodes the sterling case: `src/ranking/currency.ts` treats the
   literal code `GBp` as pence and resolves it to `GBP`, dividing by 100. That
   is correct for Brett but parochial. Two things to generalise:
   - **The minor-unit rule is not GBP-only.** `GBp` is one instance of a general
     Yahoo convention for quoting in a currency's minor unit; others exist (e.g.
     `ZAc` South African cents, `ILA` Israeli agorot). The right shape is a
     lookup table of `minorCode -> { majorCode, divisor }` rather than a
     hardcoded `GBp`/100 special case. The divisor is not always 100 in
     principle, so keep it per-entry rather than assuming.
   - **The base currency is already dynamic, but the GBp path assumes it isn't.**
     `toMajorCurrency("GBp")` returns the literal `"GBP"`. For a EUR-based user
     holding a `GBp` London stock this should scale pence to pounds and _then_
     FX GBP->EUR. The code as written _should_ do that (the FX step keys off
     `toMajorCurrency(...) !== baseCurrency`), but it has only ever been
     exercised with `baseCurrency === "GBP"`, where the FX step is skipped
     entirely — so the pence-plus-FX path is **untested**. Add a test for a
     non-GBP base currency before trusting it.
   - Keep the core principle intact while generalising: **the asset's declared
     quote currency is the single source of truth, never inferred from the
     instrument type, exchange, or price magnitude.** Brett's DB has genuine
     `GBP` funds priced at £100+/unit alongside `GBp` equities priced in the
     hundreds of pence, so any "this number looks too big to be pounds"
     heuristic would corrupt exactly those funds. Brett curates `quote_ccy` by
     hand where Yahoo gets it wrong; the addon must respect that.

6. **Honour the base currency from settings — stop assuming GBP.** (Raised by
   Brett, 2026-07-14.) The addon _reads_ `settings.get().baseCurrency` and
   threads it through correctly, so this is not broken for Brett — but GBP is
   baked in as an assumption in enough places that a non-GBP user would get
   wrong figures rather than an error. This is about **the base currency**;
   item 5 above is about the _quote_ currency's minor units. Related, not the
   same.

   Places GBP is assumed today:
   - **`HeroesAndVillainsPage.tsx`** — `settingsQuery.data?.baseCurrency ?? "GBP"`.
     A silent GBP fallback is the wrong failure mode: if settings can't be read,
     every figure is mislabelled and wrong. Render an error (or a skeleton) and
     compute nothing rather than guess a currency.
   - **`calculations/types.ts`** — the field is literally named `quotesGbp`, and
     its comment says "close price per share, in GBP". It actually holds prices
     in the _base_ currency. `portfolioTwr`'s comment says "last-known GBP quote"
     too. Renaming to `quotesBase` would stop this misleading the next reader.
   - **`loadHoldingActivityData.ts` — the load-bearing one.** It leaves activity
     figures in their recorded currency, on the verified assumption that Brett's
     broker (ii) records every activity in GBP, his base currency, even for
     USD- and pence-quoted instruments. **That is a fact about ii, not about
     Wealthfolio.** A broker that records activities in the _instrument's_
     currency would need buys/sells/dividends FX-converted at each activity's
     own date — which the addon currently never does. This is the assumption most
     likely to produce silently-wrong figures for someone else, and it deserves a
     real check before publishing (compare `activity.currency` against
     `settings.baseCurrency` and at minimum warn when they differ).

   Worth doing before any public release, since the whole point of publishing is
   users who aren't Brett. Not urgent for Brett himself.

7. **Themes** (Python `config.py` `THEMES`, e.g. the "Space" grouping) — rank a
   named basket of stocks as a single entry alongside individual holdings.
   Deferred from v1 (design decision 4). Open: whether themes live in addon
   settings, a bundled config file, or a UI.

8. **Account-filter persistence.** The filter resets every session — there is
   no generic `storage` API on the real `HostAPI`, only `secrets` (see open
   question below).

9. **Milestone 5 real-app verification is still incomplete.** The install
   outage above consumed the smoke test. Still unconfirmed against real data:
   that `activities.getAll(accountId)` and `quotes.getHistory(instrumentId)`
   return the volumes/shapes assumed, that `ActivityDetails.assetId` reliably
   matches `Holding.instrument.id`, and how the three new permission prompts
   (`activities`/`quotes`/`settings`) actually behave. Also still unanswered:
   the side-by-side comparison of our TWR/simple-return math against the
   host's own `Holding` figures (design decision 1) — the whole reason the
   calculation core was ported.

10. **DONE (implementation), pending real-app smoke test (2026-07-13) — Styling,
    via Wealthfolio's own design system.** The page was unstyled default HTML
    (`fieldset`/`button`/`ul`) with hardcoded hex colours. It now uses
    **`@wealthfolio/ui`**, the host's own component library — see the
    "Styling" section under Implementation notes below for the full mechanism
    and its two traps. Summary of the change:

- `Page`/`PageHeader`/`PageContent` chrome, `Card` per movers column,
  `GainAmount`/`GainPercent` for the figures, `Badge` for the closed tag,
  `AnimatedToggleGroup` for Rank-by, `Checkbox`+`Label` for the account
  filter, `TickerAvatar` per row, and `Skeleton` loading states.
- **Every hardcoded hex colour is gone** (`#1a7f37`/`#b42318`/`#666`/`#555`).
  Those were the reason the page could never work in dark mode.
- `formatCash`/`formatPct` deleted — `GainAmount`/`GainPercent` replace them,
  and they take a `currency` prop, so the hardcoded `£` is gone too. The page
  now reads `settings.get().baseCurrency` (permission already declared).
- **The period selector was rekeyed to the host's `TimePeriod` codes**
  (1D/1W/1M/3M/6M/YTD/1Y/5Y/ALL), replacing our hand-rolled 8-button set.
  Checked before adopting: the host's ranges are the _same_ calendar-lookback
  semantics we already had (`subMonths(now, 3)` for 3M, default 3M — matching
  our old `DEFAULT_PERIOD_KEY`), so this is not a change to the period _maths_.
  We still resolve the window ourselves via `periodDateRange` rather than
  using the selector's `Date` pair, keeping one tested implementation and the
  "YYYY-MM-DD" string convention the rest of the addon uses.
  **Net gain**: YTD and ALL periods for free. **Net loss**: the distinct
  "3 Years" period (the host jumps 1Y → 5Y).
  ~~and the selector's `storageKey` prop persists the choice across sessions
  via localStorage~~ — **this was wrong, and silently so.** The addon was
  adopted the host's `IntervalSelector` component here; that claim held for
  ~24 hours until 3.6.2 made clear that **`localStorage` does nothing in an
  addon** (opaque-origin iframe), so the `storageKey` had been persisting
  nothing all along. Superseded on 2026-07-14 — see "The period selector:
  why we don't use the host's `IntervalSelector`" below.
- Bundle stayed tiny (**19.8 kB**) because the UI library is externalised,
  not bundled — see below.

11. **Set up the hot-reload dev loop via `@wealthfolio/addon-dev-tools`.**
    Current loop is build → install zip → test in installed app → read
    `Wealthfolio.log`; no live reload. The getting-started doc's
    `pnpm dev:server` is **not** our `"dev": "vite build --watch"` — it's a
    separate CLI, `@wealthfolio/addon-dev-tools` (v3.6.2, matching our SDK),
    that ships a `wealthfolio` binary running an Express+CORS server on
    `localhost:3001` with chokidar file-watching. Steps:
    - `pnpm add -D @wealthfolio/addon-dev-tools`, add script
      `"dev:server": "wealthfolio dev"` (additive — keep `dev`/`build`/
      `publish-addon`).
    - Run `npx @wealthfolio/addon-dev-tools --help` (and `dev --help`) to see
      whether it accepts our existing `dist/`/`vite.config.ts` layout or wants
      its own; optionally scaffold a throwaway with
      `npx @wealthfolio/addon-dev-tools create hello-world` and diff its
      config against ours.
    - **KEY QUESTION: can the dev server feed the _installed_ Wealthfolio
      binary, avoiding a from-source build?** The doc's auto-discovery path
      runs the app from source (`VITE_ENABLE_ADDON_DEV_MODE=true pnpm tauri
      dev`), which needs the full Tauri/Rust toolchain and a local clone of
      `wealthfolio/wealthfolio`. Investigate whether the installed app can be
      launched with `VITE_ENABLE_ADDON_DEV_MODE=true` (or an equivalent
      env/flag/setting) so it discovers `localhost:3001` directly. If yes, we
      get hot reload without ever building their app. If no, the from-source
      clone is a local debug harness only — never forked/committed/owned; our
      addon stays in its own repo regardless.

## Open questions to revisit

- Does `Holding`'s `totalGainPct`/`totalReturnPct` already match the "simple
  total return" and "TWR" definitions used in `calculations.py`, or is there
  a methodology difference (e.g., dividend treatment, FX timing)? Won't know
  until milestone 5's side-by-side comparison runs against real data.
- Multi-account same-ticker merge: confirm `Holding` identifies the account
  it came from (needed to merge across accounts) — check the exact `Holding`
  type shape once we're implementing milestone 3.

---

# Implementation notes

Reference documentation for how the addon actually works, and — just as
importantly — which plausible-looking approaches turned out to be dead ends and
why. Written 2026-07-13 after everything below was verified running against real
data in Wealthfolio 3.6.1. The milestone history above records how we got here;
this section is what you'd want if you were picking the code up cold.

## How a figure gets on screen

For a selected period and set of accounts:

1. **Discover what to rank.** `portfolio.getHoldings(accountId)` per account
   (there is no portfolio-wide endpoint — see "Dead ends"), merged by symbol so
   a stock held in two accounts becomes one entry. Then `addClosedInstruments`
   scans activity history for instruments traded _within the period_ that are no
   longer held, and adds those as entries flagged `isClosed` — they still moved
   during the period, so they still rank.
2. **Resolve each instrument's true quote currency.** `assets.getProfile(id)` →
   `Asset.quoteCcy`. This is not optional and not the obvious field; see
   "Currency" below.
3. **Load the raw material.** `activities.getAll(accountId)` once per account
   (not per instrument — that would be an N×M call explosion) and
   `quotes.getHistory(instrumentId)` per instrument. Neither call takes a date
   filter, so the period window is applied client-side.
4. **Normalise every quote to base currency** (`toCalcHolding`): pence → pounds,
   then FX at each quote's own date. Activities are deliberately left alone.
5. **Compute the period figures** (`periodStats`, a port of the Python
   reference's `entry_period_stats`): take a market-value snapshot the day
   before the period starts and one at the end, total the buys/sells/dividends
   in between, then
   `growth = (mvEnd - mvStart) - (buys - sells)`,
   `totalReturnCash = growth + dividends`,
   `simplePct = totalReturnCash / (mvStart + buys) * 100`, plus a daily-chained
   TWR.
6. **Rank** (`rankEntries`): heroes are positive entries best-first, villains are
   negative entries worst-first, each capped at 5. Split by _sign_, not by
   position — so an all-green period legitimately has no villains.
7. **Total** (`periodTotals`): the totals bar sums the period cash return over
   _every_ entry, not just the ten on screen, into gains / losses / net change.
   Cash only — percentages don't sum — so it is identical in both rank modes.
   Entries that could not be valued are reported as a count on the bar rather
   than silently treated as zero.

## Which API supplies the figures — and the one that couldn't

**We compute the period figures ourselves**, from `activities.getAll` +
`quotes.getHistory`. This is not the obvious choice, and it is worth
understanding why the obvious choice fails, because it looks right until you
inspect what it returns.

**Dead end: `performance.calculateSummary({ itemType: 'symbol' })`.** This is
the API that _appears_ purpose-built for this — you hand it a symbol and a date
range and it hands back returns. It was implemented, shipped, and looked
plausible. It is structurally incapable of doing the job, and this is a hard API
limitation rather than a bug or a misuse:

- Logging the raw `PerformanceResult` (via `ctx.api.logger`, which needs no
  permission entry and writes straight to `Wealthfolio.log`) showed, for every
  symbol: `amountStatus: "unavailable"`, `method: "symbolPriceBased"`, and the
  explicit reasons _"TWR unavailable for symbol-only price performance because
  there is no portfolio cash-flow scope"_ and _"IRR unavailable ... because
  there are no user cash flows"_.
- A bare symbol has no cash-flow context — no buys, sells or dividends are tied
  to it without an account — so **the cash amount is always null**, and the
  percentage it does return is **price-only**: it excludes dividends, unless the
  quote series happens to be total-return adjusted. That is why the percentages
  "looked untrustworthy": for a dividend payer they were simply too low.
- `itemType: 'account'` doesn't rescue it either. `PerformanceResult.attribution`
  is whole-account aggregate only (`contributions`, `distributions`,
  `realizedPnl`); there is **no per-symbol breakdown anywhere in the
  `performance` API**.

So: there is no `performance.*` call that returns a period-scoped,
dividend-inclusive, per-symbol cash return. Getting one _requires_
activity-level cash-flow maths. The ported `calculations.py` logic in
`src/calculations/` was originally framed as an optional cross-check against the
host's numbers; it turned out to be a hard requirement. **If someone proposes
"just use the performance API" again, this is the answer.**

**Also not usable: `Holding.totalGain`/`totalReturn`/`totalGainPct`.** These are
real, host-computed, dividend-inclusive cash figures — but they are **all-time**,
not period-scoped. They are still carried on `RankingEntry` as
`totalGainBase`/`totalGainPct` (useful as a fallback and for display), but they
cannot answer "what moved _this quarter_", which is the whole point of the addon.

## Are dividends included? Yes — in the cash figure. Confirmed 2026-07-13.

Traced through the code, since this is the single most load-bearing property of
the whole addon (it is the reason the host's `performance` API had to be
abandoned — see above — so it is worth being able to answer without re-deriving):

- `periodFlows` (`src/calculations/returns.ts`) sums `DIVIDEND` activity amounts
  over the window, alongside `BUY` and `SELL`.
- `periodStats` (`src/ranking/periodStats.ts`) computes
  `growth = (mvEnd - mvStart) - (buys - sells)` and then
  **`totalReturnCash = growth + dividends`**.
- That lands on `RankingEntry.periodReturnBase` — the **Cash £** column and the
  totals bar. So the cash figures are genuine dividend-inclusive total return.

The percentage, `simpleReturn`, divides that same dividend-inclusive numerator by
`(mvStart + buys)`, so **dividends are in the percentage too**. (That denominator
is money-weighted rather than time-weighted — not a fault, but a different
question from the one TWR answers; see outstanding item 00, now resolved by
showing both.)

`periodTwr` also treats a dividend as a cash outflow when chaining, so it is
likewise total-return, not price-only.

**The contrast worth remembering:** the host's
`performance.calculateSummary({ itemType: 'symbol' })` is **price-only** and
explicitly warns that "dividends and distributions are excluded unless the quote
series is total-return adjusted." Ours is not — which is the whole point of doing
the activity-level maths ourselves.

## Currency: the part most likely to bite you

Three separate traps, all of which produced wrong numbers that looked
superficially reasonable. Get these wrong and figures come out 100x off, or
holdings silently vanish from the ranking.

**1. The quote currency is on the ASSET, not the holding.** There are three
plausible currency fields and only one is correct:

| Field                         | What it actually is                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------ |
| `Holding.instrument.currency` | **Normalised.** Reports `GBP` even for pence-quoted stocks. Not the quote currency.              |
| `Holding.localCurrency`       | Also normalised. Also not it.                                                                    |
| **`Asset.quoteCcy`**          | **The real one.** The unit the _quote history_ is denominated in. The only field carrying `GBp`. |

`Asset.quoteCcy` is reachable only via `assets.getProfile(assetId)` (permission
category `assets`). `resolveQuoteCurrencies` in `buildRankingEntries.ts` fetches
it and overwrites whatever the holding claimed, before any conversion happens.

**2. `GBp` means pence, and it is per-security, not per-market.** Wealthfolio
(following Yahoo) quotes some instruments in pence, flagged by the exact code
`GBp` — lowercase p, and the comparison is deliberately case-sensitive. Divide
those by 100.

**Do not try to infer this.** Not from the instrument type, not from the
exchange, and above all **not from the magnitude of the price**. The real DB
holds genuine `GBP` funds priced at £100+/unit (Vanguard LifeStrategy, Global
Small-Cap) sitting alongside `GBp` equities priced in the hundreds of pence. A
"that number looks too big to be pounds" heuristic corrupts exactly those funds.
Yahoo's labelling is inconsistent and Brett curates `quote_ccy` by hand where it
is wrong — **the asset's declared quote currency is the single source of truth**,
and if a security is mislabelled the fix belongs in Wealthfolio, not in a guess
here.

**3. Quotes and activities are on different scales — convert quotes only.**
Brett's broker (ii) records activities in `GBP` even for `GBp`-quoted
instruments: CTY's quotes sit around 567 (pence) while its buys record a unit
price of 5.67 (pounds). Since `periodStats` subtracts activity cash flows from
quote-derived market values, the two must be reconciled — but the fix is to
scale the _quotes_, not the activities. Normalising both reintroduces the same
100x error from the other direction. The same applies to FX: activities for USD
instruments are already in GBP with a null `fx_rate`, so they need no conversion
either. **Revisit only if a broker is added that records activities in the
instrument's own currency.**

## Historical FX rates

An earlier version of this plan asserted that the SDK exposes no historical FX
series and therefore non-base-currency holdings had to be excluded. **That was
an unverified assumption and it was wrong.** Foreign holdings get fully correct,
historically-converted figures:

- Wealthfolio stores each FX pair as an **ordinary asset** (`kind: 'FX'`,
  `display_code: 'USD/GBP'`) with a full daily quote history — 2,217 daily
  quotes back to 2018 in Brett's DB. There is no `exchange_rates` table; the
  host derives its rate list from these assets.
- There is no `assets.findBySymbol`, so the FX asset's UUID is discovered via
  `exchangeRates.getAll()` — **`ExchangeRate.id` _is_ the FX asset's id**
  (inferred, then confirmed working in the real app). Feed that id to
  `quotes.getHistory()` like any other asset.
- Convert at **the rate on each quote's own date** (`rateOn`), walking back to
  the most recent earlier rate for weekends and holidays. Never use today's rate
  for a historical day — over a multi-year window that conflates currency
  movement with price movement, which is precisely the error the whole exercise
  is meant to avoid.

`periodDataAvailable: false` now means only "no price history, or a foreign
currency with no reachable FX pair" — not "anything not in base currency".

### Wealthfolio 3.6.2 changed how the host itself treats FX — cross-check before trusting a discrepancy

Wealthfolio **3.6.2** (2026-07-13) shipped a fix described in its release notes as
**"holding returns now exclude FX"**: cross-currency transfers had been folding
exchange-rate movement into security performance and inflating return
percentages. The host now strips that out.

This lands squarely on the figures this addon computes, and it cuts both ways:

- **It is the same class of error this addon already guards against.** Converting
  at each quote's own date (`rateOn`), rather than at today's rate, exists
  precisely so currency movement is not misread as price movement. The host has
  now made the equivalent correction on its side.
- **So the two should agree — and if they don't, that is informative.** Before
  3.6.2 a discrepancy between our per-holding return and the host's own could be
  explained away by the host's FX handling. That excuse is gone. **Any remaining
  disagreement on a foreign holding is now a genuine signal that one of the two
  is wrong, and the first place to look is our FX conversion**, not the host's.

Worth an explicit cross-check against the host's displayed returns for the USD
holdings whenever the FX or period-returns code is next touched. Not yet done —
noted 2026-07-14, after the 3.6.2 upgrade and port.

Note also that 3.6.2's corrected dividend-adjusted history (a MarketData.app
double-counting fix) **requires a full market-data backfill**, so quote history
for a given asset may legitimately differ before and after that backfill runs —
another reason a figure can move without this addon's code changing.

## Styling: use the host's design system, don't invent one

**`@wealthfolio/ui` (v3.6.1) is the official component library** — shadcn/ui +
Tailwind with Wealthfolio's Flexoki theme. It is the same library the host app
itself is built from, so using it is what makes an addon look native rather than
like a bolted-on web page. Verified 2026-07-13 by installing it and reading the
compiled `dist/index.js` (the README is unreliable here — see trap 1).

Useful exports: `Page`/`PageHeader`/`PageContent`, `Card*`, `Badge`,
`AnimatedToggleGroup`, `IntervalSelector`, `Checkbox`, `Label`, `Separator`,
`Skeleton`, `TickerAvatar`, `EmptyPlaceholder`, `DataTable`, `cn()`, and the
financial ones — `GainAmount`, `GainPercent` (has a `variant="badge"`),
`AmountDisplay`, `PrivacyAmount`.

### The period selector: why we don't use the host's `IntervalSelector`

The page drives `AnimatedToggleGroup` directly with the period codes rather than
using `IntervalSelector`, even though the latter looks like the obvious fit.
Reading its compiled source (2026-07-14) shows it is **a thin wrapper around that
same `AnimatedToggleGroup`**, and the wrapper is what causes the problems:

1. **The selected period is hard to see, and no prop can fix it.** It hardcodes
   `className="pointer-events-auto bg-transparent"` on the toggle group, stripping
   the group's background so the pill marking the current selection has nothing to
   sit against. This is not overridable: the component's props are only
   `onIntervalSelect`/`className`/`isLoading`/`defaultValue`/`storageKey`/`onHaptic`,
   and its `className` lands on the **outer wrapper div**, not on the toggle group
   where the `bg-transparent` sits. **The transparency is deliberate _for the
   host's usage_** — Wealthfolio overlays this selector on a chart, which supplies
   the backdrop the pill reads against. On a plain addon page there is nothing
   behind it, so the contrast is simply gone (in both light and dark mode — the
   problem is the missing background, not the colour behind it). The Rank-by
   toggle is the same control _without_ `bg-transparent` and shows a solid,
   obvious pill, which is the giveaway.
2. **It is uncontrolled.** There is no `value` prop — only `defaultValue`, read
   once on mount. Restoring a persisted period through it means delaying its
   mount until storage resolves, or it latches onto the default and displays the
   wrong period while the data below uses the right one. (Do not be fooled by the
   presence of `value` on `AnimatedToggleGroup` itself; `IntervalSelector` does
   not forward one.)
3. **Its `storageKey` persists nothing in an addon** — it uses `localStorage`,
   which is unavailable in the sandboxed opaque-origin iframe. See the storage
   section; this silently did nothing for a day.

Using `AnimatedToggleGroup` directly fixes all three at once and costs only an
explicit `PERIOD_KEYS` list (in `src/periods.ts`, which already owned the period
maths). **The general lesson: a host component that wraps another host component
may bake in styling and state choices that suit the host's own page and not
yours — read the compiled source before assuming the wrapper is the right level
to use.**

**How the theming actually works.** The components emit _semantic Tailwind class
names_ (`bg-card`, `text-destructive`, `bg-success`, `text-muted-foreground`) and
ship **no CSS of their own**. The host's stylesheet defines those tokens as CSS
variables. So an addon inherits the app's light/dark theme for free — but only if
it uses the tokens. **Hardcoded hex colours are the thing to avoid**: they are
what breaks dark mode, and they're what this page originally had.

**Trap 1 — do NOT `import "@wealthfolio/ui/styles"`, despite the README.** The
package's `exports` map declares `./styles` -> `./dist/styles.css`, but **that
file is not in the published package** — the import fails the build. This is
consistent with the mechanism above: the host owns the CSS, so an addon must
import components and never styles.

**Trap 2 — `@wealthfolio/ui` MUST be `external` in the Vite config.** It is in
the SDK's `HOST_DEPENDENCIES` (with `date-fns`, `lucide-react`, `recharts`,
`react`, `react-dom`, `@tanstack/react-query`, `@wealthfolio/addon-sdk`) — the
host provides all of them at runtime and resolves the bare imports. Bundling it
instead would inline ~63 transitive dependencies (Radix, `motion`, `cmdk`,
`sonner`, `react-aria-components`) and — the real killer — a **second,
uninitialised `react-i18next` context**, which 29 of its components call
`useTranslation()` against. Externalised, our whole bundle is 19.8 kB.

## Other things worth knowing

**One bad symbol must never fail the batch.** The host's shared `QueryClient`
retries a failed query 3 times with exponential backoff. If a `queryFn` loops
over N instruments in one `Promise.all` and any single one rejects, the _entire
batch_ is retried — turning one delisted symbol into a two-minute hang and a
total page failure. Every per-instrument async call is therefore wrapped in its
own try/catch, degrading that one entry to `periodDataAvailable: false` and
leaving its siblings intact.

**Cash holdings are not `instrument == null`.** The host populates a synthetic
instrument for cash (`id: "cash:GBP"`, `symbol: "GBP"`), so filter on
`holdingType === "security"` instead. Passing a cash balance to a price-based
calculation fails, correctly but confusingly.

**`itemId` is the asset UUID, never the ticker.** Quotes are indexed by
`assets.id`, not by symbol string. Passing `"SMT"` where a UUID is expected
fails with `No data found` / `NoDataForRange` for _every_ holding — which looks
like a market-data outage rather than a key mismatch.

**A trade's `amount` is null — derive it.** `ActivityDetails.amount` is
`string | null`, and Wealthfolio leaves it **null on every BUY and SELL** (615/615
BUYs in the real DB): the cash value is implied by `quantity * unitPrice (+ fee)`.
Only cash-only activities (DIVIDEND, INTEREST, DEPOSIT) carry an explicit amount.
Reading `amount` for a trade yields £0, which silently reclassifies money paid
_in_ as investment _growth_ — CTY showed +129% instead of +2.4%. `toCalcActivity`
derives it for BUY/SELL and reads the stored value only for DIVIDEND, matching the
Python reference (`calculations.py:126`). Where the host _does_ store a sell
amount, the derived figure agrees to the penny.

**Make fixtures disagree where reality can disagree.** Four separate bugs here
were structurally invisible to the unit tests because the fakes were tidier than
production: `makeFakeHolding` set `instrument.id = symbol` (hiding the UUID/
ticker distinction); fixtures set the holding currency and the asset quote
currency to the same value (hiding the normalised/actual distinction); and
`makeFakeActivity` defaulted a trade's `amount` to `"0"` rather than the `null`
the host actually sends (hiding the bug above — every test dutifully passed an
amount in, so the null path that production _always_ takes was never exercised).
All of them only ever surfaced in the real app. **If two fields can differ in
production, give them different values in the fixture; if a field is null in
production, let it be null in the fixture** — otherwise the test proves nothing
about the very distinction it exists to protect.

**Package the zip with forward slashes.** `Compress-Archive` writes
`dist\addon.js`, which is spec-invalid; Wealthfolio cannot resolve the bundle
and the install fails with "Permission analysis failed" and _nothing in the
log_. `scripts/writeZip.mjs` exists for this reason and throws if an entry name
ever contains a backslash. Always publish via `npm run publish-addon`.

**A missing permission fails silently at runtime.** Not at install — the addon
installs, reports "successfully loaded", and then its calls are quietly denied,
visible only as `AddonPermissionDenied` in `Wealthfolio.log`. Always check the
log after installing. Current categories: `accounts`, `portfolio`, `activities`,
`quotes`, `assets`, `settings`, `currency`, `ui`. Note the exchange-rates API's
category is called **`currency`**, not `exchangeRates`. The real category list
is not in the `.d.ts` files — dump it with:

```
node -e "const p=require('./node_modules/@wealthfolio/addon-sdk/dist/permissions.js');
for (const c of p.PERMISSION_CATEGORIES) console.log(c.id, c.riskLevel, c.functions.join(','))"
```
