import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { ByoBanActions } from "../../hooks/use-byo-ban-actions";
import { useCollapsedRows } from "../../hooks/use-collapsed-rows";
import { inferProviderFromMaskedId } from "../../lib/byo-ban";
import type { NameCount } from "../../lib/daily-history";
import {
  type NameCountDisplayRow,
  nameCountDisplayRows,
} from "../../lib/group-rows";
import {
  piiKeyPrimaryLabel,
  piiKeySecondaryLabel,
  piiKeyShowSecondary,
} from "../../lib/pii-key-display";
import type { APIKey, PIIRecentEvent } from "../../types";
import ByoBanButton from "../byo/ban-by-key-button";
import { PiiEntityBadges } from "../pii/pii-entity-badges";
import { PiiRequestActionBadge } from "../pii/pii-request-action";
import DataTable from "../ui/data-table";
import KeyLink from "../ui/key-link";
import { ProviderBadge, StatusBadge } from "../ui/page-header";

export function TopKeysTable({
  rows,
  keys,
  byoBanActions,
}: {
  rows: NameCount[];
  keys: APIKey[];
  byoBanActions: ByoBanActions;
}) {
  const { displayData, onSearchActiveChange, footer } = useCollapsedRows(
    rows,
    nameCountDisplayRows,
    "keys"
  );

  const columns = useMemo<ColumnDef<NameCountDisplayRow, unknown>[]>(
    () => [
      {
        id: "key",
        accessorKey: "name",
        header: "Key",
        cell: ({ row }) => {
          const data = row.original;
          if (data.isOthers) {
            return (
              <span className="text-base-content/60 italic">{data.name}</span>
            );
          }
          const showSecondary = piiKeyShowSecondary(data.name, keys);
          const inferredProvider = inferProviderFromMaskedId(data.name);
          return (
            <div className="flex items-center gap-2">
              <KeyLink
                keys={keys}
                label={piiKeyPrimaryLabel(data.name, keys)}
                maskedId={data.name}
                secondaryLabel={
                  showSecondary
                    ? piiKeySecondaryLabel(data.name, keys)
                    : undefined
                }
                showMasked={showSecondary}
              />
              {inferredProvider ? (
                <ByoBanButton
                  actions={byoBanActions}
                  maskedId={data.name}
                  provider={inferredProvider}
                />
              ) : null}
            </div>
          );
        },
      },
      {
        id: "count",
        accessorKey: "count",
        header: "Detections",
        meta: { alignRight: true },
        cell: ({ getValue }) => getValue<number>().toLocaleString(),
      },
    ],
    [keys, byoBanActions]
  );

  return (
    <DataTable
      columns={columns}
      data={displayData}
      emptyMessage="No detections"
      footer={footer}
      getRowId={(row) => (row.isOthers ? "__others__" : row.name)}
      onSearchActiveChange={onSearchActiveChange}
      searchPlaceholder="Filter keys…"
    />
  );
}

