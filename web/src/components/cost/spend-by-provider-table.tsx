import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { useCollapsedRows } from "../../hooks/use-collapsed-rows";
import type { ProviderSpendAgg } from "../../lib/daily-history";
import { formatCount, formatUsd } from "../../lib/format";
import {
  type SpendByProviderDisplayRow,
  spendByProviderDisplayRows,
} from "../../lib/group-rows";
import DataTable from "../ui/data-table";
import { ProviderBadge } from "../ui/page-header";

interface SpendByProviderTableProps {
  rows: ProviderSpendAgg[];
}

export default function SpendByProviderTable({
  rows,
}: SpendByProviderTableProps) {
  const { displayData, onSearchActiveChange, footer } = useCollapsedRows(
    rows,
    spendByProviderDisplayRows,
    "providers"
  );

  const columns = useMemo<ColumnDef<SpendByProviderDisplayRow, unknown>[]>(
    () => [
      {
        id: "provider",
        accessorKey: "name",
        header: "Provider",
        cell: ({ row }) => {
          const data = row.original;
          if (data.isOthers) {
            return (
              <span className="text-base-content/60 italic">{data.name}</span>
            );
          }
          return <ProviderBadge provider={data.name} />;
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
        id: "requests",
        accessorKey: "requests",
        header: "Requests",
        meta: { alignRight: true },
        cell: ({ getValue }) => formatCount(getValue<number>()),
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
        row.isOthers ? "__others__" : row.name || String(row.requests)
      }
      onSearchActiveChange={onSearchActiveChange}
      searchPlaceholder="Filter providers…"
    />
  );
}
