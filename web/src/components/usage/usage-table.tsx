import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useCollapsedRows } from "../../hooks/use-collapsed-rows";
import type { RangeKey } from "../../lib/daily-history";
import { formatCount } from "../../lib/format";
import {
  type UsageDisplayRow,
  type UsageRow,
  usageDisplayRows,
} from "../../lib/group-rows";
import type { APIKey } from "../../types";
import { type DataSource, SectionPanel } from "../ui/data-source";
import DataTable from "../ui/data-table";
import KeyLink from "../ui/key-link";

function rangeLabel(range: RangeKey): string {
  return range === "today"
    ? "today"
    : `last ${range === "7d" ? "7" : "30"} days`;
}

interface UsageTableProps {
  keys?: APIKey[];
  linkKeys?: boolean;
  range: RangeKey;
  rows: UsageRow[];
  source: DataSource;
  title: string;
}

export default function UsageTable({
  title,
  rows,
  keys,
  linkKeys = false,
  source,
  range,
}: UsageTableProps) {
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  const subtitle =
    source === "redis"
      ? `Summed Redis rollups · ${rangeLabel(range)}`
      : `Live memory · ${rangeLabel(range)}`;
  const entityLabel = `${title.replace("By ", "").toLowerCase()}s`;
  const { displayData, onSearchActiveChange, footer } = useCollapsedRows(
    rows,
    usageDisplayRows,
    entityLabel
  );

  const labelHeader = title.replace("By ", "");

  const columns = useMemo<ColumnDef<UsageDisplayRow, unknown>[]>(
    () => [
      {
        id: "label",
        accessorKey: "label",
        header: labelHeader,
        cell: ({ row }) => {
          const data = row.original;
          if (data.isOthers) {
            return (
              <span className="text-base-content/60 italic">{data.label}</span>
            );
          }
          return linkKeys ? (
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
        meta: { alignRight: true },
        cell: ({ getValue }) => formatCount(getValue<number>()),
      },
      {
        id: "tokens",
        accessorKey: "tokens",
        header: "Tokens",
        meta: { alignRight: true },
        cell: ({ getValue }) => formatCount(getValue<number>()),
      },
      {
        id: "share",
        accessorFn: (row) =>
          totalTokens > 0 ? (row.tokens / totalTokens) * 100 : 0,
        header: "Share",
        meta: { alignRight: true },
        cell: ({ row }) => (
          <span className="text-base-content/60">
            {totalTokens > 0
              ? `${((row.original.tokens / totalTokens) * 100).toFixed(1)}%`
              : "—"}
          </span>
        ),
      },
    ],
    [keys, linkKeys, labelHeader, totalTokens]
  );

  return (
    <SectionPanel source={source} subtitle={subtitle} title={title}>
      <DataTable
        columns={columns}
        data={displayData}
        emptyMessage="No usage recorded today"
        footer={footer}
        getRowId={(row) => (row.isOthers ? "__others__" : row.scope)}
        onSearchActiveChange={onSearchActiveChange}
        searchPlaceholder={`Filter ${entityLabel}…`}
      />
    </SectionPanel>
  );
}
