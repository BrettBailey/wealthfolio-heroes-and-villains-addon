import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AddonContext } from "@wealthfolio/addon-sdk";
import {
  AnimatedToggleGroup,
  Badge,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  cn,
  GainAmount,
  GainPercent,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
  Icons,
  Label,
  Page,
  PageContent,
  PageHeader,
  Separator,
  Skeleton,
  TickerAvatar,
} from "@wealthfolio/ui";
import { today } from "../calculations/dates";
import { DEFAULT_PERIOD_KEY, PERIOD_KEYS, periodDateRange, type PeriodKey } from "../periods";
import { buildRankingEntries } from "../ranking/buildRankingEntries";
import { periodTotals, type PeriodTotals } from "../ranking/periodTotals";
import { rankEntries } from "../ranking/rankEntries";
import { type PeriodBreakdown, type RankingEntry, type RankMode } from "../ranking/types";
import {
  ACCOUNT_FILTER_KEY,
  PERIOD_KEY,
  parseAccountFilter,
  parsePeriodKey,
  serializeAccountFilter,
} from "../storage/codecs";
import { usePersistentState } from "../storage/usePersistentState";

/**
 * Seven, not five: the point of this page is to spot which holdings drove a
 * portfolio move, and a five-deep list is dominated by the large core positions
 * (SMT, L&G, the index funds), leaving the smaller speculative holdings
 * permanently invisible. Seven gives them a chance to surface without turning
 * the page into a full holdings table.
 */
const TOP_COUNT = 7;

/**
 * Both columns rank on **cash**, always — there is no rank-mode toggle.
 *
 * This page exists to answer one question: "my portfolio moved; which holdings
 * drove it?" That is inherently a cash question. A percentage ranking answers a
 * different one ("which of my picks performed best?") and answers it badly at
 * these position sizes: it is dominated by whichever holdings are small enough
 * to swing wildly, so a £200 punt doubling outranks a £50k holding that made
 * thousands. The percentages are shown per row instead, where they inform
 * without distorting the ordering.
 */
const RANK_MODE: RankMode = "gain-cash";

export interface HeroesAndVillainsPageProps {
  ctx: AddonContext;
}

