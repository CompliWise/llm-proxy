import { useMemo, useState } from "react";
import {
  BarChart,
  ChartCard,
  DonutChart,
  GroupedBarChart,
  TrendChart,
} from "../components/charts";
import { chartPalette } from "../components/charts/chart-setup";
import {
  LimitSpendTable,
  RecentCostTable,
  TransportsTable,
} from "../components/cost/extra-tables";
import SpendByKeyTable from "../components/cost/spend-by-key-table";
import SpendByProviderTable from "../components/cost/spend-by-provider-table";
import SpendByUserTable from "../components/cost/spend-by-user-table";
import {
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
import { useCost, useKeys } from "../hooks/queries";
import { useByoBanActions } from "../hooks/use-byo-ban-actions";
import { LIVE_TREND_CHART_SUBTITLE, useHistory } from "../hooks/use-history";
import {
  aggCostByKey,
  aggCostByProvider,
  aggCostByUser,
  type CostKeyAgg,
  type CostUserAgg,
  DAILY_HISTORY_SUBTITLE,
  HOURLY_HISTORY_FALLBACK_SUBTITLE,
  HOURLY_HISTORY_SUBTITLE,
  hourlySeries,
  pickToday,
  RANGE_OPTIONS,
  type RangeKey,
  scalarSeries,
} from "../lib/daily-history";
import {
  compact,
  formatCount,
  formatUsd,
  keySpendCapCents,
  maskKeyId,
  scopeLabel,
} from "../lib/format";
import { donutSlices } from "../lib/group-rows";
import type { CostKeySpend, CostScopeSpend } from "../types";

function rangeLabel(range: RangeKey): string {
  return range === "today"
    ? "today"
    : `last ${range === "7d" ? "7" : "30"} days`;
}

function memKeyAgg(byKey: CostKeySpend[]): CostKeyAgg[] {
  return byKey.map((row) => ({
    key_id: row.key_id ?? "",
    spend_usd: row.spend_usd,
    input_spend_usd: row.input_spend_usd ?? 0,
    output_spend_usd: row.output_spend_usd ?? 0,
    requests: row.requests,
    input_tokens: row.input_tokens,
    output_tokens: row.output_tokens,
  }));
}

function memUserAgg(
  byUser: Record<string, CostScopeSpend> | undefined
): CostUserAgg[] {
  return Object.entries(byUser ?? {})
    .map(([scope, row]) => ({
      scope,
      label: scopeLabel(scope),
      spend_usd: row.spend_usd,
      input_spend_usd: row.input_spend_usd ?? 0,
      output_spend_usd: row.output_spend_usd ?? 0,
      requests: row.requests,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
    }))
    .sort((a, b) => b.spend_usd - a.spend_usd);
}

const SPEND_COLORS = [
  chartPalette.primary,
  chartPalette.info,
  chartPalette.success,
  chartPalette.warning,
  chartPalette.error,
];

export default function CostPage() {
  const { data, isLoading, error, dataUpdatedAt, isFetching, refetch } =
    useCost();
  const keys = useKeys();
  const byoBanActions = useByoBanActions();
  const [range, setRange] = useState<RangeKey>("today");

  const stats = data?.stats;
  const history = stats?.daily_history;
  const hasRedis = Boolean(stats?.daily_history_available);

  const spendToday = pickToday(
    stats?.available ? stats?.spend_today_usd : undefined,
    history,
    "spend_today_usd",
    hasRedis
  );
  const requestsToday = pickToday(
    stats?.available ? stats?.requests_today : undefined,
    history,
    "requests_today",
    hasRedis
  );
  const inputSpendToday = pickToday(
    stats?.available ? stats?.input_spend_today_usd : undefined,
    history,
    "input_spend_today_usd",
    hasRedis
  );
  const outputSpendToday = pickToday(
    stats?.available ? stats?.output_spend_today_usd : undefined,
    history,
    "output_spend_today_usd",
    hasRedis
  );
  const inputTokensToday = pickToday(
    stats?.available ? stats?.input_tokens_today : undefined,
    history,
    "input_tokens_today",
    hasRedis
  );
  const outputTokensToday = pickToday(
    stats?.available ? stats?.output_tokens_today : undefined,
    history,
    "output_tokens_today",
    hasRedis
  );
  const tokensSource: DataSource =
    inputTokensToday.source === "memory" &&
    outputTokensToday.source === "memory"
      ? "memory"
      : hasRedis
        ? "redislive"
        : "memory";

  const spendHistory = useHistory(
    stats?.available ? spendToday.value : undefined
  );
  const dailySpend = useMemo(
    () => scalarSeries(history, "spend_today_usd", range),
    [history, range]
  );
  const useDailyChart = Boolean(
    hasRedis && range !== "today" && dailySpend.available
  );
  const hourlySpend = useMemo(
    () => hourlySeries(stats?.hourly_history, "spend_today_usd"),
    [stats?.hourly_history]
  );
  const useHourlyChart = Boolean(
    stats?.hourly_history_available &&
      range === "today" &&
      hourlySpend.available
  );

  if (isLoading) {
    return <LoadingBlock />;
  }
  if (error) {
    return (
      <ErrorAlert
        message={
          error instanceof Error
            ? error.message
            : "Failed to load cost tracking"
        }
      />
    );
  }
  if (!data) {
    return null;
  }

  const transports = data.transports ?? [];
  const keyList = keys.data ?? [];
  const byKey = stats?.by_key ?? [];
  const recent = stats?.recent ?? [];
  const withLimits = keyList.filter((k) => keySpendCapCents(k) > 0);

  // Prefer fleet-wide Redis rollups whenever Redis is available — including
  // "today" — since in-process memory only reflects this one pod and undercounts
  // on a multi-pod fleet. Fall back to memory only when Redis isn't wired up.
  const useRedisBreakdown = hasRedis || range !== "today";
  const memKeys = memKeyAgg(byKey);
  const rangeByKey: CostKeyAgg[] = useRedisBreakdown
    ? aggCostByKey(history, range)
    : memKeys;
  const memUsers = memUserAgg(stats?.by_user);
  const rangeByUser: CostUserAgg[] = useRedisBreakdown
    ? aggCostByUser(history, range, scopeLabel)
    : memUsers;
  const breakdownSource: DataSource = useRedisBreakdown ? "redis" : "memory";
  const withSpend = rangeByKey.filter((row) => row.spend_usd > 0);
  const withUserSpend = rangeByUser.filter((row) => row.spend_usd > 0);
  const rangeSpendTotal = withSpend.reduce(
    (sum, row) => sum + row.spend_usd,
    0
  );
  const donutData = donutSlices(
    withSpend.map((row) => {
      const record = keyList.find((k) => maskKeyId(k.key) === row.key_id);
      return record?.description?.trim() || row.key_id || "unknown";
    }),
    withSpend.map((row) => row.spend_usd),
    withSpend.map((_, i) => SPEND_COLORS[i % SPEND_COLORS.length]()),
    8,
    chartPalette.tick()
  );

  const memProviders = stats?.by_provider ?? [];
  const rangeByProvider = useRedisBreakdown
    ? aggCostByProvider(history, range)
    : memProviders.map((p) => ({
        name: p.name,
        spend_usd: p.spend_usd,
        requests: p.requests,
      }));
  const withProviderSpend = rangeByProvider.filter((row) => row.spend_usd > 0);

  const todayByKey = hasRedis
    ? aggCostByKey(history, "today")
    : memKeyAgg(byKey);

  const limitRows = keyList
    .map((key) => {
      const masked = maskKeyId(key.key);
      const entry = todayByKey.find((row) => row.key_id === masked);
      return {
        id: key.key,
        label: key.description || masked,
        key,
        spendUsd: entry?.spend_usd ?? 0,
        limitUsd: keySpendCapCents(key) / 100,
        requests: entry?.requests ?? 0,
      };
    })
    .filter((row) => row.limitUsd > 0 || row.spendUsd > 0)
    .sort((a, b) => b.spendUsd - a.spendUsd || b.limitUsd - a.limitUsd);

  const limitChartRows = limitRows
    .filter((row) => row.limitUsd > 0)
    .slice(0, 8);

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
              fetching={isFetching}
              onRefresh={() => refetch()}
              updatedAt={dataUpdatedAt}
            />
          </div>
        }
        description="Live spend rollup (since last restart, UTC calendar day) plus pipeline configuration and per-key limits."
        title="Cost Tracking"
      />

      {data.enabled ? null : (
        <div className="alert">
          <span>Cost tracking is disabled.</span>
        </div>
      )}

      {stats?.available ? null : (
        <div className="alert alert-info">
          <span>
            Live spend stats are inactive — enable{" "}
            <code className="mx-1">features.cost_tracking</code> and restart the
            proxy.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <LiveStat
          hint={`${formatUsd(inputSpendToday.value)} in · ${formatUsd(outputSpendToday.value)} out`}
          source={spendToday.source}
          title="Spend today"
          value={formatUsd(spendToday.value)}
        />
        <LiveStat
          hint="tracked today"
          source={requestsToday.source}
          title="Requests"
          value={formatCount(requestsToday.value)}
        />
        <LiveStat
          hint={`${compact(inputTokensToday.value)} in · ${compact(outputTokensToday.value)} out`}
          source={tokensSource}
          title="Tokens"
          value={compact(inputTokensToday.value + outputTokensToday.value)}
        />
        <LiveStat
          hint={`${transports.length} transport${transports.length === 1 ? "" : "s"} · ${withLimits.length} keys w/ limits`}
          source="config"
          title="Pipeline"
          value={data.async ? "Async" : "Sync"}
          valueClassName="text-lg"
        />
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
                  : range === "today" && hasRedis
                    ? HOURLY_HISTORY_FALLBACK_SUBTITLE
                    : LIVE_TREND_CHART_SUBTITLE
            }
            title="Spend over time"
          >
            {useDailyChart ? (
              <BarChart
                colors={dailySpend.labels.map(() => chartPalette.primary())}
                label="Daily spend (USD)"
                labels={dailySpend.labels}
                values={dailySpend.values}
              />
            ) : useHourlyChart ? (
              <BarChart
                colors={hourlySpend.labels.map(() => chartPalette.primary())}
                label="Hourly spend (USD)"
                labels={hourlySpend.labels}
                values={hourlySpend.values}
              />
            ) : (
              <TrendChart
                color={chartPalette.primary()}
                label="Spend today (USD)"
                points={spendHistory}
              />
            )}
          </ChartCard>
        </div>
        <ChartCard
          source={breakdownSource}
          subtitle={`Share of ${rangeLabel(range)}'s spend`}
          title="Spend by key"
        >
          <DonutChart
            centerLabel={rangeLabel(range)}
            centerValue={formatUsd(rangeSpendTotal)}
            colors={donutData.colors}
            labels={donutData.labels}
            values={donutData.values}
          />
        </ChartCard>
      </div>

      {withSpend.length > 0 ||
      withUserSpend.length > 0 ||
      withProviderSpend.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {withUserSpend.length > 0 ? (
            <SectionPanel
              source={breakdownSource}
              subtitle={
                range === "today"
                  ? `Client user rollup for ${stats?.day ?? "today"}`
                  : `Summed Redis rollups · ${rangeLabel(range)}`
              }
              title="Spend by user"
            >
              <SpendByUserTable rows={withUserSpend} />
            </SectionPanel>
          ) : null}
          {withSpend.length > 0 ? (
            <SectionPanel
              source={breakdownSource}
              subtitle={
                range === "today"
                  ? `API key rollup for ${stats?.day ?? "today"}`
                  : `Summed Redis rollups · ${rangeLabel(range)}`
              }
              title="Spend by key"
            >
              <SpendByKeyTable
                byoBanActions={byoBanActions}
                keys={keyList}
                rows={withSpend}
              />
            </SectionPanel>
          ) : null}
          {withProviderSpend.length > 0 ? (
            <SectionPanel
              source={breakdownSource}
              subtitle={`Tracked spend · ${rangeLabel(range)}`}
              title="Spend by provider"
            >
              <SpendByProviderTable rows={withProviderSpend} />
            </SectionPanel>
          ) : null}
        </div>
      ) : null}

      <ChartCard
        source={breakdownSource}
        subtitle="Spend is today's rollup; caps from key config (DynamoDB)"
        title="Spend vs limit"
      >
        <GroupedBarChart
          height={Math.max(220, limitChartRows.length * 36)}
          horizontal
          labels={limitChartRows.map(
            (row) => row.key.description || maskKeyId(row.key.key)
          )}
          series={[
            {
              label: "Spend today",
              values: limitChartRows.map((row) => row.spendUsd),
              color: chartPalette.primary,
            },
            {
              label: "Spend cap",
              values: limitChartRows.map((row) => row.limitUsd),
              color: chartPalette.info,
            },
          ]}
        />
      </ChartCard>

      <SectionPanel source="config" title="Async pipeline">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Workers" value={data.workers} />
          <Field label="Queue size" value={data.queue_size} />
          <Field
            label="Flush interval"
            value={data.flush_interval ? `${data.flush_interval}s` : undefined}
          />
          <Field
            label="Transports"
            value={data.transport_count ?? transports.length}
          />
        </div>
      </SectionPanel>

      <SectionPanel
        source={breakdownSource}
        subtitle="Spend is today's rollup; caps are stored on the key (DynamoDB)"
        title="Per-key spend vs limit"
      >
        <LimitSpendTable keys={keyList} rows={limitRows} />
      </SectionPanel>

      {recent.length > 0 ? (
        <SectionPanel
          source="memory"
          subtitle="Last 50 events — not written to Redis"
          title="Recent tracked requests"
        >
          <RecentCostTable keys={keyList} rows={recent} />
        </SectionPanel>
      ) : null}

      <SectionPanel
        source="config"
        subtitle="Cost audit pipeline (file / DynamoDB / Datadog)"
        title="Configured transports"
      >
        <TransportsTable transports={transports} />
      </SectionPanel>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div>
      <p className="text-base-content/50 text-xs uppercase tracking-wide">
        {label}
      </p>
      <p className="font-medium text-lg">{value ?? "—"}</p>
    </div>
  );
}
