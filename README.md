# Heroes & Villains

A [Wealthfolio](https://github.com/wealthfolio/wealthfolio) addon that answers a
simple, fun question: **which of your holdings actually drove your portfolio's
move?**

Pick a period — a day, a quarter, the year so far, five years — and the addon
ranks your **heroes** (biggest gains) and **villains** (biggest losses) in cold
hard cash, across every account. It's the "who won and who lost this quarter"
leaderboard for your own portfolio.

Every figure is a **total return with dividends included**, and it works for
holdings quoted in pounds, pence, or foreign currency (see
[Currency support](#currency-support)).

---

## What it shows

- **Heroes and villains, by cash.** The default ranking is by cash change (£),
  because "what drove my portfolio" is fundamentally a cash question — a small
  percentage move on a large position matters more than a huge percentage move
  on a tiny one. Heroes are the top gainers, villains the top losers, each
  capped at five. The split is by **sign**, not by position: an all-green period
  legitimately has no villains.
- **Two return percentages side by side.** A money-weighted simple return as the
  headline figure, with a time-weighted return (TWR) available alongside — they
  answer different questions, so the addon shows both rather than picking one.
- **A totals bar.** Gains, losses, and net change summed over *every* holding
  that moved in the period — not just the ten shown on screen. Cash only
  (percentages don't sum). Holdings that couldn't be valued are reported as a
  count rather than silently counted as zero.
- **Closed positions count too.** A stock you bought *and* sold within the
  period still moved your portfolio during it, so it's included and flagged as
  closed.

---

## Dividends are included

This is the single most load-bearing property of the addon, so it's worth
stating plainly: **the cash figures, the percentages, and the TWR are all
dividend-inclusive total return.**

- Dividend activity in the period is summed alongside buys and sells.
- The cash return is `growth + dividends`, where
  `growth = (marketValueEnd − marketValueStart) − (buys − sells)`.
- The percentage divides that same dividend-inclusive number by the money
  invested, so dividends are in the percentage too.
- The TWR treats each dividend as a cash outflow when chaining daily returns, so
  it's total-return as well, not price-only.

This is also *why* the addon computes returns itself rather than leaning on
Wealthfolio's built-in per-symbol performance API — that API is price-only for a
bare symbol and explicitly excludes dividends. See
[How the calculations work](#how-the-calculations-work).

---

## Currency support

Works with GBP, pence-quoted (GBp), and foreign-currency holdings — **provided
each security is configured correctly in Wealthfolio**, because the addon trusts
the security's declared quote currency as the single source of truth.

- **Pounds (`GBP`)** — used as-is.
- **Pence (`GBp`)** — Wealthfolio (following Yahoo) quotes some UK instruments in
  pence, flagged by the exact code `GBp` (lowercase `p`). The addon divides those
  quotes by 100. It reads the quote currency from the **asset profile**
  (`Asset.quoteCcy`), not the holding — the holding's currency field is
  normalised and always reads `GBP`, even for pence-quoted stocks.
- **Foreign currency (e.g. `USD`)** — converted to your base currency at **each
  day's historical FX rate**, walking back to the most recent prior rate over
  weekends and holidays. Using today's rate for a historical day would conflate
  currency movement with price movement, which is exactly the error this addon
  exists to avoid.

**The declared quote currency is the source of truth — the addon never guesses
from the price magnitude.** Real portfolios hold genuine `GBP` funds priced at
£100+/unit right next to `GBp` equities priced in the hundreds of pence, so any
"that number looks too big to be pounds" heuristic would corrupt exactly those
funds. If a security is mislabelled, the fix belongs in Wealthfolio, not in a
guess here.

---

## How the calculations work

For a selected period and set of accounts, each figure is built like this:

1. **Discover what to rank.** Read current holdings per account and merge by
   symbol, so a stock held in two accounts becomes one entry. Then scan activity
   history for instruments *traded within the period* that are no longer held,
   and add those as closed entries.
2. **Resolve each instrument's true quote currency** from its asset profile
   (`Asset.quoteCcy`) — see [Currency support](#currency-support).
3. **Load the raw material** — buy/sell/dividend history per account, and
   historical price quotes per instrument. Neither call is date-filtered by the
   host, so the period window is applied on our side.
4. **Normalise every quote to base currency** — pence → pounds, then FX at each
   quote's own date. Activities are deliberately left alone (see the note below).
5. **Compute the period figures.** Take a market-value snapshot the day before
   the period starts and one at the end, total the cash flows in between, then:

   ```
   growth          = (marketValueEnd − marketValueStart) − (buys − sells)
   totalReturnCash = growth + dividends
   simplePercent   = totalReturnCash / (marketValueStart + buys) × 100
   ```

   plus a daily-chained time-weighted return.
6. **Rank.** Positive entries best-first, negative entries worst-first, each
   capped at five.
7. **Total.** Sum the period cash return over every entry into gains / losses /
   net change.

### Why the addon computes returns itself

The obvious approach — asking Wealthfolio's `performance` API for a per-symbol,
period-scoped return — cannot do the job, and it's worth recording why so nobody
re-treads it:

- A bare symbol has **no cash-flow context**, so the API returns a null cash
  amount and a **price-only** percentage that excludes dividends. For a dividend
  payer, the numbers come out too low.
- There is **no per-symbol breakdown** anywhere in the performance API; the
  account-level result is whole-account aggregate only.
- `Holding`'s built-in gain figures *are* real, dividend-inclusive cash — but
  they're **all-time**, not period-scoped, so they can't answer "what moved this
  quarter", which is the whole point.

Getting a period-scoped, dividend-inclusive, per-symbol cash return therefore
*requires* activity-level cash-flow maths — which is what this addon does.

### One deliberate asymmetry: convert quotes, not activities

Some brokers record activities in `GBP` even for `GBp`-quoted instruments (a
pence-quoted stock's quote sits around 567 while its buy records a unit price of
5.67). Because the period maths subtracts activity cash flows from quote-derived
market values, the two scales must be reconciled — and the fix is to scale the
**quotes**, never the activities. Likewise, foreign-instrument activities are
already recorded in base currency, so they need no FX conversion. Normalising
both sides would reintroduce the same 100× error from the other direction.

---

## Permissions, and why each is needed

Wealthfolio addons declare exactly which host APIs they use, and the user
approves them on install. Every permission here maps to a specific step above:

| Permission               | Why it's needed                                                                                                            |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `accounts.getAll`        | List accounts so you can filter which ones are included in the ranking.                                                     |
| `portfolio.getHoldings`  | Read current holdings per account — the starting point for the ranking.                                                    |
| `activities.getAll`      | Read buy/sell/**dividend** history per account, to compute real period-scoped cash and percentage returns.                 |
| `quotes.getHistory`      | Read historical price quotes per holding, to value each position at the start and end of the selected period.              |
| `assets.getProfile`      | Read each holding's true quote currency, so `GBp` prices are converted to pounds instead of being read as 100× their value.|
| `settings.get`           | Read the portfolio's base currency, to determine which holdings can be given real period-scoped figures.                   |
| `currency.getAll`        | Find the FX pair for each foreign currency held, so foreign holdings can be converted at each day's historical rate.       |

There's no `logger` permission because logging goes straight to Wealthfolio's
log file and needs no declared entry.

---

## Development

Requires Wealthfolio **3.6.2** or later (`sdkVersion` / `minWealthfolioVersion`
in `manifest.json`).

```bash
npm install          # or pnpm install

npm run dev          # vite build --watch
npm run build        # production build → dist/addon.js
npm run test         # vitest
npm run lint         # eslint + tsc --noEmit
npm run publish-addon  # build + lint + test + package the installable zip
```

The calculation core lives in `src/calculations/` and `src/ranking/` and is
covered by unit tests. `python-reference/` holds the original Python scripts this
addon was ported from — they're the reference spec for the calculation
semantics, not something this project runs.

See [`PLAN.md`](./PLAN.md) for the full architecture, the milestone history, and
detailed implementation notes — including the dead ends and the currency traps in
much more depth than this README.
