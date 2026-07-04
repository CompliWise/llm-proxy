import type { ColumnDef } from "@tanstack/react-table";
import { useMemo, useState } from "react";

import { BarChart, ChartCard } from "../components/charts";
import { chartPalette } from "../components/charts/chart-setup";
import {
  LiveStat,
  rateLimitUsageSource,
  SectionPanel,
} from "../components/ui/data-source";
import DataTable from "../components/ui/data-table";
import KeyLink from "../components/ui/key-link";
import PageHeader, {
  ErrorAlert,
  LiveIndicator,
  LoadingBlock,
} from "../components/ui/page-header";
import { useKeys, useRateLimits } from "../hooks/queries";
import { useCollapsedRows } from "../hooks/use-collapsed-rows";
import { formatCount, scopeLabel } from "../lib/format";
import { scopeUsageDisplayRows } from "../lib/group-rows";
import type { RateLimitCounter } from "../types";

interface ScopeRow {
  label: string;
  requests: number;
  scope: string;
  tokens: number;
}

function counterRows(
  counters: Record<string, RateLimitCounter> | undefined
): ScopeRow[] {
  return Object.entries(counters ?? {}).map(([scope, c]) => ({
    scope,
    label: scopeLabel(scope),
    requests: c.requests ?? 0,
    tokens: c.tokens ?? 0,
  }));
}

function RateLimitUsageTable({
  rows,
  keys,
}: {
  rows: ScopeRow[];
  keys: ReturnType<typeof useKeys>["data"];
}) {
  const { displayData, onSearchActiveChange, footer } = useCollapsedRows(
    rows,
    scopeUsageDisplayRows,
    "scopes"
  );

  const columns = useMemo<ColumnDef<(typeof displayData)[number], unknown>[]>(
    () => [
      {
        id: "scope",
        accessorKey: "label",
        header: "Scope",
        cell: ({ row }) => {
          const data = row.original;
          if (data.isOthers) {
            return (
              <span className="text-base-content/60 italic">{data.label}</span>
            );
          }
          return data.scope.startsWith("key:") ? (
            <KeyLink keys={keys} label={data.label} scope={data.scope} />
          ) : (
            <span className="font-medium">{data.label}</span>
          );
        },
      },
      {
        id: "requests",
        accessorKey: "requests",
        header: "Requests",
        cell: ({ getValue }) => formatCount(getValue<number>()),
      },
      {
        id: "tokens",
        accessorKey: "tokens",
        header: "Tokens",
        cell: ({ getValue }) => formatCount(getValue<number>()),
      },
    ],
    [keys]
  );

  return (
    <DataTable
      columns={columns}
      data={displayData}
      emptyMessage="No usage recorded in this window"
      footer={footer}
      getRowId={(row) => (row.isOthers ? "__others__" : row.scope)}
      onSearchActiveChange={onSearchActiveChange}
      searchPlaceholder="Filter scopes…"
    />
  );
}

export default function RateLimitsPage() {
  const { data, isLoading, error, dataUpdatedAt, isFetching, refetch } =
    useRateLimits();
  const keys = useKeys();
  const [window, setWindow] = useState<"day" | "minute">("day");

  if (isLoading) {
    return <LoadingBlock />;
  }
  if (error) {
    return (
      <ErrorAlert
        message={
          error instanceof Error ? error.message : "Failed to load rate limits"
        }
      />
    );
  }
  if (!data) {
    return null;
  }

  const win = data.snapshot?.[window];
  const rows = counterRows(win?.counters);
  const limits = data.limits;
  const usageSource = rateLimitUsageSource(data.backend);

  return (
    <div className="space-y-6">
      <PageHeader
        actions={
          <LiveIndicator
            fetching={isFetching}
            onRefresh={() => refetch()}
            updatedAt={dataUpdatedAt}
          />
        }
        description="Configured limits and live per-scope usage."
        title="Rate Limits"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <LiveStat
          source="config"
          title="Enabled"
          value={data.enabled ? "Yes" : "No"}
        />
        <LiveStat
          hint="Separate from admin rollup Redis"
          source={usageSource}
          title="Backend"
          value={data.backend ?? "memory"}
          valueClassName="text-lg"
        />
        <LiveStat
          hint={`${window} window`}
          source={usageSource}
          title="Active scopes"
          value={rows.length}
        />
        <LiveStat
          source="config"
          title="Overrides"
          value={
            Object.keys(data.overrides?.PerUser ?? {}).length +
            Object.keys(data.overrides?.PerKey ?? {}).length +
            Object.keys(data.overrides?.PerModel ?? {}).length
          }
        />
      </div>

      <div className="flex items-center gap-3">
        <span className="text-base-content/60 text-sm">Window:</span>
        <div
          className="tabs tabs-boxed rounded-xl bg-base-100/80 p-1 ring-1 ring-base-300/60"
          role="tablist"
        >
          {(["day", "minute"] as const).map((w) => (
            <button
              className={`tab rounded-lg px-4 ${window === w ? "tab-active font-medium" : ""}`}
              key={w}
              onClick={() => setWindow(w)}
              role="tab"
              type="button"
            >
              {w === "day" ? "Daily" : "Per-minute"}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          source={usageSource}
          subtitle={`${window} window`}
          title="Requests by scope"
        >
          <BarChart
            horizontal
            label="Requests"
            labels={rows.map((r) => r.label)}
            values={rows.map((r) => r.requests)}
          />
        </ChartCard>
        <ChartCard
          source={usageSource}
          subtitle={`${window} window`}
          title="Tokens by scope"
        >
          <BarChart
            colors={rows.map(() => chartPalette.info())}
            horizontal
            label="Tokens"
            labels={rows.map((r) => r.label)}
            values={rows.map((r) => r.tokens)}
          />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionPanel source="config" title="Default limits">
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
            <Limit label="RPM" value={limits?.RequestsPerMinute} />
            <Limit label="TPM" value={limits?.TokensPerMinute} />
            <Limit label="RPD" value={limits?.RequestsPerDay} />
            <Limit label="TPD" value={limits?.TokensPerDay} />
          </div>
        </SectionPanel>

        <SectionPanel source={usageSource} title={`Live usage (${window})`}>
          <RateLimitUsageTable keys={keys.data} rows={rows} />
        </SectionPanel>
      </div>
    </div>
  );
}

function Limit({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <p className="text-base-content/50 text-xs uppercase tracking-wide">
        {label}
      </p>
      <p className="font-medium text-lg">{value ? value : "∞"}</p>
    </div>
  );
}
