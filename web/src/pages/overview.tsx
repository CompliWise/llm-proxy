import { useMemo } from "react";
import { Link } from "react-router-dom";

import { BarChart, ChartCard, TrendChart } from "../components/charts";
import { chartPalette } from "../components/charts/chart-setup";
import {
  circuitLiveSource,
  LiveStat,
  trendChartSource,
} from "../components/ui/data-source";
import { FeatureFlagList } from "../components/ui/feature-flag-list";
import PageHeader, {
  ErrorAlert,
  LiveIndicator,
  LoadingBlock,
  StatusBadge,
} from "../components/ui/page-header";
import {
  useConfig,
  useHealth,
  useKeys,
  useModelStatus,
  useUsage,
} from "../hooks/queries";
import { LIVE_TREND_CHART_SUBTITLE, useHistory } from "../hooks/use-history";
import {
  aggScopeMap,
  DAILY_HISTORY_SUBTITLE,
  dailyHistoryChart,
  HOURLY_HISTORY_FALLBACK_SUBTITLE,
  HOURLY_HISTORY_SUBTITLE,
  hourlySeries,
  pickToday,
} from "../lib/daily-history";
import { featureEnabled } from "../lib/features";
import { compact, scopeKind, scopeLabel } from "../lib/format";

export default function OverviewPage() {
  const health = useHealth();
  const config = useConfig();
  const usage = useUsage();
  const keys = useKeys();
  const modelStatus = useModelStatus();

  const cb = health.data?.circuit_breaker;
  const providers = cb?.providers ?? {};
  const totalFailures =
    cb?.total_failures ??
    Object.values(providers).reduce((sum, p) => sum + (p.failures ?? 0), 0);
  const failureHistory = useHistory(health.data ? totalFailures : undefined);
  const dailyFailures = useMemo(
    () => dailyHistoryChart(cb?.daily_history, "total_failures"),
    [cb?.daily_history]
  );
  const useDailyChart = Boolean(
    cb?.daily_history_available && dailyFailures.available
  );
  const hourlyFailures = useMemo(
    () => hourlySeries(cb?.hourly_history, "total_failures"),
    [cb?.hourly_history]
  );
  const useHourlyChart = Boolean(
    cb?.hourly_history_available && hourlyFailures.available
  );
  const circuitLive = circuitLiveSource(cb?.backend);

  const enabledFeatures = config.data?.features
    ? Object.values(config.data.features).filter((f) => featureEnabled(f))
        .length
    : 0;
  const totalFeatures = config.data?.features
    ? Object.keys(config.data.features).length
    : 0;

  const usageStats = usage.data?.stats;
  const usageHistory = usageStats?.daily_history;
  const usageRedis = Boolean(usageStats?.daily_history_available);
  const usageCounters = usageStats?.counters ?? {};
  const globalUsage = usageCounters.global;
  const memoryRequests = Math.max(
    usageStats?.requests_today ?? 0,
    globalUsage?.requests ?? 0
  );
  const memoryTokens = Math.max(
    usageStats?.tokens_today ?? 0,
    globalUsage?.tokens ?? 0
  );
  const requestsTodayPick = pickToday(
    usageStats?.available ? memoryRequests : undefined,
    usageHistory,
    "requests_today",
    usageRedis
  );
  const tokensTodayPick = pickToday(
    usageStats?.available ? memoryTokens : undefined,
    usageHistory,
    "tokens_today",
    usageRedis
  );
  const modelRows = (
    usageRedis
      ? aggScopeMap(usageHistory, "today", "by_model").map((s) => ({
          label: scopeLabel(s.scope),
          requests: s.requests,
        }))
      : Object.entries(usageCounters)
          .filter(([scope]) => scopeKind(scope) === "model")
          .map(([scope, c]) => ({
            label: scopeLabel(scope),
            requests: c.requests ?? 0,
          }))
  )
    .sort((a, b) => b.requests - a.requests)
    .slice(0, 6);
  const modelSource = usageRedis ? "redis" : "memory";

  const modelStatusStats = modelStatus.data?.stats;
  const modelStatusHistory = modelStatusStats?.daily_history;
  const modelStatusRedis = Boolean(modelStatusStats?.daily_history_available);
  const retiredTodayPick = pickToday(
    modelStatusStats?.available ? modelStatusStats?.retired_total : undefined,
    modelStatusHistory,
    "retired_total",
    modelStatusRedis
  );
  const unknownTodayPick = pickToday(
    modelStatusStats?.available ? modelStatusStats?.unknown_total : undefined,
    modelStatusHistory,
    "unknown_total",
    modelStatusRedis
  );

  const isLoading =
    health.isLoading ||
    config.isLoading ||
    usage.isLoading ||
    modelStatus.isLoading;
  const error =
    health.error || config.error || usage.error || modelStatus.error;

  if (isLoading) {
    return <LoadingBlock />;
  }
  if (error) {
    return (
      <ErrorAlert
        message={
          error instanceof Error ? error.message : "Failed to load overview"
        }
      />
    );
  }

  const providerNames = Object.keys(providers);
  const providerFailures = providerNames.map((n) => providers[n].failures ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <LiveIndicator
            fetching={health.isFetching}
            onRefresh={() => {
              health.refetch();
              usage.refetch();
              modelStatus.refetch();
            }}
            updatedAt={health.dataUpdatedAt}
          />
        }
        description="Live snapshot of proxy health, traffic, and configuration."
        title="Overview"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <LiveStat
          hint={
            health.data
              ? new Date(health.data.timestamp * 1000).toLocaleTimeString()
              : undefined
          }
          source="memory"
          title="Status"
          value={
            <StatusBadge
              active={health.data?.status === "healthy"}
              activeLabel="Healthy"
              inactiveLabel="Degraded"
            />
          }
        />
        <LiveStat
          hint={`${modelRows.length} active models`}
          source={requestsTodayPick.source}
          title="Requests today"
          value={compact(requestsTodayPick.value)}
        />
        <LiveStat
          hint="across all providers"
          source={tokensTodayPick.source}
          title="Tokens today"
          value={compact(tokensTodayPick.value)}
        />
        <LiveStat
          hint={`${providerNames.length} providers · ${enabledFeatures}/${totalFeatures} features on · ${keys.data?.length ?? "—"} keys`}
          source={circuitLive}
          title="Open circuits"
          value={
            Object.values(providers).filter(
              (p) => p.rollup?.open || p.state === "open"
            ).length
          }
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <LiveStat
          hint="blocked at proxy"
          source={retiredTodayPick.source}
          title="Retired calls today"
          value={retiredTodayPick.value.toLocaleString()}
        />
        <LiveStat
          hint="unregistered slugs"
          source={unknownTodayPick.source}
          title="Unknown models today"
          value={unknownTodayPick.value.toLocaleString()}
        />
        <div className="card bg-base-100 shadow-sm">
          <div className="card-body justify-center">
            <Link className="btn btn-outline btn-sm" to="/model-status">
              Model status details
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartCard
            source={trendChartSource(useDailyChart || useHourlyChart)}
            subtitle={
              useDailyChart
                ? DAILY_HISTORY_SUBTITLE
                : useHourlyChart
                  ? HOURLY_HISTORY_SUBTITLE
                  : cb?.backend === "redis" || cb?.daily_history_available
                    ? HOURLY_HISTORY_FALLBACK_SUBTITLE
                    : LIVE_TREND_CHART_SUBTITLE
            }
            title="Circuit breaker failures"
          >
            {useDailyChart ? (
              <BarChart
                colors={dailyFailures.labels.map(() => chartPalette.error())}
                label="Daily failures"
                labels={dailyFailures.labels}
                values={dailyFailures.values}
              />
            ) : useHourlyChart ? (
              <BarChart
                colors={hourlyFailures.labels.map(() => chartPalette.error())}
                label="Hourly failures"
                labels={hourlyFailures.labels}
                values={hourlyFailures.values}
              />
            ) : (
              <TrendChart
                color={chartPalette.error()}
                label="Failures"
                points={failureHistory}
              />
            )}
          </ChartCard>
        </div>
        <ChartCard
          source="config"
          subtitle="Current proxy capabilities"
          title="Feature flags"
        >
          <FeatureFlagList features={config.data?.features} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          actions={
            <Link className="btn btn-ghost btn-xs" to="/circuit">
              Details
            </Link>
          }
          source={circuitLive}
          subtitle="Current failure count"
          title="Failures by provider"
        >
          <BarChart
            colors={providerNames.map(() => chartPalette.warning())}
            label="Failures"
            labels={providerNames}
            values={providerFailures}
          />
        </ChartCard>
        <ChartCard
          actions={
            <Link className="btn btn-ghost btn-xs" to="/usage">
              Usage
            </Link>
          }
          source={modelSource}
          subtitle="Top models today"
          title="Requests by model"
        >
          <BarChart
            horizontal
            label="Requests"
            labels={modelRows.map((r) => r.label)}
            values={modelRows.map((r) => r.requests)}
          />
        </ChartCard>
      </div>
    </div>
  );
}
