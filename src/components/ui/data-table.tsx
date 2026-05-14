'use client';

import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  type Table as TanstackTable,
  type Updater,
  type VisibilityState,
  useReactTable,
} from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/catalyst/table';

// Headless data-table wrapper. Owns sort + pagination + filter state and
// renders the table chrome via Catalyst's <Table> primitives so consumers
// only have to write column defs. TanStack's useReactTable row model stays;
// only the chrome got swapped.

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  initialSorting?: SortingState;
  columnVisibility?: VisibilityState;
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  columnFilters?: ColumnFiltersState;
  onColumnFiltersChange?: (updater: Updater<ColumnFiltersState>) => void;
  globalFilterFn?: FilterFn<TData>;
  sorting?: SortingState;
  onSortingChange?: (updater: Updater<SortingState>) => void;
  pagination?: PaginationState;
  onPaginationChange?: (updater: Updater<PaginationState>) => void;
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
  globalFilterFn,
  sorting: sortingProp,
  onSortingChange: onSortingChangeProp,
  pagination: paginationProp,
  onPaginationChange: onPaginationChangeProp,
  initialPageSize = 25,
  emptyState,
}: DataTableProps<TData, TValue>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>(initialSorting);
  const sorting = sortingProp ?? internalSorting;
  const onSortingChange = onSortingChangeProp ?? setInternalSorting;

  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: initialPageSize,
  });
  const pagination = paginationProp ?? internalPagination;
  const onPaginationChange = onPaginationChangeProp ?? setInternalPagination;

  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<TData>({
    data,
    columns,
    state: {
      sorting,
      pagination,
      ...(columnVisibility != null && { columnVisibility }),
      ...(globalFilter != null && { globalFilter }),
      ...(columnFilters != null && { columnFilters }),
    },
    onSortingChange,
    onPaginationChange,
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
    ...(globalFilterFn != null && { globalFilterFn }),
  });

  const [isPrinting, setIsPrinting] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onBefore = () => setIsPrinting(true);
    const onAfter = () => setIsPrinting(false);
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    };
  }, []);

  const rows = isPrinting
    ? table.getFilteredRowModel().rows
    : table.getRowModel().rows;

  return (
    <div className="flex flex-col gap-3">
      <Table dense>
        <TableHead>
          {table.getHeaderGroups().map((hg) => (
            <TableRow key={hg.id}>
              {hg.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sortDir = header.column.getIsSorted();
                return (
                  <TableHeader
                    key={header.id}
                    className={`text-[11px] uppercase tracking-wide ${canSort ? 'cursor-pointer select-none hover:text-brand-700' : ''}`}
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
                  </TableHeader>
                );
              })}
            </TableRow>
          ))}
        </TableHead>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={table.getVisibleLeafColumns().length}
                className="py-6 text-center text-sm text-zinc-500"
              >
                {emptyState ?? 'No rows.'}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="align-middle">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

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
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 print:hidden">
      <div>
        {totalRows === 0
          ? '0 rows'
          : `${start}–${end} of ${totalRows} ${totalRows === 1 ? 'row' : 'rows'}`}
      </div>
      <div className="flex items-center gap-3">
        <span>
          {pageCount === 0 ? 'Page 0 of 0' : `Page ${pageIndex + 1} of ${pageCount}`}
        </span>
        <label className="flex items-center gap-1">
          <select
            value={pageSize}
            onChange={(e) => table.setPageSize(Number(e.target.value))}
            className="rounded border border-zinc-200 bg-white px-2 py-0.5 text-xs"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span>per page</span>
        </label>
        <button
          type="button"
          onClick={() => table.previousPage()}
          disabled={!table.getCanPreviousPage()}
          className="rounded border border-zinc-200 bg-white px-2 py-0.5 disabled:opacity-50"
        >
          ← Prev
        </button>
        <button
          type="button"
          onClick={() => table.nextPage()}
          disabled={!table.getCanNextPage()}
          className="rounded border border-zinc-200 bg-white px-2 py-0.5 disabled:opacity-50"
        >
          Next →
        </button>
      </div>
    </div>
  );
}
