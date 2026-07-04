import { useMemo, useState } from "react";

import {
  BarChart,
  ChartCard,
  DonutChart,
  TrendChart,
} from "../components/charts";
import { chartPalette } from "../components/charts/chart-setup";
import {
  IdGateRecentTable,
  PiiPipelineCallout,
} from "../components/pii/pii-pipeline-callout";
import {
  RecentDetectionsTable,
  TopKeysTable,
} from "../components/tables/misc-tables";
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
import { useKeys, usePII } from "../hooks/queries";
import { useByoBanActions } from "../hooks/use-byo-ban-actions";
import { LIVE_TREND_CHART_SUBTITLE, useHistory } from "../hooks/use-history";
import {
  aggNameCount,
  DAILY_HISTORY_SUBTITLE,
  HOURLY_HISTORY_FALLBACK_SUBTITLE,
  HOURLY_HISTORY_SUBTITLE,
  hourlySeries,
  type NameCount,
  pickToday,
  RANGE_OPTIONS,
  type RangeKey,
  scalarSeries,
} from "../lib/daily-history";
import type { PIINameCount } from "../types";

function rangeLabel(range: RangeKey): string {
  return range === "today"
    ? "today"
    : `last ${range === "7d" ? "7" : "30"} days`;
}

const ENTITY_COLORS = [
  chartPalette.primary,
  chartPalette.info,
  chartPalette.warning,
  chartPalette.success,
  chartPalette.error,
];

function toNameCount(rows: PIINameCount[]): NameCount[] {
  return rows.map((r) => ({ name: r.name, count: r.count }));
}

