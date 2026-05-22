'use client';

import type { ColumnDef } from '@tanstack/react-table';
import type {
  BillingField,
  Campaign,
  CampaignAggregateRow,
  FullReportCampaign,
} from '@/features/schedule/queries';
import { BillingCell } from './billing-cell';

// Column factories for the four /reports tabs. Mirrors the
// `buildPeopleColumns(...)` shape from `people-columns.tsx` — pure functions
// returning ColumnDef[] so the consumer can tweak per-tab affordances without
// reaching back here.

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—';
  return n.toLocaleString();
}

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Aggregate tabs (dealer/coach/month) share this column shape — the only
// thing that varies is the first column header and (for the month tab) the
// sort comparator. Return a fresh array per caller so each table mounts
// independent column instances.
//
// No row drill-through. The natural destination (`/dealerships/[id]`)
// gates `admin:access`, but `/reports` admits coaches too — a
// dotted-underline link from a coach view would route to a 403.
// Archived dealers compound the problem: `loadDealer()` filters them
// out, so historical report rows would 404 even for admins. See
// `docs/wiki/layout.md` → "Identity-cell exceptions on `/reports`".
function buildAggregateColumns<K extends number | null | string>(
  groupHeader: string,
  sortByKey?: boolean,
): ColumnDef<CampaignAggregateRow<K>>[] {
  return [
    {
      id: 'groupLabel',
      accessorKey: 'groupLabel',
      header: groupHeader,
      cell: ({ row }) => (
        <span className="font-medium text-zinc-900">{row.original.groupLabel}</span>
      ),
      enableSorting: true,
      // Month tab passes `sortByKey` because `groupLabel` is "April 2026" /
      // "August 2026" / … which sorts alphabetically (April < August <
      // December < July). The chronological signal lives on `groupKey`,
      // which is the `YYYY-MM` string from `to_char` and sorts naturally.
      ...(sortByKey
        ? {
            sortingFn: (a, b) => {
              const av = String(a.original.groupKey ?? '');
              const bv = String(b.original.groupKey ?? '');
              return av.localeCompare(bv);
            },
          }
        : {}),
    },
    {
      id: 'count',
      accessorKey: 'count',
      header: 'Campaigns',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{row.original.count.toLocaleString()}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
    {
      id: 'totalQty',
      accessorKey: 'totalQty',
      header: 'Records',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{fmtNum(row.original.totalQty)}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
    {
      id: 'totalSms',
      accessorKey: 'totalSms',
      header: 'SMS / Email',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{fmtNum(row.original.totalSms)}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
    {
      id: 'totalLetters',
      accessorKey: 'totalLetters',
      header: 'Letters',
      cell: ({ row }) => (
        <span className="text-right tabular-nums">{fmtNum(row.original.totalLetters)}</span>
      ),
      enableSorting: true,
      meta: { align: 'right' },
    },
  ];
}

export function buildClientColumns(): ColumnDef<CampaignAggregateRow<number>>[] {
  return buildAggregateColumns<number>('Dealer');
}

export function buildCoachColumns(): ColumnDef<CampaignAggregateRow<number | null>>[] {
  return buildAggregateColumns<number | null>('Coach');
}

export function buildMonthColumns(): ColumnDef<CampaignAggregateRow<string>>[] {
  return buildAggregateColumns<string>('Month', /* sortByKey */ true);
}

// 0059: the four adjustable billing figures, paired with the `Campaign` key
// holding the original value. `effectiveBilling` is `override ?? original` —
// what the report sums and what sorting keys off.
const BILLING_ORIGINAL_KEY: Record<BillingField, 'qtyRecords' | 'smsEmail' | 'letters' | 'bdc'> = {
  qty_records: 'qtyRecords',
  sms_email: 'smsEmail',
  letters: 'letters',
  bdc: 'bdc',
};

function effectiveBilling(c: FullReportCampaign, field: BillingField): number | null {
  return c.billing[field] ?? c[BILLING_ORIGINAL_KEY[field]] ?? null;
}

// Render one billing figure: an editable cell for admins (`canEditBilling`),
// otherwise the effective value with an "adj" marker when it's been overridden
// so coaches can see a figure was tuned without being able to change it.
function renderBilling(
  c: FullReportCampaign,
  field: BillingField,
  canEditBilling: boolean,
) {
  const original = c[BILLING_ORIGINAL_KEY[field]] ?? null;
  const override = c.billing[field];
  if (canEditBilling) {
    return (
      <BillingCell campaignId={c.id} field={field} original={original} override={override} />
    );
  }
  return (
    <span className="text-right tabular-nums">
      {fmtNum(override ?? original ?? null)}
      {override != null && (
        <span className="ml-1 text-[10px] text-amber-600" title={`Original: ${fmtNum(original)}`}>
          adj
        </span>
      )}
    </span>
  );
}

function billingColumn(
  id: BillingField,
  header: string,
  canEditBilling: boolean,
): ColumnDef<FullReportCampaign> {
  return {
    id,
    accessorFn: (c) => effectiveBilling(c, id) ?? 0,
    header,
    cell: ({ row }) => renderBilling(row.original, id, canEditBilling),
    enableSorting: true,
    meta: { align: 'right' },
  };
}

// Full Production Report — flat campaign list + the 0059 billing overlay.
// Mirrors `/production` columns (the legacy "Full Production Report" tab was
// an alternate render of the same data) with the four quantity columns made
// effective (override ?? original) and inline-editable for admins. Sortable
// headers + tabular-nums on the integer columns.
export function buildFullColumns(
  opts: { canEditBilling: boolean } = { canEditBilling: false },
): ColumnDef<FullReportCampaign>[] {
  const { canEditBilling } = opts;
  return [
    {
      id: 'startDate',
      accessorKey: 'startDate',
      header: 'Start',
      cell: ({ row }) => (
        <div>
          <div className="text-xs font-semibold text-brand-700">{fmtDate(row.original.startDate)}</div>
          <div className="text-[11px] text-zinc-500/70">→ {fmtDate(row.original.endDate)}</div>
        </div>
      ),
      enableSorting: true,
      // Month-picker faceted filter passes a YYYY-MM string. The row value
      // is a full ISO date — match by prefix rather than equality.
      filterFn: (row, _columnId, filterValue: string) => {
        if (!filterValue) return true;
        return row.original.startDate.startsWith(filterValue);
      },
    },
    {
      id: 'dealerName',
      accessorKey: 'dealerName',
      header: 'Dealership',
      cell: ({ row }) => (
        <span className="font-semibold text-zinc-900">{row.original.dealerName}</span>
      ),
      enableSorting: true,
    },
    {
      id: 'styleLabel',
      accessorFn: (c) => c.styleLabel ?? '',
      header: 'Format',
      cell: ({ row }) => row.original.styleLabel ?? <span className="text-zinc-500/70">—</span>,
      enableSorting: true,
    },
    {
      id: 'audienceSourceLabel',
      accessorFn: (c) => c.audienceSourceLabel ?? '',
      header: 'Data Source',
      cell: ({ row }) =>
        row.original.audienceSourceLabel ?? <span className="text-zinc-500/70">—</span>,
      enableSorting: true,
    },
    billingColumn('qty_records', 'Records', canEditBilling),
    billingColumn('sms_email', 'SMS / Email', canEditBilling),
    billingColumn('letters', 'Letters', canEditBilling),
    billingColumn('bdc', 'BDC', canEditBilling),
    {
      id: 'coachName',
      accessorFn: (c) => c.coachName ?? '',
      header: 'Coach',
      cell: ({ row }) =>
        row.original.coachName ? (
          <span className="font-semibold">{row.original.coachName}</span>
        ) : (
          <span className="text-zinc-500/70">—</span>
        ),
      enableSorting: true,
    },
    {
      id: 'status',
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <span className="text-xs">{row.original.status}</span>,
      enableSorting: true,
    },
  ];
}

