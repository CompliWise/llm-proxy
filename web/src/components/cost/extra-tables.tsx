import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useCollapsedRows } from "../../hooks/use-collapsed-rows";
import { formatKeySpendCap, formatUsd } from "../../lib/format";
import { topDisplayRows } from "../../lib/group-rows";
import type { APIKey, CostRecentEvent, CostTransport } from "../../types";
import { chartPalette } from "../charts/chart-setup";
import DataTable from "../ui/data-table";
import KeyLink from "../ui/key-link";
import { ProviderBadge } from "../ui/page-header";

interface LimitSpendRow {
  id: string;
  key: APIKey;
  label: string;
  limitUsd: number;
  requests: number;
  spendUsd: number;
}

type LimitSpendDisplayRow = LimitSpendRow & { isOthers?: boolean };

function limitSpendDisplayRows(
  rows: LimitSpendRow[],
  topN: number,
  collapse: boolean
): LimitSpendDisplayRow[] {
  return topDisplayRows(
    rows,
    (row) => row.spendUsd,
    (rest) =>
      rest.reduce(
        (acc, row) => ({
          id: "",
          label: "",
          spendUsd: acc.spendUsd + row.spendUsd,
          limitUsd: acc.limitUsd + row.limitUsd,
          requests: acc.requests + row.requests,
          key: row.key,
        }),
        {
          id: "",
          label: "",
          spendUsd: 0,
          limitUsd: 0,
          requests: 0,
          key: rest[0]?.key ?? rows[0]?.key,
        }
      ),
    (aggregated, count) => ({
      ...aggregated,
      id: "__others__",
      label: `(and ${count} other${count === 1 ? "" : "s"})`,
    }),
    topN,
    collapse
  );
}

export function LimitSpendTable({
  rows,
  keys,
}: {
  rows: LimitSpendRow[];
  keys: APIKey[];
}) {
  const { displayData, onSearchActiveChange, footer } = useCollapsedRows(
    rows,
    limitSpendDisplayRows,
    "keys"
  );

  const columns = useMemo<ColumnDef<LimitSpendDisplayRow, unknown>[]>(
    () => [
      {
        id: "key",
        accessorKey: "label",
        header: "Key",
        cell: ({ row }) => {
          const data = row.original;
          if (data.isOthers) {
            return (
              <span className="text-base-content/60 italic">{data.label}</span>
            );
          }
          return (
            <KeyLink
              keys={keys}
              keyValue={data.key.key}
              label={data.label}
              showMasked={Boolean(data.key.description)}
            />
          );
        },
      },
      {
        id: "spend",
        accessorKey: "spendUsd",
        header: "Spend today",
        cell: ({ getValue }) => formatUsd(getValue<number>()),
      },
      {
        id: "limit",
        accessorKey: "limitUsd",
        header: "Spend cap",
        cell: ({ row }) =>
          row.original.isOthers ? "—" : formatKeySpendCap(row.original.key),
      },
      {
        id: "requests",
        accessorKey: "requests",
        header: "Requests",
        cell: ({ getValue }) => getValue<number>(),
      },
    ],
    [keys]
  );

  return (
    <DataTable
      columns={columns}
      data={displayData}
      emptyMessage="No spend or limits recorded yet"
      footer={footer}
      getRowId={(row) => row.id}
      onSearchActiveChange={onSearchActiveChange}
      searchPlaceholder="Filter keys…"
    />
  );
}

export function RecentCostTable({
  rows,
  keys,
}: {
  rows: CostRecentEvent[];
  keys: APIKey[];
}) {
  const columns = useMemo<ColumnDef<CostRecentEvent, unknown>[]>(
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
        id: "key",
        accessorKey: "key_id",
        header: "Key",
        cell: ({ row }) =>
          row.original.key_id ? (
            <KeyLink
              className="font-mono text-xs"
              keys={keys}
              maskedId={row.original.key_id}
            />
          ) : (
            "—"
          ),
      },
      {
        id: "provider",
        accessorKey: "provider",
        header: "Provider",
        cell: ({ getValue }) => <ProviderBadge provider={getValue<string>()} />,
      },
      {
        id: "model",
        accessorKey: "model",
        header: "Model",
        cell: ({ getValue }) => (
          <span className="text-base-content/60 text-xs">
            {getValue<string>() ?? "—"}
          </span>
        ),
      },
      {
        id: "total",
        accessorKey: "spend_usd",
        header: "Total",
        cell: ({ getValue }) => formatUsd(getValue<number>()),
      },
      {
        id: "input",
        accessorFn: (row) => row.input_spend_usd ?? 0,
        header: "Input",
        cell: ({ getValue }) => formatUsd(getValue<number>()),
      },
      {
        id: "output",
        accessorFn: (row) => row.output_spend_usd ?? 0,
        header: "Output",
        cell: ({ getValue }) => formatUsd(getValue<number>()),
      },
    ],
    [keys]
  );

  return (
    <DataTable
      columns={columns}
      data={rows}
      emptyMessage="No recent events"
      getRowId={(row, index) => `${row.time}-${row.model}-${index}`}
      searchPlaceholder="Filter events…"
    />
  );
}

const TRANSPORT_COLORS: Record<string, () => string> = {
  file: chartPalette.info,
  dynamodb: chartPalette.primary,
  datadog: chartPalette.warning,
};

export function TransportsTable({
  transports,
}: {
  transports: CostTransport[];
}) {
  const columns = useMemo<ColumnDef<CostTransport, unknown>[]>(
    () => [
      {
        id: "type",
        accessorKey: "type",
        header: "Type",
        cell: ({ getValue }) => {
          const type = getValue<string>();
          return (
            <span
              className="badge badge-sm"
              style={{
                backgroundColor: (
                  TRANSPORT_COLORS[type] ?? chartPalette.primary
                )(),
                color: "white",
                border: 0,
              }}
            >
              {type}
            </span>
          );
        },
      },
      {
        id: "destination",
        accessorFn: (row) =>
          row.path ??
          row.table_name ??
          (row.host ? `${row.host}:${row.port ?? ""}` : undefined) ??
          row.namespace ??
          "—",
        header: "Destination",
        cell: ({ getValue }) => (
          <span className="text-base-content/70">{getValue<string>()}</span>
        ),
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={transports}
      emptyMessage="No transports configured"
      getRowId={(row, index) => `${row.type}-${index}`}
      searchable={false}
    />
  );
}
