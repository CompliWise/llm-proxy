import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useCollapsedRows } from "../../hooks/use-collapsed-rows";
import type { CostUserAgg } from "../../lib/daily-history";
import { formatCount, formatUsd } from "../../lib/format";
import {
  type SpendByUserDisplayRow,
  spendByUserDisplayRows,
} from "../../lib/group-rows";
import DataTable from "../ui/data-table";

interface SpendByUserTableProps {
  rows: CostUserAgg[];
}

export default function SpendByUserTable({ rows }: SpendByUserTableProps) {
  const { displayData, onSearchActiveChange, footer } = useCollapsedRows(
    rows,
    spendByUserDisplayRows,
    "users"
  );

  const columns = useMemo<ColumnDef<SpendByUserDisplayRow, unknown>[]>(
    () => [
      {
        id: "user",
        accessorKey: "label",
        header: "User",
        cell: ({ row }) => {
          const data = row.original;
          if (data.isOthers) {
            return (
              <span className="text-base-content/60 italic">{data.label}</span>
            );
          }
          return <span className="font-medium">{data.label}</span>;
        },
      },
      {
        id: "total",
        accessorKey: "spend_usd",
        header: "Total",
        meta: { alignRight: true },
        cell: ({ getValue }) => formatUsd(getValue<number>()),
      },
      {
        id: "input",
        accessorFn: (row) => row.input_spend_usd ?? 0,
        header: "Input",
        meta: { alignRight: true },
        cell: ({ getValue }) => formatUsd(getValue<number>()),
      },
      {
        id: "output",
        accessorFn: (row) => row.output_spend_usd ?? 0,
        header: "Output",
        meta: { alignRight: true },
        cell: ({ getValue }) => formatUsd(getValue<number>()),
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
        accessorFn: (row) => `${row.input_tokens}/${row.output_tokens}`,
        header: "Tokens",
        meta: { alignRight: true },
        cell: ({ row }) => (
          <span className="text-base-content/70">
            {formatCount(row.original.input_tokens)}/
            {formatCount(row.original.output_tokens)}
          </span>
        ),
      },
    ],
    []
  );

  return (
    <DataTable
      columns={columns}
      data={displayData}
      emptyMessage="No spend recorded for this window"
      footer={footer}
      getRowId={(row) =>
        row.isOthers ? "__others__" : row.scope || String(row.requests)
      }
      onSearchActiveChange={onSearchActiveChange}
      searchPlaceholder="Filter users…"
    />
  );
}
