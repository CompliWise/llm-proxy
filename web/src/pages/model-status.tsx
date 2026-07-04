import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { BarChart, ChartCard, TrendChart } from "../components/charts";
import { chartPalette } from "../components/charts/chart-setup";
import {
  type DataSource,
  LiveStat,
  RangeToggle,
  SectionPanel,
  trendChartSource,
} from "../components/ui/data-source";
import DataTable from "../components/ui/data-table";
import PageHeader, {
  ErrorAlert,
  LiveIndicator,
  LoadingBlock,
} from "../components/ui/page-header";
import { useModelStatus } from "../hooks/queries";
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
  sumScalarField,
} from "../lib/daily-history";
import type { ModelStatusNameCount, ModelStatusRegistryEntry } from "../types";

function rangeLabel(range: RangeKey): string {
  return range === "today"
    ? "today"
    : `last ${range === "7d" ? "7" : "30"} days`;
}

function splitScope(scope: string): { provider: string; model: string } {
  const idx = scope.indexOf(":");
  if (idx === -1) {
    return { provider: "", model: scope };
  }
  return { provider: scope.slice(0, idx), model: scope.slice(idx + 1) };
}

function toNameCount(rows: ModelStatusNameCount[] | undefined): NameCount[] {
  return (rows ?? []).map((r) => ({ name: r.name, count: r.count }));
}

function lookupRetired(
  registry: ModelStatusRegistryEntry[] | undefined,
  scope: string
): ModelStatusRegistryEntry | undefined {
  const { provider, model } = splitScope(scope);
  for (const row of registry ?? []) {
    if (row.provider !== provider) {
      continue;
    }
    if (row.model === model) {
      return row;
    }
    if (row.aliases?.includes(model)) {
      return row;
    }
  }
  return;
}

function lookupDeprecated(
  registry: ModelStatusRegistryEntry[] | undefined,
  scope: string
): ModelStatusRegistryEntry | undefined {
  const { provider, model } = splitScope(scope);
  for (const row of registry ?? []) {
    if (row.provider !== provider) {
      continue;
    }
    if (row.model === model) {
      return row;
    }
    if (row.aliases?.includes(model)) {
      return row;
    }
  }
  return;
}

interface TrafficRow {
  calls: number;
  id: string;
  model: string;
  provider: string;
  replacement?: string;
  retiredDate?: string;
}

function trafficRows(
  counts: NameCount[],
  kind: "retired" | "deprecated" | "unknown",
  registry: ModelStatusRegistryEntry[] | undefined
): TrafficRow[] {
  return counts.map((row) => {
    const { provider, model } = splitScope(row.name);
    const meta =
      kind === "retired"
        ? lookupRetired(registry, row.name)
        : kind === "deprecated"
          ? lookupDeprecated(registry, row.name)
          : undefined;
    return {
      id: row.name,
      provider,
      model,
      calls: row.count,
      replacement: meta?.replacement,
      retiredDate: meta?.retired_date,
    };
  });
}

function trafficColumns(
  showReplacement: boolean,
  showRetiredDate: boolean
): ColumnDef<TrafficRow, unknown>[] {
  const cols: ColumnDef<TrafficRow, unknown>[] = [
    {
      id: "provider",
      accessorKey: "provider",
      header: "Provider",
      cell: ({ getValue }) => (
        <span className="font-medium capitalize">{getValue<string>()}</span>
      ),
    },
    {
      id: "model",
      accessorKey: "model",
      header: "Model",
      cell: ({ getValue }) => (
        <code className="text-sm">{getValue<string>()}</code>
      ),
    },
    {
      id: "calls",
      accessorKey: "calls",
      header: "Calls",
      cell: ({ getValue }) => getValue<number>().toLocaleString(),
    },
  ];
  if (showReplacement) {
    cols.push({
      id: "replacement",
      accessorKey: "replacement",
      header: "Replacement",
      cell: ({ getValue }) => {
        const value = getValue<string | undefined>();
        return value ? <code className="text-sm">{value}</code> : "—";
      },
    });
  }
  if (showRetiredDate) {
    cols.push({
      id: "retiredDate",
      accessorKey: "retiredDate",
      header: "Retired",
      cell: ({ getValue }) => getValue<string | undefined>() ?? "—",
    });
  }
  return cols;
}

