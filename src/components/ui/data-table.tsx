'use client';

import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  type Table as TanstackTable,
  type Updater,
  type VisibilityState,
  useReactTable,
} from '@tanstack/react-table';
import { useState } from 'react';

// Headless data-table wrapper. Owns sort + pagination + filter state and
// renders the table chrome in this app's Tailwind vocabulary so consumers
// (People today; Production + Lookups in future polish chunks) only have
// to write column defs.
//
// Filter state (`globalFilter`, `columnFilters`) is intentionally hoisted
// so callers can wire their own search box / pill bar; the DataTable just
// reflects the current filter state into its row model.

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  // Initial sort. Defaults to nothing — pass e.g. `[{ id: 'displayName', desc: false }]`.
  initialSorting?: SortingState;
  // Per-column visibility map. Keys = column ids. Useful for toggling a
  // column off when no row would have a meaningful value.
  columnVisibility?: VisibilityState;
  // Hoisted filter state — caller controls the search box / facet UI.
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (updater: Updater<ColumnFiltersState>) => void;
  // Optional global filter function — defaults to row-built-in fuzzy match.
  globalFilterFn?: (row: TData, columnIds: string[], filterValue: string) => boolean;
  // Default page size. Caller can drive a different value via the page-size
  // dropdown after mount.
  initialPageSize?: number;
  emptyState?: React.ReactNode;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  initialSorting = [],
  columnVisibility,
  globalFilter,
  onGlobalFilterChange,
  columnFilters,
  onColumnFiltersChange,
  initialPageSize = 25,
  emptyState,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting);

  // The `react-hooks/incompatible-library` rule fires here because TanStack
  // Table's hook returns functions that the lint rule's heuristic flags as
  // unstable — false positive. The library's API contract guarantees stable
  // identities for the methods we use; this is the canonical TanStack pattern.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<TData>({
    data,
    columns,
    state: {
      sorting,
      ...(columnVisibility != null && { columnVisibility }),
      ...(globalFilter != null && { globalFilter }),
      ...(columnFilters != null && { columnFilters }),
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: onGlobalFilterChange
      ? (updater) => {
          const next =
            typeof updater === 'function'
              ? (updater as (old: string) => string)(globalFilter ?? '')
              : updater;
          onGlobalFilterChange(next);
        }
      : undefined,
    onColumnFiltersChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: initialPageSize, pageIndex: 0 } },
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr
                key={hg.id}
                className="border-b border-stone-200 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500"
              >
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={`px-2 py-2 ${canSort ? 'cursor-pointer select-none hover:text-navy' : ''}`}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                      aria-sort={
                        sortDir === 'asc'
                          ? 'ascending'
                          : sortDir === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                    >
                      <span className="inline-flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort && (
                          <span aria-hidden className="text-[10px]">
                            {sortDir === 'asc' ? '↑' : sortDir === 'desc' ? '↓' : '↕'}
                          </span>
                        )}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getAllLeafColumns().length}
                  className="px-2 py-6 text-center text-sm text-stone-500"
                >
                  {emptyState ?? 'No rows.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-2 py-2 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <DataTablePagination table={table} />
    </div>
  );
}

function DataTablePagination<TData>({ table }: { table: TanstackTable<TData> }) {
  const totalRows = table.getFilteredRowModel().rows.length;
  const pageIndex = table.getState().pagination.pageIndex;
  const pageSize = table.getState().pagination.pageSize;
  const pageCount = table.getPageCount();
  const start = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const end = Math.min(totalRows, (pageIndex + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
      <div>
        {totalRows === 0 ? '0 rows' : `${start}–${end} of ${totalRows}`}
      </div>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          Page size
          <select
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="rounded border border-stone-200 bg-white px-2 py-0.5 disabled:opacity-50"
        >
          ← Prev
        </button>
        <span>
          {pageCount === 0 ? '0 / 0' : `${pageIndex + 1} / ${pageCount}`}
        </span>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="rounded border border-stone-200 bg-white px-2 py-0.5 disabled:opacity-50"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
