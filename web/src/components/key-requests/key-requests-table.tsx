import type { ColumnDef } from "@tanstack/react-table";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { keyDetailPath } from "../../lib/key-routes";
import type { KeyRequestRecord } from "../../types";
import DataTable from "../ui/data-table";

function formatTime(value?: string): string {
  if (!value) {
    return "—";
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return "—";
  }
  return d.toLocaleString();
}

function StatusBadge({ status }: { status: KeyRequestRecord["status"] }) {
  const cls =
    status === "pending"
      ? "badge badge-warning"
      : status === "approved"
        ? "badge badge-success"
        : "badge badge-error";
  return <span className={cls}>{status}</span>;
}

interface KeyRequestsTableProps {
  busyId?: string | null;
  onApprove: (request: KeyRequestRecord) => void;
  onReject: (request: KeyRequestRecord) => void;
  requests: KeyRequestRecord[];
}

export default function KeyRequestsTable({
  requests,
  busyId,
  onApprove,
  onReject,
}: KeyRequestsTableProps) {
  const columns = useMemo<ColumnDef<KeyRequestRecord, unknown>[]>(
    () => [
      {
        id: "requester_email",
        accessorKey: "requester_email",
        header: "Requester",
      },
      {
        id: "provider",
        accessorKey: "provider",
        header: "Provider",
      },
      {
        id: "description",
        accessorKey: "description",
        header: "Description",
        cell: ({ getValue }) => (
          <span className="max-w-xs truncate">{getValue<string>()}</span>
        ),
      },
      {
        id: "daily_cost_limit",
        accessorKey: "daily_cost_limit",
        header: "Daily limit",
        cell: ({ getValue }) => {
          const cents = getValue<number>();
          return cents ? `$${(cents / 100).toFixed(2)}` : "—";
        },
      },
      {
        id: "status",
        accessorKey: "status",
        header: "Status",
        cell: ({ getValue }) => (
          <StatusBadge status={getValue<KeyRequestRecord["status"]>()} />
        ),
      },
      {
        id: "created_at",
        accessorKey: "created_at",
        header: "Submitted",
        cell: ({ getValue }) => formatTime(getValue<string>()),
      },
      {
        id: "created_key",
        accessorKey: "created_key",
        header: "Key",
        cell: ({ row }) =>
          row.original.created_key ? (
            <Link
              className="link link-primary"
              to={keyDetailPath(row.original.created_key!)}
            >
              View
            </Link>
          ) : row.original.rejection_reason ? (
            <span className="text-error text-sm">
              {row.original.rejection_reason}
            </span>
          ) : (
            "—"
          ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const req = row.original;
          if (req.status !== "pending") {
            return null;
          }
          const busy = busyId === req.id;
          return (
            <div className="flex justify-end gap-2">
              <button
                className="btn btn-primary btn-xs"
                disabled={busy}
                onClick={() => onApprove(req)}
                type="button"
              >
                {busy ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : null}
                Approve
              </button>
              <button
                className="btn btn-ghost btn-xs text-error"
                disabled={busy}
                onClick={() => onReject(req)}
                type="button"
              >
                Reject
              </button>
            </div>
          );
        },
      },
    ],
    [busyId, onApprove, onReject]
  );

  return (
    <DataTable
      columns={columns}
      data={requests}
      emptyMessage="No key requests yet"
    />
  );
}
