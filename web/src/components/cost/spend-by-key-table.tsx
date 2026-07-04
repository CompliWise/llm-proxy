import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import type { ByoBanActions } from "../../hooks/use-byo-ban-actions";
import { useCollapsedRows } from "../../hooks/use-collapsed-rows";
import { inferProviderFromMaskedId } from "../../lib/byo-ban";
import type { CostKeyAgg } from "../../lib/daily-history";
import { formatCount, formatUsd } from "../../lib/format";
import {
  type SpendByKeyDisplayRow,
  spendByKeyDisplayRows,
} from "../../lib/group-rows";
import type { APIKey } from "../../types";
import ByoBanButton from "../byo/ban-by-key-button";
import DataTable from "../ui/data-table";
import KeyLink from "../ui/key-link";

interface SpendByKeyTableProps {
  byoBanActions: ByoBanActions;
  keys: APIKey[];
  rows: CostKeyAgg[];
}

export default function SpendByKeyTable({
  rows,
  keys,
  byoBanActions,
}: SpendByKeyTableProps) {
  const { displayData, onSearchActiveChange, footer } = useCollapsedRows(
    rows,
    spendByKeyDisplayRows,
    "keys"
  );

  const columns = useMemo<ColumnDef<SpendByKeyDisplayRow, unknown>[]>(
    () => [
      {
        id: "key",
        accessorKey: "key_id",
        header: "Key",
        cell: ({ row }) => {
          const data = row.original;
          if (data.isOthers) {
            return (
              <span className="text-base-content/60 italic">{data.key_id}</span>
            );
          }
          const inferredProvider = inferProviderFromMaskedId(data.key_id);
          return data.key_id ? (
            <div className="flex items-center gap-2">
              <KeyLink
                className="text-xs"
                keys={keys}
                maskedId={data.key_id}
                showMasked
              />
              {inferredProvider ? (
                <ByoBanButton
                  actions={byoBanActions}
                  maskedId={data.key_id}
                  provider={inferredProvider}
                />
              ) : null}
            </div>
          ) : (
            "—"
          );
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
    [keys, byoBanActions]
  );

  return (
    <DataTable
      columns={columns}
      data={displayData}
      emptyMessage="No spend recorded for this window"
      footer={footer}
      getRowId={(row) =>
        row.isOthers ? "__others__" : row.key_id || String(row.requests)
      }
      onSearchActiveChange={onSearchActiveChange}
      searchPlaceholder="Filter keys…"
    />
  );
}