export function RecentDetectionsTable({
  rows,
  keys,
  byoBanActions,
  wirePlaceholders,
}: {
  rows: PIIRecentEvent[];
  keys: APIKey[];
  byoBanActions: ByoBanActions;
  wirePlaceholders: boolean;
}) {
  const columns = useMemo<ColumnDef<PIIRecentEvent, unknown>[]>(
    () => [
      {
        id: "time",
        accessorFn: (row) => new Date(row.time * 1000).toLocaleTimeString(),
        header: "Time",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-base-content/70">
            {getValue<string>()}
          </span>
        ),
      },
      {
        id: "provider",
        accessorKey: "provider",
        header: "Provider",
        cell: ({ getValue }) => <ProviderBadge provider={getValue<string>()} />,
      },
      {
        id: "key",
        accessorKey: "key_id",
        header: "Key",
        cell: ({ row }) => {
          const keyId = row.original.key_id;
          if (!keyId) {
            return "—";
          }
          const showSecondary = piiKeyShowSecondary(keyId, keys);
          return (
            <div className="flex items-center gap-2">
              <KeyLink
                className="font-mono text-xs"
                keys={keys}
                label={piiKeyPrimaryLabel(keyId, keys)}
                maskedId={keyId}
                secondaryLabel={
                  showSecondary ? piiKeySecondaryLabel(keyId, keys) : undefined
                }
                showMasked={showSecondary}
              />
              <ByoBanButton
                actions={byoBanActions}
                maskedId={keyId}
                provider={row.original.provider}
              />
            </div>
          );
        },
      },
      {
        id: "entities",
        accessorKey: "entity_total",
        header: "Entities",
        enableSorting: false,
        cell: ({ row }) => (
          <PiiEntityBadges
            entityCounts={row.original.entity_counts}
            outcome={row.original.outcome}
          />
        ),
      },
      {
        id: "outcome",
        accessorKey: "outcome",
        header: "Request",
        cell: ({ row }) => (
          <PiiRequestActionBadge
            entityTotal={row.original.entity_total}
            outcome={row.original.outcome}
            wirePlaceholders={wirePlaceholders}
          />
        ),
      },
      {
        id: "latency",
        accessorKey: "duration_ms",
        header: "Latency",
        cell: ({ getValue }) => (
          <span className="text-base-content/70">
            {getValue<number>().toFixed(1)} ms
          </span>
        ),
      },
    ],
    [keys, byoBanActions, wirePlaceholders]
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No detections recorded yet"
      getRowId={(row, index) => `${row.time}-${index}`}
      searchPlaceholder="Filter detections…"
    />
  );
}

export interface BlockedByKeyRow {
  count: number;
  currentlyOpen: boolean;
  label: string;
}