export function HeroesAndVillainsPage({ ctx }: HeroesAndVillainsPageProps) {
  const storage = ctx.api.storage;

  const [periodKey, setPeriodKey, periodState] = usePersistentState<PeriodKey>(
    storage,
    PERIOD_KEY,
    DEFAULT_PERIOD_KEY,
    (key) => key,
    parsePeriodKey,
  );

  const accountsQuery = useQuery({
    queryKey: ["heroes-villains", "accounts"],
    queryFn: () => ctx.api.accounts.getAll(),
  });

  const [selectedAccountIds, setSelectedAccountIds] = useAccountFilter(storage, accountsQuery.data);

  const settingsQuery = useQuery({
    queryKey: ["heroes-villains", "settings"],
    queryFn: () => ctx.api.settings.get(),
  });

  const baseCurrency = settingsQuery.data?.baseCurrency ?? "GBP";

  const activeAccounts = useMemo(() => {
    const accounts = accountsQuery.data ?? [];
    if (selectedAccountIds === null) {
      return accounts.filter((account) => account.isActive && !account.isArchived);
    }
    return accounts.filter((account) => selectedAccountIds.has(account.id));
  }, [accountsQuery.data, selectedAccountIds]);

  const dateRange = useMemo(() => periodDateRange(periodKey, today()), [periodKey]);

  const entriesQuery = useQuery({
    queryKey: [
      "heroes-villains",
      "entries",
      activeAccounts.map((account) => account.id),
      dateRange.startDate,
      dateRange.endDate,
    ],
    queryFn: () => buildRankingEntries(ctx.api, activeAccounts, dateRange),
    // Wait for the saved period before querying: `periodKey` is the default
    // until storage resolves, and firing on it would run the whole ranking over
    // the wrong window, then immediately run it again over the right one.
    enabled: activeAccounts.length > 0 && periodState.isLoaded,
  });

  const { heroes, villains } = useMemo(
    () => rankEntries(entriesQuery.data ?? [], RANK_MODE, TOP_COUNT),
    [entriesQuery.data],
  );

  const totals = useMemo(() => periodTotals(entriesQuery.data ?? []), [entriesQuery.data]);

  const excludedForCurrency = (entriesQuery.data ?? []).filter((entry) => !entry.periodDataAvailable);

  return (
    <Page>
      <PageHeader
        heading="Heroes &amp; Villains"
        text="Your biggest movers over the selected period, ranked by cash. Dividends are included in every figure."
      />

      <PageContent>
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-4">
            {/*
                The period is driven through `AnimatedToggleGroup` directly rather
                than through the host's `IntervalSelector`, which is a thin wrapper
                around this very component. Three reasons, none of them fixable from
                the outside:

                1. It hardcodes `bg-transparent` on the toggle group, so the pill
                   marking the selected period has no background to sit against and
                   is hard to make out. That is deliberate *for the host's* usage —
                   Wealthfolio overlays the selector on a chart, which supplies the
                   backdrop — but an addon page has nothing behind it. No prop
                   overrides it: `IntervalSelector`'s `className` lands on its outer
                   wrapper div, not on the toggle group carrying `bg-transparent`.
                2. It is uncontrolled — `defaultValue` only, no `value` — so it
                   cannot simply reflect a period restored from storage.
                3. Its `storageKey` persists via `localStorage`, which does nothing
                   in the addon's opaque-origin iframe.

                Going direct fixes all three and costs only an explicit period list.
              */}
            <AnimatedToggleGroup
              items={PERIOD_KEYS.map((key) => ({ value: key, label: key }))}
              value={periodKey}
              onValueChange={setPeriodKey}
              size="sm"
            />

            {/* Pushed to the far end; wraps to its own line when the row runs out of room. */}
            <div className="ml-auto">
              <AccountFilter
                accounts={accountsQuery.data ?? []}
                isLoading={accountsQuery.isLoading}
                selectedAccountIds={selectedAccountIds}
                onChange={setSelectedAccountIds}
              />
            </div>
          </div>

          {accountsQuery.isError && <p className="text-sm text-destructive">Failed to load accounts.</p>}
          {entriesQuery.isError && <p className="text-sm text-destructive">Failed to load holdings.</p>}

          {entriesQuery.isLoading ? (
            <MoversSkeleton />
          ) : (
            entriesQuery.data && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <MoversColumn
                    title="Heroes"
                    entries={heroes}
                    baseCurrency={baseCurrency}
                    emptyNote="No heroes this period."
                  />
                  <MoversColumn
                    title="Villains"
                    entries={villains}
                    baseCurrency={baseCurrency}
                    emptyNote="No villains this period."
                  />
                </div>

                <TotalsBar totals={totals} baseCurrency={baseCurrency} />

                {excludedForCurrency.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Excluded from the period ranking (no price or exchange-rate history covering this period):{" "}
                    {excludedForCurrency.map((entry) => entry.symbol).join(", ")}
                  </p>
                )}
              </>
            )
          )}
        </div>
      </PageContent>
    </Page>
  );
}

/**
 * The account selection, persisted across sessions.
 *
 * This can't use `usePersistentState` directly: a stored selection can only be
 * validated once the account list has loaded (accounts may have been deleted
 * since it was saved), so the read is deferred until `accounts` arrives rather
 * than running on mount.
 */
function useAccountFilter(
  storage: AddonContext["api"]["storage"],
  accounts: Array<{ id: string }> | undefined,
): [Set<string> | null, (next: Set<string> | null) => void] {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    if (accounts === undefined || isLoaded) {
      return;
    }

    let cancelled = false;
    const knownAccountIds = new Set(accounts.map((account) => account.id));

    storage
      .get(ACCOUNT_FILTER_KEY)
      .then((raw) => {
        if (!cancelled && raw !== null) {
          setSelected(parseAccountFilter(raw, knownAccountIds));
        }
      })
      .catch(() => {
        // Fall back to all active accounts.
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storage, accounts, isLoaded]);

  const update = useCallback(
    (next: Set<string> | null) => {
      setSelected(next);
      void storage.set(ACCOUNT_FILTER_KEY, serializeAccountFilter(next)).catch(() => {
        // Best-effort; the selection still applies for this session.
      });
    },
    [storage],
  );

  return [selected, update];
}

/**
 * Whole-portfolio period figures: every entry, not only the top few listed above.
 * Always cash — a sum of percentages means nothing — so this doesn't change with
 * the rank-by toggle.
 */
function TotalsBar({ totals, baseCurrency }: { totals: PeriodTotals; baseCurrency: string }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <TotalsFigure label="Total gains" value={totals.totalGains} currency={baseCurrency} />
          <Separator orientation="vertical" className="h-8" />
          <TotalsFigure label="Total losses" value={totals.totalLosses} currency={baseCurrency} />
          <Separator orientation="vertical" className="h-8" />
          <TotalsFigure label="Net change" value={totals.netChange} currency={baseCurrency} />
        </div>
        <p className="text-xs text-muted-foreground">
          {totals.excludedEntries === 0
            ? `Across all ${totals.countedEntries} holdings that moved this period, including those sold during it.`
            : `Across ${totals.countedEntries} of ${totals.countedEntries + totals.excludedEntries} holdings — ` +
              `${totals.excludedEntries} could not be valued for this period and are not in these totals.`}
        </p>
      </CardContent>
    </Card>
  );
}