export default function PIIPage() {
  const { data, isLoading, error, dataUpdatedAt, isFetching, refetch } =
    usePII();
  const keys = useKeys();
  const byoBanActions = useByoBanActions();
  const [range, setRange] = useState<RangeKey>("today");

  const stats = data?.stats;
  const history = stats?.daily_history;
  const hasRedis = Boolean(stats?.daily_history_available);

  const detectedPick = pickToday(
    stats?.available ? stats?.requests_with_pii : undefined,
    history,
    "requests_with_pii",
    hasRedis
  );
  const scannedPick = pickToday(
    stats?.available ? stats?.requests_scanned : undefined,
    history,
    "requests_scanned",
    hasRedis
  );
  const entitiesPick = pickToday(
    stats?.available ? stats?.entities_total : undefined,
    history,
    "entities_total",
    hasRedis
  );
  const failOpenPick = pickToday(
    stats?.available ? stats?.fail_open : undefined,
    history,
    "fail_open",
    hasRedis
  );
  const failClosedPick = pickToday(
    stats?.available ? stats?.fail_closed : undefined,
    history,
    "fail_closed",
    hasRedis
  );
  const oversizePick = pickToday(
    stats?.available ? stats?.oversize : undefined,
    history,
    "oversize",
    hasRedis
  );
  const detected = detectedPick.value;
  const idGateStats = data?.id_gate_stats;
  const idGateHistory = idGateStats?.daily_history;
  const idGateHasRedis = Boolean(idGateStats?.daily_history_available);
  const idGateBlockedPick = pickToday(
    idGateStats?.available ? idGateStats.requests_blocked : undefined,
    idGateHistory,
    "requests_blocked",
    idGateHasRedis
  );

  const detectionHistory = useHistory(stats?.available ? detected : undefined);
  const dailyDetections = useMemo(
    () => scalarSeries(history, "requests_with_pii", range),
    [history, range]
  );
  const useDailyChart = Boolean(
    hasRedis && range !== "today" && dailyDetections.available
  );
  const hourlyDetections = useMemo(
    () => hourlySeries(stats?.hourly_history, "requests_with_pii"),
    [stats?.hourly_history]
  );
  const useHourlyChart = Boolean(
    stats?.hourly_history_available &&
      range === "today" &&
      hourlyDetections.available
  );
  const idGateBlockHistory = useHistory(
    idGateStats?.available ? idGateBlockedPick.value : undefined
  );
  const idGateDailyBlocked = useMemo(
    () => scalarSeries(idGateHistory, "requests_blocked", range),
    [idGateHistory, range]
  );
  const useIDGateDailyChart = Boolean(
    idGateHasRedis && range !== "today" && idGateDailyBlocked.available
  );
  const idGateHourlyBlocked = useMemo(
    () => hourlySeries(idGateStats?.hourly_history, "requests_blocked"),
    [idGateStats?.hourly_history]
  );
  const useIDGateHourlyChart = Boolean(
    idGateStats?.hourly_history_available &&
      range === "today" &&
      idGateHourlyBlocked.available
  );

  if (isLoading) {
    return <LoadingBlock />;
  }
  if (error) {
    return (
      <ErrorAlert
        message={
          error instanceof Error ? error.message : "Failed to load PII stats"
        }
      />
    );
  }
  if (!data) {
    return null;
  }

  const scanned = scannedPick.value;
  const cleanScanned =
    scanned - failOpenPick.value - failClosedPick.value - oversizePick.value;
  const rate = cleanScanned > 0 ? detected / cleanScanned : 0;
  const recent = stats?.recent ?? [];
  const idGateRecent = idGateStats?.recent ?? [];
  const idGateRecentSource: DataSource =
    idGateStats?.recent_backend === "redis" ? "redis" : "memory";
  const recentSource: DataSource =
    stats?.recent_backend === "redis" ? "redis" : "memory";
  const failures = failOpenPick.value + failClosedPick.value;

  // Prefer fleet-wide Redis rollups whenever Redis is available — including
  // "today" — since in-process memory only reflects this one pod and undercounts
  // on a multi-pod fleet. Fall back to memory only when Redis isn't wired up.
  const memEntity = toNameCount(stats?.by_entity ?? []);
  const useRedisBreakdown = hasRedis || range !== "today";
  const breakdownSource: DataSource = useRedisBreakdown ? "redis" : "memory";
  const byEntity = useRedisBreakdown
    ? aggNameCount(history, range, "by_entity")
    : memEntity;
  const byProvider = useRedisBreakdown
    ? aggNameCount(history, range, "by_provider")
    : toNameCount(stats?.by_provider ?? []);
  const topKeys = useRedisBreakdown
    ? aggNameCount(history, range, "top_keys")
    : toNameCount(stats?.top_keys ?? []);
  const entitiesRangeTotal = byEntity.reduce((sum, e) => sum + e.count, 0);
  const idGateUseRedisBreakdown = idGateHasRedis || range !== "today";
  const idGateBreakdownSource: DataSource = idGateUseRedisBreakdown
    ? "redis"
    : "memory";
  const idGateByEntity = idGateUseRedisBreakdown
    ? aggNameCount(idGateHistory, range, "by_entity")
    : toNameCount(idGateStats?.by_entity ?? []);
  const idGateByProvider = idGateUseRedisBreakdown
    ? aggNameCount(idGateHistory, range, "by_provider")
    : toNameCount(idGateStats?.by_provider ?? []);
  const idGateEntitiesRangeTotal = idGateByEntity.reduce(
    (sum, e) => sum + e.count,
    0
  );

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
        description="Live detection stats from the Presidio redaction pipeline. Metadata only — no raw PII is stored."
        title="PII Redaction"
      />

      {data.enabled ? null : (
        <div className="alert">
          <span>
            PII redaction is globally disabled
            {data.allow_per_key_override ? " (per-key override allowed)." : "."}
          </span>
        </div>
      )}

      {stats?.available ? null : (
        <div className="alert alert-info">
          <span>
            Stats collection is inactive — the redaction middleware is not
            installed. Enable
            <code className="mx-1">features.pii_redact</code>to begin recording
            detections.
          </span>
        </div>
      )}

      <PiiPipelineCallout
        idGateEnabled={data.id_gate_enabled}
        idGateFailMode={data.id_gate_fail_mode}
        piiEnabled={data.enabled}
        piiFailMode={data.fail_mode}
        wirePlaceholders={data.wire_placeholders}
      />

      <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <LiveStat
          hint={
            data.allow_per_key_override ? "per-key override on" : "global only"
          }
          source="config"
          title="Fail mode"
          value={<span className="capitalize">{data.fail_mode}</span>}
        />
        <LiveStat
          hint="today UTC"
          source={scannedPick.source}
          title="Requests scanned"
          value={scanned.toLocaleString()}
        />
        <LiveStat
          hint={`${(rate * 100).toFixed(1)}% detection rate`}
          source={detectedPick.source}
          title="With PII"
          value={detected.toLocaleString()}
        />
        <LiveStat
          hint={`${failures} failures · ${oversizePick.value} oversize`}
          source={entitiesPick.source}
          title="Entities redacted"
          value={entitiesPick.value.toLocaleString()}
        />
        <LiveStat
          hint="image ID blocks today UTC"
          source={idGateBlockedPick.source}
          title="ID gate 422s"
          value={idGateBlockedPick.value.toLocaleString()}
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
            title="PII detections over time"
          >
            {useDailyChart ? (
              <BarChart
                colors={dailyDetections.labels.map(() =>
                  chartPalette.warning()
                )}
                label="Requests with PII"
                labels={dailyDetections.labels}
                values={dailyDetections.values}
              />
            ) : useHourlyChart ? (
              <BarChart
                colors={hourlyDetections.labels.map(() =>
                  chartPalette.warning()
                )}
                label="Hourly PII detections"
                labels={hourlyDetections.labels}
                values={hourlyDetections.values}
              />
            ) : (
              <TrendChart
                color={chartPalette.warning()}
                label="Requests with PII"
                points={detectionHistory}
              />
            )}
          </ChartCard>
        </div>
        <ChartCard
          source={breakdownSource}
          subtitle={`Share of redacted entities · ${rangeLabel(range)}`}
          title="Entity types"
        >
          <DonutChart
            centerLabel="entities"
            centerValue={entitiesRangeTotal.toLocaleString()}
            colors={byEntity.map((_, i) =>
              ENTITY_COLORS[i % ENTITY_COLORS.length]()
            )}
            labels={byEntity.map((e) => e.name.replaceAll("_", " "))}
            values={byEntity.map((e) => e.count)}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          source={breakdownSource}
          subtitle={`Count by Presidio entity · ${rangeLabel(range)}`}
          title="Top entity types"
        >
          <BarChart
            colors={byEntity.map(() => chartPalette.primary())}
            horizontal
            label="Detections"
            labels={byEntity.map((e) => e.name.replaceAll("_", " "))}
            values={byEntity.map((e) => e.count)}
          />
        </ChartCard>
        <ChartCard
          source={breakdownSource}
          subtitle={`Scanned requests per provider · ${rangeLabel(range)}`}
          title="By provider"
        >
          <BarChart
            colors={byProvider.map(() => chartPalette.info())}
            label="Requests"
            labels={byProvider.map((p) => p.name)}
            values={byProvider.map((p) => p.count)}
          />
        </ChartCard>
      </div>

      {data.id_gate_enabled ? (
        <>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <ChartCard
                source={trendChartSource(
                  useIDGateDailyChart || useIDGateHourlyChart
                )}
                subtitle={
                  useIDGateDailyChart
                    ? DAILY_HISTORY_SUBTITLE
                    : useIDGateHourlyChart
                      ? HOURLY_HISTORY_SUBTITLE
                      : range === "today" && idGateHasRedis
                        ? HOURLY_HISTORY_FALLBACK_SUBTITLE
                        : LIVE_TREND_CHART_SUBTITLE
                }
                title="ID gate 422s over time"
              >
                {useIDGateDailyChart ? (
                  <BarChart
                    colors={idGateDailyBlocked.labels.map(() =>
                      chartPalette.error()
                    )}
                    label="ID gate 422s"
                    labels={idGateDailyBlocked.labels}
                    values={idGateDailyBlocked.values}
                  />
                ) : useIDGateHourlyChart ? (
                  <BarChart
                    colors={idGateHourlyBlocked.labels.map(() =>
                      chartPalette.error()
                    )}
                    label="Hourly ID gate 422s"
                    labels={idGateHourlyBlocked.labels}
                    values={idGateHourlyBlocked.values}
                  />
                ) : (
                  <TrendChart
                    color={chartPalette.error()}
                    label="ID gate 422s"
                    points={idGateBlockHistory}
                  />
                )}
              </ChartCard>
            </div>
            <ChartCard
              source={idGateBreakdownSource}
              subtitle={`Share of blocked image IDs · ${rangeLabel(range)}`}
              title="ID gate document types"
            >
              <DonutChart
                centerLabel="blocks"
                centerValue={idGateEntitiesRangeTotal.toLocaleString()}
                colors={idGateByEntity.map((_, i) =>
                  ENTITY_COLORS[i % ENTITY_COLORS.length]()
                )}
                labels={idGateByEntity.map((e) => e.name.replaceAll("_", " "))}
                values={idGateByEntity.map((e) => e.count)}
              />
            </ChartCard>
          </div>

          <ChartCard
            source={idGateBreakdownSource}
            subtitle={`Blocked image-ID requests per provider · ${rangeLabel(range)}`}
            title="ID gate by provider"
          >
            <BarChart
              colors={idGateByProvider.map(() => chartPalette.error())}
              label="ID gate 422s"
              labels={idGateByProvider.map((p) => p.name)}
              values={idGateByProvider.map((p) => p.count)}
            />
          </ChartCard>
        </>
      ) : null}

      {topKeys.length > 0 ? (
        <SectionPanel
          source={breakdownSource}
          subtitle={
            useRedisBreakdown
              ? `Summed Redis rollups · ${rangeLabel(range)}`
              : "Top 10 by detection count (today, live)"
          }
          title="Top keys"
        >
          <TopKeysTable
            byoBanActions={byoBanActions}
            keys={keys.data ?? []}
            rows={topKeys}
          />
        </SectionPanel>
      ) : null}

      <SectionPanel
        source={recentSource}
        subtitle={
          recentSource === "redis"
            ? `Last ${recent.length} Presidio body scans fleet-wide. ID-gate image blocks appear below.`
            : `Last ${recent.length} Presidio body scans on this pod. ID-gate image blocks appear below.`
        }
        title="Recent text redaction scans"
      >
        <RecentDetectionsTable
          byoBanActions={byoBanActions}
          keys={keys.data ?? []}
          rows={recent}
          wirePlaceholders={data.wire_placeholders}
        />
      </SectionPanel>

      {data.id_gate_enabled ? (
        <SectionPanel
          source={idGateRecentSource}
          subtitle={
            idGateRecentSource === "redis"
              ? `Last ${idGateRecent.length} embedded-image OCR scans fleet-wide`
              : `Last ${idGateRecent.length} embedded-image OCR scans on this pod`
          }
          title="Recent ID gate (images)"
        >
          <IdGateRecentTable
            byoBanActions={byoBanActions}
            keys={keys.data ?? []}
            rows={idGateRecent}
          />
        </SectionPanel>
      ) : null}
    </div>
  );
}
