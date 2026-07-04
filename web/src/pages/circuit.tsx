import { useMemo, useState } from "react";

import {
  BarChart,
  ChartCard,
  GroupedBarChart,
  TrendChart,
} from "../components/charts";
import { chartPalette } from "../components/charts/chart-setup";
import {
  BlockedByKeyTable,
  CircuitActivityTable,
  CircuitProvidersTable,
} from "../components/tables/misc-tables";
import {
  circuitLiveSource,
  type DataSource,
  LiveStat,
  RangeToggle,
  SectionPanel,
  trendChartSource,
} from "../components/ui/data-source";
import PageHeader, {
  ErrorAlert,
  LiveIndicator,
  LoadingBlock,
} from "../components/ui/page-header";
import { useCircuitActivity, useHealth } from "../hooks/queries";
import { LIVE_TREND_CHART_SUBTITLE, useHistory } from "../hooks/use-history";
import {
  aggCircuitActivity,
  aggCircuitBlockedByKey,
  aggCircuitProviders,
  circuitProviderSeries,
  DAILY_HISTORY_SUBTITLE,
  HOURLY_HISTORY_FALLBACK_SUBTITLE,
  HOURLY_HISTORY_SUBTITLE,
  hourlySeries,
  maxScalarField,
  pickToday,
  RANGE_OPTIONS,
  type RangeKey,
  rangeStartUnix,
  scalarSeries,
} from "../lib/daily-history";
import {
  isBreakerKeyCurrentlyOpen,
  parseBreakerKey,
  scopeKind,
} from "../lib/format";
import type { DailyHistoryRow } from "../types";

const PROVIDER_SERIES_COLORS = [
  chartPalette.error,
  chartPalette.warning,
  chartPalette.info,
  chartPalette.primary,
  chartPalette.success,
];

function stateColor(state: string): string {
  if (state === "open") {
    return chartPalette.error();
  }
  if (state === "half-open" || state === "half_open") {
    return chartPalette.warning();
  }
  return chartPalette.success();
}

function rangeLabel(range: RangeKey): string {
  return range === "today"
    ? "today"
    : `last ${range === "7d" ? "7" : "30"} days`;
}

function eventLabel(kind: string): string {
  switch (kind) {
    case "probe":
      return "Recovery probe";
    case "probe_closed":
      return "Closed (recovered)";
    case "probe_reopened":
      return "Re-opened";
    case "fast_fail":
      return "Blocked (open)";
    case "opened":
      return "Tripped open";
    default:
      return kind;
  }
}

function formatEventTime(unix: number): string {
  return new Date(unix * 1000).toLocaleString();
}

function activityFieldPick(
  range: RangeKey,
  field: keyof ReturnType<typeof aggCircuitActivity>,
  live: number | undefined,
  history: DailyHistoryRow[] | undefined,
  hasRedis: boolean
) {
  if (range === "today") {
    return pickToday(live, history, field, hasRedis);
  }
  if (hasRedis && history?.length) {
    return {
      value: aggCircuitActivity(history, range)[field],
      source: "redis" as const,
    };
  }
  return { value: live ?? 0, source: "memory" as const };
}