function TotalsFigure({ label, value, currency }: { label: string; value: number; currency: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <GainAmount value={value} currency={currency} displayCurrency className="text-lg font-semibold" />
    </div>
  );
}

function AccountFilter({
  accounts,
  isLoading,
  selectedAccountIds,
  onChange,
}: {
  accounts: Array<{ id: string; name: string; isActive: boolean; isArchived: boolean }>;
  isLoading: boolean;
  selectedAccountIds: Set<string> | null;
  onChange: (next: Set<string> | null) => void;
}) {
  const effectiveSelection =
    selectedAccountIds ??
    new Set(accounts.filter((account) => account.isActive && !account.isArchived).map((account) => account.id));

  function toggleAccount(accountId: string) {
    const next = new Set(effectiveSelection);
    if (next.has(accountId)) {
      next.delete(accountId);
    } else {
      next.add(accountId);
    }
    onChange(next);
  }

  if (isLoading) {
    return <Skeleton className="h-8 w-64" />;
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <span className="text-xs text-muted-foreground">Accounts</span>
      {accounts.map((account) => (
        <div key={account.id} className="flex items-center gap-2">
          <Checkbox
            id={`account-${account.id}`}
            checked={effectiveSelection.has(account.id)}
            onCheckedChange={() => toggleAccount(account.id)}
          />
          <Label htmlFor={`account-${account.id}`} className="text-sm font-normal">
            {account.name}
          </Label>
        </div>
      ))}
    </div>
  );
}