export function BlockedByKeyTable({ rows }: { rows: BlockedByKeyRow[] }) {
  const columns = useMemo<ColumnDef<BlockedByKeyRow, unknown>[]>(
    () => [
      {
        id: "status",
        accessorKey: "currentlyOpen",
        header: "Now",
        cell: ({ getValue }) => {
          const open = getValue<boolean>();
          return (
            <span
              className={`badge badge-sm badge-outline ${open ? "badge-error" : "badge-success"}`}
            >
              {open ? "open" : "recovered"}
            </span>
          );
        },
      },
      {
        id: "label",
        accessorKey: "label",
        header: "Breaker key",
        cell: ({ row, getValue }) => (
          <span
            className={`font-mono text-xs ${row.original.currentlyOpen ? "" : "text-base-content/45"}`}
          >
            {getValue<string>()}
          </span>
        ),
      },
      {
        id: "count",
        accessorKey: "count",
        header: "Blocked today",
        meta: { alignRight: true },
        cell: ({ row, getValue }) => (
          <span
            className={row.original.currentlyOpen ? "" : "text-base-content/45"}
          >
            {getValue<number>().toLocaleString()}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No blocked requests in this window"
      getRowId={(row) => row.label}
      searchPlaceholder="Filter breaker keys…"
      tableClassName="table table-zebra table-sm"
    />
  );
}

export function CircuitProvidersTable({
  names,
  providers,
  range,
  hasFailureRedis,
  providerFailurePeaks,
}: {
  names: string[];
  providers: Record<
    string,
    {
      state?: string;
      error?: string;
      failures?: number;
      rollup?: { open?: boolean; enabled?: boolean; threshold?: number };
    }
  >;
  range: string;
  hasFailureRedis: boolean;
  providerFailurePeaks: Map<string, number>;
}) {
  const rows = useMemo(
    () =>
      names.map((name) => {
        const p = providers[name];
        const state = p.state ?? p.error ?? "unknown";
        const failures =
          range === "today" || !hasFailureRedis
            ? (p.failures ?? "—")
            : (providerFailurePeaks.get(name) ?? 0);
        return {
          name,
          state,
          failures,
          rollup: p.rollup?.open ? "open" : p.rollup?.enabled ? "closed" : "—",
          threshold: p.rollup?.threshold ?? "—",
        };
      }),
    [names, providers, range, hasFailureRedis, providerFailurePeaks]
  );

  const columns = useMemo<ColumnDef<(typeof rows)[number], unknown>[]>(
    () => [
      {
        id: "provider",
        accessorKey: "name",
        header: "Provider",
        cell: ({ getValue }) => <ProviderBadge provider={getValue<string>()} />,
      },
      {
        id: "state",
        accessorKey: "state",
        header: "State",
        cell: ({ getValue }) => {
          const state = getValue<string>();
          return (
            <StatusBadge
              active={state === "closed"}
              activeLabel="closed"
              inactiveLabel={state}
            />
          );
        },
      },
      {
        id: "failures",
        accessorKey: "failures",
        header: range === "today" ? "Failures" : "Peak failures",
      },
      {
        id: "rollup",
        accessorKey: "rollup",
        header: "Rollup",
      },
      {
        id: "threshold",
        accessorKey: "threshold",
        header: "Threshold",
      },
    ],
    [range]
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No provider data"
      getRowId={(row) => row.name}
      searchPlaceholder="Filter providers…"
    />
  );
}

export function CircuitActivityTable({
  events,
  formatEventTime,
  eventLabel,
  parseBreakerKey,
}: {
  events: import("../../types").CircuitActivityEvent[];
  formatEventTime: (unix: number) => string;
  eventLabel: (kind: string) => string;
  parseBreakerKey: (
    key: string | undefined,
    fallback: string
  ) => { model?: string | null; scope: string };
}) {
  const columns = useMemo<
    ColumnDef<import("../../types").CircuitActivityEvent, unknown>[]
  >(
    () => [
      {
        id: "time",
        accessorKey: "time",
        header: "Time",
        cell: ({ getValue }) => (
          <span className="whitespace-nowrap text-xs">
            {formatEventTime(getValue<number>())}
          </span>
        ),
      },
      {
        id: "event",
        accessorKey: "kind",
        header: "Event",
        cell: ({ getValue }) => eventLabel(getValue<string>()),
      },
      {
        id: "provider",
        accessorKey: "provider",
        header: "Provider",
        cell: ({ getValue }) => <ProviderBadge provider={getValue<string>()} />,
      },
      {
        id: "model",
        accessorFn: (row) => parseBreakerKey(row.key, row.provider).model,
        header: "Model",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs">{getValue<string>() ?? "—"}</span>
        ),
      },
      {
        id: "scope",
        accessorFn: (row) => parseBreakerKey(row.key, row.provider).scope,
        header: "Scope",
        cell: ({ row }) => {
          const scope = parseBreakerKey(
            row.original.key,
            row.original.provider
          ).scope;
          return (
            <span
              className={`badge badge-sm ${scope === "model" ? "badge-ghost" : "badge-warning"}`}
            >
              {scope === "model" ? "per-model" : "provider-wide"}
            </span>
          );
        },
      },
      {
        id: "result",
        accessorKey: "new_state",
        header: "Result",
        cell: ({ getValue }) => {
          const state = getValue<string | undefined>();
          return state ? (
            <StatusBadge
              active={state === "closed"}
              activeLabel="closed"
              inactiveLabel={state}
            />
          ) : (
            "—"
          );
        },
      },
      {
        id: "detail",
        accessorFn: (row) => row.reason ?? "",
        header: "Detail",
        enableSorting: false,
        cell: ({ row }) => {
          const e = row.original;
          const { scope } = parseBreakerKey(e.key, e.provider);
          return (
            <span className="text-base-content/70 text-xs">
              {e.status_code ? `HTTP ${e.status_code}` : null}
              {e.failure_kind ? ` ${e.failure_kind}` : null}
              {e.upstream_error ? (
                <span className="block text-base-content/60">
                  {e.upstream_error}
                </span>
              ) : null}
              {e.reason ? e.reason : null}
              {scope === "model" && e.key ? (
                <span className="block font-mono text-base-content/50">
                  {e.key}
                </span>
              ) : null}
            </span>
          );
        },
      },
    ],
    [formatEventTime, eventLabel, parseBreakerKey]
  );

  return (
    <DataTable
      columns={columns}
      data={events}
      emptyMessage="No recovery probes in this window"
      getRowId={(row, index) => `${row.time}-${row.kind}-${index}`}
      searchPlaceholder="Filter events…"
      tableClassName="table table-zebra table-sm"
    />
  );
}