export default function CircuitPage() {
  const { data, isLoading, error, dataUpdatedAt, isFetching, refetch } =
    useHealth();
  const activityQuery = useCircuitActivity();
  const [range, setRange] = useState<RangeKey>("today");

  const activity = activityQuery.data;
  const allRecentEvents = activity?.recent_events ?? [];

  const providers = data?.circuit_breaker?.providers ?? {};
  const names = Object.keys(providers);
  const cb = data?.circuit_breaker;
  const failureHistory = cb?.daily_history;
  const hasFailureRedis = Boolean(cb?.daily_history_available);

  const activityHistory = activity?.daily_history;
  const hasActivityRedis = Boolean(activity?.daily_history_available);

  const liveTotalFailures =
    cb?.total_failures ??
    Object.values(providers).reduce((s, p) => s + (p.failures ?? 0), 0);

  const totalFailures =
    range === "today"
      ? liveTotalFailures
      : hasFailureRedis
        ? maxScalarField(failureHistory, range, "total_failures")
        : liveTotalFailures;

  const failureStatSource: DataSource =
    range === "today"
      ? circuitLiveSource(cb?.backend)
      : hasFailureRedis
        ? "redis"
        : "memory";

  const failureStatHint =
    range === "today"
      ? "Current 120s window"
      : `Peak daily window · ${rangeLabel(range)}`;

  const providerFailurePeaks = useMemo(() => {
    const map = new Map<string, number>();
    if (range !== "today" && hasFailureRedis) {
      for (const row of aggCircuitProviders(failureHistory, range)) {
        map.set(row.name, row.count);
      }
    }
    return map;
  }, [range, hasFailureRedis, failureHistory]);

  const providerFailureValues = names.map((n) =>
    range === "today" || !hasFailureRedis
      ? (providers[n].failures ?? 0)
      : (providerFailurePeaks.get(n) ?? 0)
  );

  const failureHistoryTrend = useHistory(
    range === "today" ? liveTotalFailures : undefined
  );
  const dailyFailures = useMemo(
    () => scalarSeries(failureHistory, "total_failures", range),
    [failureHistory, range]
  );
  const useDailyFailureChart = Boolean(
    hasFailureRedis && range !== "today" && dailyFailures.available
  );
  const hourlyFailures = useMemo(
    () => hourlySeries(cb?.hourly_history, "total_failures"),
    [cb?.hourly_history]
  );
  const useHourlyFailureChart = Boolean(
    cb?.hourly_history_available &&
      range === "today" &&
      hourlyFailures.available
  );

  const providerSeries = useMemo(
    () => circuitProviderSeries(failureHistory, range),
    [failureHistory, range]
  );
  const showProviderHistory =
    hasFailureRedis && range !== "today" && providerSeries.providers.length > 0;

  const checksPick = activityFieldPick(
    range,
    "checks_total",
    activity?.checks_total,
    activityHistory,
    hasActivityRedis
  );
  const blockedPick = activityFieldPick(
    range,
    "blocked_open",
    activity?.blocked_open,
    activityHistory,
    hasActivityRedis
  );
  const probesPick = activityFieldPick(
    range,
    "probes_started",
    activity?.probes_started,
    activityHistory,
    hasActivityRedis
  );
  const probesOkPick = activityFieldPick(
    range,
    "probes_succeeded",
    activity?.probes_succeeded,
    activityHistory,
    hasActivityRedis
  );
  const probesFailPick = activityFieldPick(
    range,
    "probes_failed",
    activity?.probes_failed,
    activityHistory,
    hasActivityRedis
  );

  const dailyChecks = useMemo(
    () => scalarSeries(activityHistory, "checks_total", range),
    [activityHistory, range]
  );
  const useDailyActivityChart = Boolean(
    hasActivityRedis && range !== "today" && dailyChecks.available
  );

  const activitySource: DataSource =
    range === "today"
      ? circuitLiveSource(activity?.backend ?? cb?.backend)
      : hasActivityRedis
        ? "redis"
        : "memory";

  const activityHint =
    range === "today"
      ? activity?.backend === "redis"
        ? "Fleet total · UTC day"
        : "Since process start"
      : `Summed UTC days · ${rangeLabel(range)}`;

  const recentEvents = useMemo(() => {
    if (range === "today") {
      return allRecentEvents;
    }
    const cutoff = rangeStartUnix(range);
    return allRecentEvents.filter((e) => e.time >= cutoff);
  }, [allRecentEvents, range]);

  const openModelKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const name of names) {
      for (const key of providers[name]?.rollup?.open_keys ?? []) {
        keys.add(key);
      }
    }
    return [...keys].sort();
  }, [names, providers]);

  const openKeySet = useMemo(() => new Set(openModelKeys), [openModelKeys]);

  // Break the "Blocked (open)" volume down by breaker key (provider:model)
  // rather than rolling it up under the bare provider. A per-model breaker
  // (e.g. gemini:gemini-2.5-flash-lite) tripping should not read as "all of
  // Gemini is down" — this surfaces exactly which model keys are blocked.
  const blockedByKey = useMemo(() => {
    const fromAggregates =
      range === "today"
        ? activity?.by_key
        : hasActivityRedis
          ? Object.fromEntries(
              aggCircuitBlockedByKey(activityHistory, range).map((r) => [
                r.name,
                r.count,
              ])
            )
          : activity?.by_key;

    const enrich = (entries: [string, number][]) =>
      entries
        .map(([label, count]) => ({
          label,
          count,
          currentlyOpen: isBreakerKeyCurrentlyOpen(
            label,
            providers,
            openKeySet
          ),
        }))
        .sort((a, b) => {
          if (a.currentlyOpen !== b.currentlyOpen) {
            return a.currentlyOpen ? -1 : 1;
          }
          return b.count - a.count;
        })
        .slice(0, 10);

    if (fromAggregates && Object.keys(fromAggregates).length > 0) {
      return enrich(Object.entries(fromAggregates));
    }

    // Fallback for deployments that predate by_key aggregation.
    const counts = new Map<string, number>();
    for (const e of recentEvents) {
      if (e.kind !== "fast_fail") {
        continue;
      }
      const key = e.key ?? e.provider;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return enrich([...counts.entries()]);
  }, [
    range,
    activity?.by_key,
    hasActivityRedis,
    activityHistory,
    recentEvents,
    providers,
    openKeySet,
  ]);

  const refetchAll = () => {
    refetch();
    activityQuery.refetch();
  };

  if (isLoading) {
    return <LoadingBlock />;
  }
  if (error) {
    return (
      <ErrorAlert
        message={
          error instanceof Error
            ? error.message
            : "Failed to load circuit breaker"
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <div className="flex items-center gap-3">
            <RangeToggle
              onChange={setRange}
              options={RANGE_OPTIONS}
              value={range}
            />
            <LiveIndicator
              fetching={isFetching || activityQuery.isFetching}
              onRefresh={refetchAll}
              updatedAt={Math.max(dataUpdatedAt, activityQuery.dataUpdatedAt)}
            />
          </div>
        }
        description="Per-provider failure tracking and trip state."
        title="Circuit Breaker"
      />

      {cb?.enabled ? null : (
        <div className="alert">
          <span>Circuit breaker is disabled.</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <LiveStat
          source="config"
          title="Enabled"
          value={cb?.enabled ? "Yes" : "No"}
        />
        <LiveStat
          source="config"
          title="Mode"
          value={cb?.mode ?? "—"}
          valueClassName="text-lg"
        />
        <LiveStat
          hint="Live breaker state store"
          source={circuitLiveSource(cb?.backend)}
          title="Backend"
          value={
            <>
              {cb?.backend ?? "—"}
              {cb?.redis_fallback ? " (fallback)" : ""}
            </>
          }
          valueClassName="text-lg"
        />
        <LiveStat
          hint={failureStatHint}
          source={failureStatSource}
          title="Total failures"
          value={totalFailures}
        />
      </div>

      {activity?.available ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <LiveStat
            hint={activityHint}
            source={activitySource}
            title="State checks"
            value={checksPick.value}
          />
          <LiveStat
            source={activitySource}
            title="Blocked (open)"
            value={blockedPick.value}
          />
          <LiveStat
            hint={range === "today" ? "After cooldown" : undefined}
            source={activitySource}
            title="Recovery probes"
            value={probesPick.value}
          />
          <LiveStat
            hint={range === "today" ? "Circuit closed" : undefined}
            source={activitySource}
            title="Probes succeeded"
            value={probesOkPick.value}
            valueClassName="text-success"
          />
          <LiveStat
            hint={range === "today" ? "Circuit re-opened" : undefined}
            source={activitySource}
            title="Probes failed"
            value={probesFailPick.value}
            valueClassName="text-error"
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          source={trendChartSource(
            useDailyFailureChart || useHourlyFailureChart
          )}
          subtitle={
            useDailyFailureChart
              ? DAILY_HISTORY_SUBTITLE
              : useHourlyFailureChart
                ? HOURLY_HISTORY_SUBTITLE
                : range === "today" &&
                    (hasFailureRedis || cb?.backend === "redis")
                  ? HOURLY_HISTORY_FALLBACK_SUBTITLE
                  : LIVE_TREND_CHART_SUBTITLE
          }
          title="Failure trend"
        >
          {useDailyFailureChart ? (
            <BarChart
              colors={dailyFailures.labels.map(() => chartPalette.error())}
              label="Daily peak failures"
              labels={dailyFailures.labels}
              values={dailyFailures.values}
            />
          ) : useHourlyFailureChart ? (
            <BarChart
              colors={hourlyFailures.labels.map(() => chartPalette.error())}
              label="Hourly peak failures"
              labels={hourlyFailures.labels}
              values={hourlyFailures.values}
            />
          ) : (
            <TrendChart
              color={chartPalette.error()}
              label="Failures"
              points={failureHistoryTrend}
            />
          )}
        </ChartCard>
        <ChartCard
          source={failureStatSource}
          subtitle={
            range === "today"
              ? "Current 120s window"
              : `Peak daily window · ${rangeLabel(range)} · ${DAILY_HISTORY_SUBTITLE}`
          }
          title="Failures by provider"
        >
          <BarChart
            colors={names.map((n) =>
              stateColor(providers[n].state ?? "closed")
            )}
            horizontal
            label="Failures"
            labels={names}
            values={providerFailureValues}
          />
        </ChartCard>
      </div>

      {showProviderHistory ? (
        <ChartCard
          source="redis"
          subtitle={`Daily peak failures (rolling window) · ${rangeLabel(range)} · ${DAILY_HISTORY_SUBTITLE}`}
          title="Failures by provider over time"
        >
          <GroupedBarChart
            height={260}
            labels={providerSeries.labels}
            series={providerSeries.providers.map((name, i) => ({
              label: name,
              values: providerSeries.valuesByProvider[name],
              color: PROVIDER_SERIES_COLORS[i % PROVIDER_SERIES_COLORS.length],
            }))}
            stacked
          />
        </ChartCard>
      ) : null}

      {activity?.available && useDailyActivityChart ? (
        <ChartCard
          source="redis"
          subtitle={`Daily UTC totals · ${rangeLabel(range)} · ${DAILY_HISTORY_SUBTITLE}`}
          title="State checks"
        >
          <BarChart
            colors={dailyChecks.labels.map(() => chartPalette.primary())}
            label="Checks"
            labels={dailyChecks.labels}
            values={dailyChecks.values}
          />
        </ChartCard>
      ) : null}

      <SectionPanel
        source={
          range === "today" ? circuitLiveSource(cb?.backend) : failureStatSource
        }
        subtitle={
          range === "today"
            ? "Live trip state and current-window failure counts"
            : `Live trip state · peak daily failures · ${rangeLabel(range)}`
        }
        title="Providers"
      >
        <CircuitProvidersTable
          hasFailureRedis={hasFailureRedis}
          names={names}
          providerFailurePeaks={providerFailurePeaks}
          providers={providers}
          range={range}
        />
      </SectionPanel>

      {activity?.available ? (
        <SectionPanel
          source={activitySource}
          subtitle={`Daily blocked totals per breaker key · ${rangeLabel(range)} · recovered keys are closed and no longer blocking`}
          title="Blocked by model"
        >
          <BlockedByKeyTable rows={blockedByKey} />
          {openModelKeys.length > 0 ? (
            <div className="border-base-300 border-t px-5 py-4">
              <p className="mb-2 font-medium text-base-content/70 text-xs">
                Models in rollup window (currently degraded)
              </p>
              <div className="flex flex-wrap gap-2">
                {openModelKeys.map((key) => {
                  const { model, scope } = parseBreakerKey(key, scopeKind(key));
                  return (
                    <span
                      className="badge badge-outline font-mono text-xs"
                      key={key}
                    >
                      {scope === "model" ? model : key}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
        </SectionPanel>
      ) : null}

      {activity?.available ? (
        <SectionPanel
          source={activitySource}
          subtitle={
            range === "today"
              ? "Half-open probes after cooldown windows end (shared when Redis-backed)"
              : `Events since ${rangeLabel(range)} · ring buffer may truncate older entries`
          }
          title="Recovery activity"
        >
          <CircuitActivityTable
            eventLabel={eventLabel}
            events={recentEvents}
            formatEventTime={formatEventTime}
            parseBreakerKey={parseBreakerKey}
          />
        </SectionPanel>
      ) : null}
    </div>
  );
}
