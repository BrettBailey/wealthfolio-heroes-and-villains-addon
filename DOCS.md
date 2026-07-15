# Heroes & Villains — how it works

A Wealthfolio addon that answers one question: **my portfolio moved — which
holdings drove it?**

That question is surprisingly hard to answer from a normal holdings screen. A
daily mover list is too short a window to explain a month's drift, and a
total-returns report mixes a decade of history into today's number. This page
shows the biggest gains and losses _over a period you choose_ — 1M, 3M, 6M, and
so on — so a move you noticed last week can be traced to the holdings that
actually caused it.

---

## Contents

1. [What you see on the page](#what-you-see-on-the-page)
2. [The two percentages](#the-two-percentages-twr-and-mwr)
3. [Worked examples from real data](#worked-examples)
4. [Two theoretical cases](#two-theoretical-cases)
5. [How the calculations are performed](#how-the-calculations-are-performed)
6. [Currency handling](#currency-handling)
7. [Permissions, and why each is needed](#permissions)
8. [Known limits](#known-limits)

---

## What you see on the page

Two columns — **Heroes** (biggest gains) and **Villains** (biggest losses) —
each showing up to **seven** holdings. Each row looks like:

```
SMT   Scottish Mortgage        +£17,458   +6.2%  ⓘ
```

- **The cash figure** is what the columns are ranked by.
- **The pill** is the money-weighted return — what your money made (see below).
- **The ⓘ** opens the full working: start value, buys, sells, dividends, end
  value, and both percentages (labelled **MWR** and **TWR**).

Below the columns, a totals bar sums **every** holding that moved — not just the
ones listed above — so the net change reconciles with your portfolio.

### Why ranking is always by cash, with no toggle

An earlier version had a "rank by cash / rank by %" toggle. It was removed
deliberately.

The page exists to explain a _portfolio_ move, and that is inherently a cash
question. £17k from SMT moved the portfolio; a 39% gain on a £3.6k speculative
position did not. Worse, a percentage ranking is systematically dominated by
whichever holdings are **small enough to swing wildly** — a £200 punt that
doubles outranks a £50k holding that made thousands, every time. It isn't
measuring what moved; it's measuring what was small.

The percentages are still shown, per row, where they inform without distorting
the order.

### Why seven, not five

Five rows are dominated by the large core positions (SMT, L&G, the index funds),
leaving smaller speculative holdings permanently invisible. Seven gives them a
chance to surface without turning the page into a full holdings table.

> **Note:** if what you actually want is to _keep an eye on a specific set_ of
> speculative holdings, this page is the wrong tool — a top-seven list only shows
> them when they're extreme, which is precisely when you least need telling. That
> job wants a watchlist, which is a separate feature.

---

## The two percentages: TWR and MWR

Every holding gets two returns. They answer different questions, and **neither is
more correct than the other**.

|                          | Shown as            | Answers                            |
| ------------------------ | ------------------- | ---------------------------------- |
| **Time-weighted (TWR)**  | the pill on the row | _How did the holding perform?_     |
| **Money-weighted (MWR)** | in the ⓘ card       | _What did my money actually make?_ |

**TWR** chains together the daily price moves for the days you held the position.
It deliberately ignores **how much** you had in and **when** you put it in — so it
measures the investment, not your funding of it. This is the conventional way to
judge a pick.

**MWR** (called the _simple return_ in the code) divides the cash you made by the
money you actually had at work: `cash / (value at start + what you bought)`. It
therefore _does_ reflect your timing, and the price you got filled at.

**They are identical whenever no money moved during the period.** SMT, held
throughout with no buys or sells, is +6.2% on both. They only diverge when you
bought or sold mid-period — and the gap between them _is_ the effect of that
buying and selling.

### Why the pill shows MWR and not TWR

The pill is the **money-weighted** return, and TWR lives in the (i) card.

The deciding reason is that MWR is the percentage that _agrees with the cash figure
sitting next to it_. Both are computed from the same flows, so a positive cash
return always carries a positive pill. TWR can flatly contradict the cash — Tesla
in 2026 made **+£3,043** while its TWR was **−11.6%**, because the holding fell but
a well-timed trade more than covered it. A row reading `+£3,043` beside a red
`−11.6%` reads as a bug, and prompts you to go and check the arithmetic. (It did.)

TWR still earns its place, because it answers the question cash can't — _was the
pick itself any good?_ — but it needs its workings visible to make sense, so it
sits in the (i) alongside the numbers it was derived from.

**Nothing is ever ranked on either percentage.** Both ignore position size, so
ranking on them would put a £20 punt that doubled above a £50k holding that made
thousands. They inform; they never order.

---

## Worked examples

All figures below are real, replayed through the shipped calculation code against
the actual database, for the 3-month window ending 2026-07-14 (ASTS uses the 6M
window).

### SMT — the boring case where both agree

|                           |              |
| ------------------------- | ------------ |
| Value at start            | £283,064     |
| Bought / Sold / Dividends | £0           |
| Value at end              | £300,522     |
| **Cash return**           | **+£17,458** |
| Time-weighted             | **+6.2%**    |
| Money-weighted            | **+6.2%**    |

No money moved, so there is no timing to account for, and the two figures are
identical. **This is the proof that TWR and MWR only differ because of cash
flows** — nothing else.

### CTY — a mid-period top-up, and the timing paid off

|                 |             |
| --------------- | ----------- |
| Value at start  | £30,626     |
| Bought          | +£37,847    |
| Dividends       | +£304       |
| Value at end    | £69,845     |
| **Cash return** | **+£1,676** |
| Time-weighted   | **0.0%**    |
| Money-weighted  | **+2.4%**   |

The holding itself went **nowhere** — 0.0% TWR. But you more than doubled your
position mid-period, and the money you added did well enough (plus £304 of
dividends) to produce a real £1,676 gain.

**Read it as:** _the stock was flat; my top-up was well-timed._ Neither number
alone tells you that. Together they do.

### SPCX — bought and sold entirely within the window

|                 |               |
| --------------- | ------------- |
| Value at start  | £0 (not held) |
| Bought          | +£3,632       |
| Sold            | −£5,066       |
| Value at end    | £0 (closed)   |
| **Cash return** | **+£1,434**   |
| Time-weighted   | **+17.1%**    |
| Money-weighted  | **+39.5%**    |

A position opened _and_ closed inside the period. It never had a starting value,
so MWR's denominator is just the £3,632 you put in — giving a flattering +39.5%.
TWR, chaining the daily moves over the days you actually held it, says the stock
did +17.1%.

**Read it as:** _the stock rose 17%; I made 39% on my money by getting in and out
well._ Closed positions still appear on the page — they moved during the period,
and leaving them out would understate the totals.

### ASTS (6M window) — where the fill price shows up

|                            |               |
| -------------------------- | ------------- |
| Value at start             | £0 (not held) |
| Bought (90 shares, 14 May) | +£5,091       |
| Value at end               | £4,677        |
| **Cash return**            | **−£413**     |
| Time-weighted              | **−16.2%**    |
| Money-weighted             | **−8.1%**     |

You bought once, on 14 May, and are down £413. So why do the two percentages
differ by 8 points, when there was only one purchase and no sales?

**Because of the price you were filled at.**

- You paid **£56.57** per share.
- The closing price _that day_ was **£61.99**.
- Today's close is **£51.97**.

TWR is a **close-to-close** measure: £61.99 → £51.97 is **−16.2%**. MWR uses what
you _actually paid_: £56.57 → £51.97 is **−8.1%**. You got filled about 9% below
that day's close, and MWR is the only one of the two that knows it.

**Read it as:** _the stock fell 16% while I held it, but I bought it well, so I'm
only down 8%._

> **A subtlety worth knowing.** ASTS's price history in the database only starts
> **23 March**, though the 6M window opens 14 January. This does not affect the
> figures — you didn't own the stock until May, and TWR only chains days on which
> you held a position — but it does mean a "6-month TWR" on a recently-bought
> holding is really "the TWR since you bought it." That is the correct behaviour;
> it just isn't what the window label implies.

### TSLA (YTD) — a hero in cash, a villain in TWR

The case that justifies the whole design. YTD 2026, 61 shares held throughout:

|                            |             |
| -------------------------- | ----------- |
| Value at start (61 shares) | £20,370     |
| Bought (80 shares, 9 Apr)  | +£20,550    |
| Sold (80 shares, 11 May)   | −£25,897    |
| Value at end (61 shares)   | £18,066     |
| **Cash return**            | **+£3,043** |
| Money-weighted (the pill)  | **+7.4%**   |
| Time-weighted (in the (i)) | **−11.6%**  |

Tesla's share price **fell** over 2026 — that's the −11.6%, and it cost the
long-held position about £2,300. But the buy-the-dip, sell-the-peak trade in
April/May made roughly £5,350, which more than covered it. Net: **+£3,043 in your
pocket.**

So: is Tesla a hero or a villain this year? **It made you three grand — it's a
hero,** and it is ranked as one. The negative TWR is not a contradiction, it is the
other half of the story: _the holding did badly, but you traded it well._ Ranking
on TWR would have filed a £3,000 profit under Villains.

> This example is also the one that exposed the splits bug, since Tesla is the only
> holding that has ever split. Before the fix, these figures read £4,629.74 and
> +17.21%.

---

## Two theoretical cases

These two examples are the clearest way to feel the difference. Neither is from
real data.

### Case 1: the stock that ran away before you bought it

A stock is **£20** at the start of the period. You buy at **£80**. Today it's
**£100**.

You made **£20**, which is **+25%** on the £80 you paid. Both TWR and MWR agree,
because you only bought once and held. **The £20 starting price is irrelevant** —
you never owned it at £20, so neither figure counts it against you. TWR chains
only the days you actually held the position.

This is the case that reassures you the maths isn't doing anything perverse.

### Case 2: the winner you piled into just before it fell

This is the one that matters, and the one that shows why cash must be the ranking.

1. You buy **£1,000** of something.
2. It **doubles** to £2,000. _(+100%)_
3. Delighted, you add **£10,000**. You now have £12,000 in.
4. It falls **25%**, to £9,000.

|                  |                                     |
| ---------------- | ----------------------------------- |
| Total you put in | £11,000                             |
| What it's worth  | £9,000                              |
| **Cash return**  | **−£2,000**                         |
| Time-weighted    | **+50%** (chain of +100% then −25%) |
| Money-weighted   | **≈ −18%**                          |

**Both are true.** The stock genuinely rose 50% while you owned it. You genuinely
lost £2,000, because your big money arrived just in time for the fall.

Now ask: **is this a hero?** It has the portfolio's best TWR. It also lost you two
thousand pounds. If the page ranked on TWR, this would sit at the top of the
Heroes column while your account was down — which is exactly the outcome ranking
on cash prevents. It appears, correctly, as a **Villain** with a **+50% pill**,
which is the whole story in one row.

---

## How the calculations are performed

The maths mirrors `entry_period_stats` in the original Python report
(`python-reference/`), which this addon was ported from.

### The window

A period like `3M` resolves to `startDate`/`endDate`. The **opening snapshot is
taken the day _before_ `startDate`**, so the period `(startDate - 1, endDate]`
includes activity on `startDate` itself as an in-period flow rather than as
opening balance.

### Step 1 — value the position at each boundary

`stateOn(holding, date)` walks the activity list in date order, accumulating
units (BUY adds, SELL subtracts, **SPLIT multiplies**) and reducing cost basis
proportionally on a sell. It then finds the closing price on that date — or the
most recent close within the previous 30 days, since the boundary may be a
weekend or holiday — and returns `units × close` as the market value.

If no close price can be found at all, the market value is `null` rather than
zero: the difference between "worth nothing" and "we don't know what it's worth"
matters, and only the former should count as a loss.

### Step 2 — collect the cash flows

`periodFlows` sums, over the days strictly inside the window:

- **buys** — cash paid in, including fees
- **sells** — cash received, net of fees
- **dividends** — cash received

**Splits are deliberately absent from this list**, because a split moves no money.
See below.

### Splits

A stock split changes how many shares you hold without changing what they are
worth, and it is the one activity that alters a position's size for free.

Wealthfolio records it as an activity with `activityType: "SPLIT"`, and stores the
**ratio in the `amount` field** (`5` for a 5-for-1). That field is otherwise a cash
value, which makes splits a trap in two directions:

- Treat `amount` as cash, and you invent £5 of income from nowhere.
- Derive the amount the usual way (`quantity × unitPrice`), and you get **zero** —
  because a split row carries no quantity and no price — which would wipe the
  position out entirely.

So a split is passed through untouched, contributes nothing to the flows, and
simply multiplies the running unit count.

The reason units _must_ be scaled is that **price history is already
split-adjusted** by the data provider: the close drops by the ratio on the split
date. If units don't rise to match, the position appears to lose value for free.

This was a real bug, fixed on 2026-07-14. The addon ignored `SPLIT` entirely, so a
2020 purchase of 3 Tesla shares — which became 45 after the 5-for-1 in 2020 and the
3-for-1 in 2022 — was still counted as **3 shares**, under-counting that holding
_fifteenfold_. It valued the January 2026 position at £6,345 instead of £20,370.

The instructive part is how it hid: the reported cash return (£4,629.74) looked
entirely plausible, because the error largely cancels between the start and end
market values. Only the percentage was obviously strange (+17.21%, against a true
+7.44%). A wrong number that looks right is worse than one that looks wrong.

### Step 3 — the cash return

```
cash return = (value at end − value at start) − (buys − sells) + dividends
```

Money you _put in_ isn't profit, so it's subtracted out. Dividends are cash you
received and are added. This is the figure the page ranks on, and it is a
**total return** — dividends included.

### Step 4 — the money-weighted return

```
MWR = cash return ÷ (value at start + buys)
```

The denominator is the money you had at work. Note it counts a pound invested on
the _last_ day of the period the same as one invested on the _first_ — that is
what "money-weighted" means, and it is why this figure reflects your timing.

### Step 5 — the time-weighted return

`twr()` walks the window day by day. For each day it computes the position's
value at yesterday's close and at today's close, and the net cash flow that
occurred today (buys positive, sells and dividends negative). It then chains the
daily growth factors:

```
chain ×= (value today − today's flow) ÷ (value yesterday)
```

Subtracting the flow before dividing is what removes the effect of your own
money: a £10,000 purchase increases today's value by £10,000, and taking it back
out means the ratio reflects only the _price_ move.

**Days on which you held nothing are skipped** (the `value yesterday > 0` guard),
which is why a holding bought mid-window is never charged for what the price did
before you owned it.

The final return is `chain − 1`. It is `null` when there are no quotes in the
window — again, "unknown" rather than "zero".

### A note on units

**Every return in this codebase is a fraction, not a percentage.** `0.226` means
+22.6%. This is because the host's `GainPercent` component formats via
`Intl.NumberFormat({ style: "percent" })`, which multiplies by 100 itself. An
earlier version returned pre-scaled percentages and rendered every figure 100×
too large (a −54.9% loss appeared as −5,493%).

---

## Currency handling

Two separate conversions are needed, and confusing them produces figures that are
wrong by a factor of 100.

**Pence (`GBp`).** London stocks are frequently _quoted in pence_ while your
broker records the _trades in pounds_. CTY's quotes sit around 567 (pence) while
its buys record a unit price of 5.67 (pounds). Since the maths subtracts activity
cash flows from quote-derived market values, mixing the two scales silently
inflates everything 100×.

The addon reads the **asset profile's `quoteCcy`**, not the holding's
`instrument.currency` — the latter reports a normalised `GBP` for pence-quoted
stocks, so a `GBp` check against it never fires. Quotes are divided by 100;
activities are left alone.

**Foreign currency.** A USD-quoted holding's prices are converted using the FX
rate **on each quote's own date**, not today's rate, so a long window doesn't
conflate currency movement with price movement. The rate series comes from the
`USD/GBP`-style FX asset in the database. Activities are again left alone —
they're already recorded in GBP by the broker.

If a foreign holding has no reachable FX history, it is **excluded from the
ranking** and listed in a note beneath the page, rather than being shown with a
silently wrong figure.

---

## Permissions

Each permission is requested for one specific reason. The addon reads data; it
never writes.

| Permission                  | Risk     | Why it's needed                                                                                                                                                                                                                                                                                                                                         |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`accounts.getAll`**       | low      | Populate the account filter, so you can include or exclude accounts from the ranking.                                                                                                                                                                                                                                                                   |
| **`portfolio.getHoldings`** | low      | Read what you currently hold in each account. This is the starting point for the ranking.                                                                                                                                                                                                                                                               |
| **`activities.getAll`**     | **high** | Read your buy/sell/dividend history. **This is unavoidable**: without knowing what you bought and sold _during_ the period, there is no way to separate money you _added_ from money you _made_. A holding worth £10k more than it was could have grown, or you could simply have bought £10k more of it. Only the activity history distinguishes them. |
| **`quotes.getHistory`**     | low      | Read historical prices, to value each holding on the period's opening and closing dates, and to chain the daily moves for TWR.                                                                                                                                                                                                                          |
| **`assets.getProfile`**     | low      | Read each instrument's true quote currency (`quoteCcy`). This is what tells us a stock is priced in pence rather than pounds — without it, pence-quoted holdings are wrong by 100×.                                                                                                                                                                     |
| **`settings.get`**          | medium   | Read your portfolio's base currency, so returns can be reported in one consistent currency.                                                                                                                                                                                                                                                             |
| **`currency.getAll`**       | low      | Find the exchange-rate pair for each foreign currency held, so foreign holdings can be converted at each day's historical rate.                                                                                                                                                                                                                         |

**`activities.getAll` is the one worth pausing on**, since it's classed high-risk
and it is genuinely your full trading history. It is used solely to compute cash
flows within the selected window. Nothing is transmitted anywhere — the addon has
no network permission, and all computation happens locally in the page.

---

## Known limits

- **Re-entry gaps.** If you sell a position out entirely and later buy back in,
  TWR chains across the gap where you held nothing. Rare, and debatable rather
  than wrong, but worth knowing.
- **TWR windows can be shorter than they look.** For a holding bought recently,
  or one whose price history in the database is short, the TWR covers only the
  days it could — not the full period named on the toggle. MWR is unaffected.
- **The totals bar excludes** any holding that couldn't be valued (typically a
  foreign currency with no FX history). The count is stated on the page so the
  number is never silently incomplete.
- **`RankingEntry.totalGainPct`** is the _host's_ all-time figure. Its unit is
  unverified, and it is neither displayed nor ranked on. Check its convention
  before ever using it.
- **Splits are applied, but lots are not tracked.** `stateOn` keeps a single
  running unit count and a single pooled cost basis; it does not model individual
  tax lots or FIFO disposal the way the host's `lots` table does. Unit counts and
  market values agree with the host, which is what the returns depend on — but
  don't read `costBasis` as a tax figure.
- **Reverse splits are handled in principle, but untested.** `REVERSE_SPLIT` is a
  _subtype_ of `SPLIT` in the SDK, not a separate activity type, so it already
  flows through the same code path — provided the host records the ratio as a
  fraction (`0.1` for a 1-for-10). If it instead stores `10` and relies on the
  subtype to signal the direction, units would be multiplied instead of divided.
  No holding has ever reverse-split, so this has never been exercised; check the
  `amount` before trusting it.
