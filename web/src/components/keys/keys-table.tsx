import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { formatKeySpendCap } from "../../lib/format";
import type { APIKey, PiiRedactSetting, Provider } from "../../types";
import DataTable from "../ui/data-table";
import KeyLink from "../ui/key-link";
import { ProviderBadge, StatusBadge } from "../ui/page-header";

function piiLabel(value?: PiiRedactSetting): string {
  if (value === true) {
    return "On";
  }
  if (value === false) {
    return "Off";
  }
  return "Inherit";
}

interface KeysTableProps {
  canDelete?: boolean;
  formatRateLimits: (record: APIKey) => string;
  keys: APIKey[];
  maskKey: (key: string) => string;
  onDelete: (record: APIKey) => void;
  onEdit: (record: APIKey) => void;
  onShare: (record: APIKey) => void;
  sharingKey?: string | null;
  viewerMode?: boolean;
}

export default function KeysTable({
  keys,
  onShare,
  onEdit,
  onDelete,
  canDelete = true,
  viewerMode = false,
  sharingKey,
  maskKey,
  formatRateLimits,
}: KeysTableProps) {
  const columns = useMemo<ColumnDef<APIKey, unknown>[]>(() => {
    const cols: ColumnDef<APIKey, unknown>[] = [
      {
        id: "name",
        accessorKey: "description",
        header: "Name",
        cell: ({ row }) => (
          <KeyLink
            keys={keys}
            keyValue={row.original.key}
            label={row.original.description?.trim() || "Unnamed key"}
          />
        ),
      },
      {
        id: "key",
        accessorKey: "key",
        header: "Key",
        cell: ({ row }) => (
          <span className="font-mono text-base-content/80 text-xs">
            {maskKey(row.original.key)}
          </span>
        ),
      },
      {
        id: "provider",
        accessorKey: "provider",
        header: "Provider",
        cell: ({ getValue }) => (
          <ProviderBadge provider={getValue<Provider>()} />
        ),
      },
      {
        id: "status",
        accessorKey: "enabled",
        header: "Status",
        cell: ({ getValue }) => (
          <StatusBadge
            active={getValue<boolean>()}
            activeLabel="Enabled"
            inactiveLabel="Disabled"
          />
        ),
      },
      {
        id: "costLimit",
        accessorFn: (row) => formatKeySpendCap(row),
        header: viewerMode ? "Monthly limit" : "Spend cap",
        cell: ({ row }) => formatKeySpendCap(row.original),
      },
    ];

    if (!viewerMode) {
      cols.push(
        {
          id: "rateLimits",
          accessorFn: (row) => formatRateLimits(row),
          header: "Rate limits",
          cell: ({ getValue }) => (
            <span
              className="max-w-[10rem] truncate text-base-content/70 text-xs"
              title={getValue<string>()}
            >
              {getValue<string>()}
            </span>
          ),
        },
        {
          id: "pii",
          accessorKey: "redact_pii",
          header: "PII redact",
          cell: ({ getValue }) => (
            <span className="badge badge-ghost badge-sm">
              {piiLabel(getValue<PiiRedactSetting>())}
            </span>
          ),
        }
      );
    }

    cols.push({
      id: "actions",
      header: () => <span className="sr-only">Actions</span>,
      enableSorting: false,
      meta: { alignRight: true },
      cell: ({ row }) => (
        <div className="flex justify-end gap-2">
          <button
            className="btn btn-ghost btn-xs"
            disabled={sharingKey === row.original.key}
            onClick={() => onShare(row.original)}
            type="button"
          >
            {sharingKey === row.original.key ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              "Share"
            )}
          </button>
          <button
            className="btn btn-ghost btn-xs"
            onClick={() => onEdit(row.original)}
            type="button"
          >
            Edit
          </button>
          {canDelete ? (
            <button
              className="btn btn-ghost btn-xs text-error"
              onClick={() => onDelete(row.original)}
              type="button"
            >
              Delete
            </button>
          ) : null}
        </div>
      ),
    });

    return cols;
  }, [
    keys,
    maskKey,
    formatRateLimits,
    onShare,
    onEdit,
    onDelete,
    canDelete,
    sharingKey,
    viewerMode,
  ]);

  return (
    <DataTable
      columns={columns}
      data={keys}
      emptyMessage="No API keys"
      getRowId={(row) => row.key}
      searchPlaceholder="Filter keys…"
    />
  );
}