export default function ModelStatusPage() {
  const { data, isLoading, error, dataUpdatedAt, isFetching, refetch } =
    useModelStatus();
  const [range, setRange] = useState<RangeKey>("today");

  const stats = data?.stats;
  const registry = data?.registry;
  const history = stats?.daily_history;
  const hasRedis = Boolean(stats?.daily_history_available);

  const retiredPick = pickToday(
    stats?.available ? stats?.retired_total : undefined,
    history,
    "retired_total",
    hasRedis
  );
  const deprecatedPick = pickToday(
    stats?.available ? stats?.deprecated_total : undefined,
    history,
    "deprecated_total",
    hasRedis
  );
  const unknownPick = pickToday(
    stats?.available ? stats?.unknown_total : undefined,
    history,
    "unknown_total",
    hasRedis
  );

  const retiredValue =
    range === "today"
      ? retiredPick.value
      : sumScalarField(history, range, "retired_total");
  const deprecatedValue =
    range === "today"
      ? deprecatedPick.value
      : sumScalarField(history, range, "deprecated_total");
  const unknownValue =
    range === "today"
      ? unknownPick.value
      : sumScalarField(history, range, "unknown_total");
  const summarySource: DataSource =
    range === "today" ? retiredPick.source : hasRedis ? "redis" : "memory";

  const retiredHistory = useHistory(
    stats?.available ? retiredPick.value : undefined
  );
  const dailyRetired = useMemo(
    () => scalarSeries(history, "retired_total", range),
    [history, range]
  );
  const useDailyChart = Boolean(
    hasRedis && range !== "today" && dailyRetired.available
  );
  const hourlyRetired = useMemo(
    () => hourlySeries(stats?.hourly_history, "retired_total"),
    [stats?.hourly_history]
  );
  const useHourlyChart = Boolean(
    stats?.hourly_history_available &&
      range === "today" &&
      hourlyRetired.available
  );

  const breakdownSource: DataSource =
    hasRedis || range !== "today" ? "redis" : "memory";
  const byRetired =
    hasRedis || range !== "today"
      ? aggNameCount(history, range, "by_retired")
      : toNameCount(stats?.by_retired);
  const byDeprecated =
    hasRedis || range !== "today"
      ? aggNameCount(history, range, "by_deprecated")
      : toNameCount(stats?.by_deprecated);
  const byUnknown =
    hasRedis || range !== "today"
      ? aggNameCount(history, range, "by_unknown")
      : toNameCount(stats?.by_unknown);

  const retiredRows = useMemo(
    () => trafficRows(byRetired, "retired", registry?.retired),
    [byRetired, registry?.retired]
  );
  const deprecatedRows = useMemo(
    () => trafficRows(byDeprecated, "deprecated", registry?.deprecated),
    [byDeprecated, registry?.deprecated]
  );
  const unknownRows = useMemo(
    () => trafficRows(byUnknown, "unknown", undefined),
    [byUnknown]
  );

  const retiredColumns = useMemo(() => trafficColumns(true, true), []);
  const deprecatedColumns = useMemo(() => trafficColumns(true, false), []);
  const unknownColumns = useMemo(() => trafficColumns(false, false), []);

  if (isLoading) {
    return <LoadingBlock />;
  }
  if (error) {
    return (
      <ErrorAlert
        message={
          error instanceof Error ? error.message : "Failed to load model status"
        }
      />
    );
  }
  if (!data) {
    return null;
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
              fetching={isFetching}
              onRefresh={() => refetch()}
              updatedAt={dataUpdatedAt}
            />
          </div>
        }
        description="Retired, deprecated, and unrecognized model traffic."
        title="Model Status"
      />

      {stats?.available ? null : (
        <div className="alert alert-info">
          <span>Model status stats are unavailable on this instance.</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <LiveStat
          hint={`blocked requests · ${rangeLabel(range)}`}
          source={summarySource}
          title="Retired calls"
          value={retiredValue.toLocaleString()}
        />
        <LiveStat
          hint={`still forwarded · ${rangeLabel(range)}`}
          source={summarySource}
          title="Deprecated calls"
          value={deprecatedValue.toLocaleString()}
        />
        <LiveStat
          hint={`unregistered slugs · ${rangeLabel(range)}`}
          source={summarySource}
          title="Unknown models"
          value={unknownValue.toLocaleString()}
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
            title="Retired calls over time"
          >
            {useDailyChart ? (
              <BarChart
                colors={dailyRetired.labels.map(() => chartPalette.error())}
                label="Retired calls"
                labels={dailyRetired.labels}
                values={dailyRetired.values}
              />
            ) : useHourlyChart ? (
              <BarChart
                colors={hourlyRetired.labels.map(() => chartPalette.error())}
                label="Hourly retired calls"
                labels={hourlyRetired.labels}
                values={hourlyRetired.values}
              />
            ) : (
              <TrendChart
                color={chartPalette.error()}
                label="Retired calls"
                points={retiredHistory}
              />
            )}
          </ChartCard>
        </div>
        <ChartCard
          source={breakdownSource}
          subtitle={`Retired vs deprecated vs unknown · ${rangeLabel(range)}`}
          title="Issue mix"
        >
          <BarChart
            colors={[
              chartPalette.error(),
              chartPalette.warning(),
              chartPalette.info(),
            ]}
            label="Calls"
            labels={["Retired", "Deprecated", "Unknown"]}
            values={[retiredValue, deprecatedValue, unknownValue]}
          />
        </ChartCard>
      </div>

      <SectionPanel
        source={breakdownSource}
        subtitle={`Blocked at the proxy · ${rangeLabel(range)}`}
        title="Retired model calls"
      >
        <DataTable
          columns={retiredColumns}
          data={retiredRows}
          emptyMessage="No retired model calls in this window"
          getRowId={(row) => row.id}
          searchPlaceholder="Filter models…"
        />
      </SectionPanel>

      <SectionPanel
        source={breakdownSource}
        subtitle={`Still forwarded upstream · ${rangeLabel(range)}`}
        title="Deprecated model calls"
      >
        <DataTable
          columns={deprecatedColumns}
          data={deprecatedRows}
          emptyMessage="No deprecated model calls in this window"
          getRowId={(row) => row.id}
          searchPlaceholder="Filter models…"
        />
      </SectionPanel>

      <SectionPanel
        source={breakdownSource}
        subtitle={`Slugs not in proxy config · ${rangeLabel(range)}`}
        title="Unknown model calls"
      >
        <DataTable
          columns={unknownColumns}
          data={unknownRows}
          emptyMessage="No unknown model calls in this window"
          getRowId={(row) => row.id}
          searchPlaceholder="Filter models…"
        />
      </SectionPanel>
    </div>
  );
}
