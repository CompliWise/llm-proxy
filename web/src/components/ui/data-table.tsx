import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { useEffect, useState } from "react";

interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  emptyMessage?: string;
  /** Optional footer shown when rows are collapsed elsewhere. */
  footer?: React.ReactNode;
  getRowId?: (row: T, index: number) => string;
  /** When set, search/filter expands the table (e.g. disables top-N collapse). */
  onSearchActiveChange?: (active: boolean) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  tableClassName?: string;
}

export default function DataTable<T>({
  data,
  columns,
  searchPlaceholder = "Search…",
  emptyMessage = "No rows match",
  getRowId,
  onSearchActiveChange,
  footer,
  searchable = true,
  tableClassName = "table table-zebra",
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: getRowId ? (row, index) => getRowId(row, index) : undefined,
    globalFilterFn: (row, _columnId, filter) => {
      const query = String(filter).trim().toLowerCase();
      if (!query) {
        return true;
      }
      return row.getVisibleCells().some((cell) => {
        const value = cell.getValue();
        if (value == null) {
          return false;
        }
        return String(value).toLowerCase().includes(query);
      });
    },
  });

  useEffect(() => {
    onSearchActiveChange?.(Boolean(globalFilter.trim()));
  }, [globalFilter, onSearchActiveChange]);

  const rows = table.getRowModel().rows;

  return (
    <div className="px-5 pt-4 pb-5">
      {searchable ? (
        <div className="mb-4">
          <label className="input input-bordered input-sm flex w-full max-w-sm items-center gap-2 bg-base-100/80">
            <svg
              aria-hidden
              className="size-4 shrink-0 opacity-50"
              fill="currentColor"
              viewBox="0 0 16 16"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                clipRule="evenodd"
                d="M9.965 11.026a5 5 0 1 1 1.06-1.06l2.755 2.754a.75.75 0 1 1-1.06 1.06l-2.755-2.754ZM10.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z"
                fillRule="evenodd"
              />
            </svg>
            <input
              className="grow bg-transparent"
              onChange={(event) => table.setGlobalFilter(event.target.value)}
              placeholder={searchPlaceholder}
              type="search"
              value={globalFilter}
            />
          </label>
        </div>
      ) : null}

      <div className="-mx-5 overflow-x-auto px-5">
        <table className={tableClassName}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      className={
                        header.column.columnDef.meta?.alignRight
                          ? "text-right"
                          : undefined
                      }
                      key={header.id}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          className="inline-flex items-center gap-1 hover:text-base-content"
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                          <span aria-hidden className="text-base-content/40">
                            {sorted === "asc"
                              ? "↑"
                              : sorted === "desc"
                                ? "↓"
                                : "↕"}
                          </span>
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                className={
                  row.original &&
                  (row.original as { isOthers?: boolean }).isOthers
                    ? "text-base-content/70"
                    : undefined
                }
                key={row.id}
              >
                {row.getVisibleCells().map((cell) => (
                  <td
                    className={
                      cell.column.columnDef.meta?.alignRight
                        ? "text-right"
                        : undefined
                    }
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td
                  className="text-center text-base-content/50"
                  colSpan={columns.length}
                >
                  {emptyMessage}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {footer ? <div className="mt-4 flex justify-end">{footer}</div> : null}
    </div>
  );
}

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData, TValue> {
    alignRight?: boolean;
  }
}