function MoversColumn({
  title,
  entries,
  baseCurrency,
  emptyNote,
}: {
  title: string;
  entries: RankingEntry[];
  baseCurrency: string;
  emptyNote: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyNote}</p>
        ) : (
          <ul className="flex flex-col">
            {entries.map((entry, index) => (
              <li key={entry.symbol}>
                {index > 0 && <Separator />}
                <div className="flex items-center gap-3 py-3">
                  <TickerAvatar symbol={entry.symbol} />
                  <div className="flex min-w-0 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{entry.name}</span>
                      {entry.isClosed && (
                        <Badge variant="secondary" title="Sold during this period — no longer held">
                          closed
                        </Badge>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">{entry.symbol}</span>
                  </div>
                  <div className="ml-auto shrink-0">
                    <MoverValue entry={entry} baseCurrency={baseCurrency} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Cash leads, because cash is what the columns are ranked by — the ordering has
 * to visibly follow from what's on screen.
 *
 * The pill beside it is the **money-weighted** return: what your money actually
 * made. It is the percentage that agrees with the cash figure it sits next to —
 * both are computed from the same flows, so a positive cash return always carries
 * a positive pill. Time-weighted return can disagree with the cash (Tesla YTD:
 * +£3,580 in cash, but the holding itself fell), which is exactly why it belongs
 * in the (i) with its workings rather than bare on the row.
 */
function MoverValue({ entry, baseCurrency }: { entry: RankingEntry; baseCurrency: string }) {
  if (entry.periodReturnBase === null) {
    return <NoValue />;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <GainAmount
        value={entry.periodReturnBase}
        currency={baseCurrency}
        displayCurrency
        className="text-sm font-semibold"
      />
      {entry.periodReturn !== null && <PercentPill value={entry.periodReturn} />}
      <WorkingsPopover entry={entry} baseCurrency={baseCurrency} />
    </div>
  );
}

/**
 * The (i) beside each mover: hover or click to see how its figures were reached.
 *
 * Every number here is one `periodStats` already computed to produce the
 * headline — nothing is recalculated, and no extra data is fetched.
 *
 * `HoverCard` rather than `Tooltip` because this is a small table, not a
 * sentence: it opens on hover *and* on keyboard focus, needs no provider at the
 * app root, and is meant to hold structured content.
 */
function WorkingsPopover({ entry, baseCurrency }: { entry: RankingEntry; baseCurrency: string }) {
  const { breakdown } = entry;
  if (breakdown === null) {
    return null;
  }

  return (
    <HoverCard openDelay={100} closeDelay={100}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`How ${entry.symbol}'s return was calculated`}
          className="rounded text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Icons.InfoCircle className="h-4 w-4" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="end" className="w-72">
        <Workings entry={entry} breakdown={breakdown} baseCurrency={baseCurrency} />
      </HoverCardContent>
    </HoverCard>
  );
}

function Workings({
  entry,
  breakdown,
  baseCurrency,
}: {
  entry: RankingEntry;
  breakdown: PeriodBreakdown;
  baseCurrency: string;
}) {
  const { marketValueStart, marketValueEnd, buys, sells, dividends } = breakdown;

  // Restating the identity `periodStats` used, rather than re-deriving it: the
  // denominator is the money that was at work — what the holding was worth when
  // the period opened, plus anything bought into it since.
  const investedBase = marketValueStart + buys;

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-col gap-1">
        <span className="font-medium">How this was worked out</span>
        <span className="text-muted-foreground">Over the selected period, in {baseCurrency}.</span>
      </div>

      <dl className="flex flex-col gap-1">
        <WorkingsRow label="Value at start" value={marketValueStart} currency={baseCurrency} />
        <WorkingsRow label="Bought" value={buys} currency={baseCurrency} signed />
        <WorkingsRow label="Sold" value={-sells} currency={baseCurrency} signed />
        <WorkingsRow label="Dividends" value={dividends} currency={baseCurrency} signed />
        <WorkingsRow label="Value at end" value={marketValueEnd} currency={baseCurrency} />
      </dl>

      <Separator />

      <dl className="flex flex-col gap-1">
        <WorkingsRow label="Cash return" value={entry.periodReturnBase} currency={baseCurrency} emphasised />
        {entry.periodReturn !== null && (
          <WorkingsPercentRow
            label="MWR"
            value={entry.periodReturn}
            note={`on ${formatMoney(investedBase, baseCurrency)}`}
          />
        )}
        {entry.periodTwr !== null && (
          <WorkingsPercentRow label="TWR" value={entry.periodTwr} note="the holding itself" />
        )}
      </dl>
    </div>
  );
}

function WorkingsRow({
  label,
  value,
  currency,
  signed = false,
  emphasised = false,
}: {
  label: string;
  value: number | null;
  currency: string;
  /** Show an explicit +/- : these are the movements, not the balances. */
  signed?: boolean;
  emphasised?: boolean;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", emphasised && "font-medium")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">
        {value === null ? "–" : signed ? formatSignedMoney(value, currency) : formatMoney(value, currency)}
      </dd>
    </div>
  );
}

function WorkingsPercentRow({ label, value, note }: { label: string; value: number; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="flex flex-col">
        <span className="text-muted-foreground">{label}</span>
        <span className="text-[0.65rem] text-muted-foreground/70">{note}</span>
      </dt>
      <dd>
        <GainPercent value={value} className="text-xs" />
      </dd>
    </div>
  );
}

/**
 * Plain currency formatting for the workings, deliberately *not* `GainAmount`:
 * that colours by sign, which would paint "Bought" red as though spending money
 * were a loss. Only the cash-return line is a gain or a loss.
 */
function formatMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

/** As `formatMoney`, but always shows the sign — these rows are movements in and out. */
function formatSignedMoney(value: number, currency: string): string {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(value);
}

/**
 * `GainPercent`'s own badge variant only tints its background to 10% opacity
 * (`bg-success/10`) and hardcodes `text-sm`, so it reads as a faint wash rather
 * than a green/red pill. These overrides make it smaller and solid. They land in
 * `className`, which the component merges last via `cn()`/tailwind-merge, so
 * they win over its defaults instead of fighting them.
 *
 * Colours are the theme's success/destructive tokens, never hardcoded hex, so
 * the pill stays legible in both light and dark mode.
 *
 * `value` is a **fraction** (0.226 = +22.6%), which is what `GainPercent` wants:
 * it formats via `Intl.NumberFormat({ style: "percent" })` and scales by 100
 * itself. Every return in this addon is a fraction for exactly this reason —
 * passing a pre-scaled percentage here renders it 100x too large.
 *
 * The pill carries the *money-weighted* return (`periodReturn`). The
 * time-weighted one is in the (i) card — see `MoverValue`.
 */
function PercentPill({ value }: { value: number }) {
  const solidColour =
    value > 0
      ? "bg-success text-success-foreground"
      : value < 0
        ? "bg-destructive text-destructive-foreground"
        : "bg-muted text-muted-foreground";

  return (
    <GainPercent value={value} variant="badge" className={cn("rounded px-1.5 py-0 text-xs font-medium", solidColour)} />
  );
}

function NoValue() {
  return <span className="text-sm text-muted-foreground">–</span>;
}

function MoversSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {["heroes", "villains"].map((column) => (
        <Card key={column}>
          <CardHeader>
            <Skeleton className="h-6 w-24" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {Array.from({ length: TOP_COUNT }, (_, row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex flex-col gap-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-16" />
                </div>
                <Skeleton className="ml-auto h-5 w-20" />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
