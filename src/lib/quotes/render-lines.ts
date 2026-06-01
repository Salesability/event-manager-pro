import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { quotes } from '@/lib/db/schema';
import type { QuoteLineItem } from '@/lib/pdf/render-quote';

// 0062 Phase 7: the quote's line items live in `quote_line_items` (the former
// `quotes.line_items` jsonb column was dropped). Render/preload paths read them
// inline via this correlated subquery so they stay a single round-trip on the
// existing quote SELECT — no extra query, no per-test mock churn.

export type RenderLineRow = {
  label: string;
  description: string | null;
  qty: number;
  unitPrice: number;
  overrideUnitPrice: number | null;
  lineTotal: number;
};

// A jsonb array of the quote's picked lines, ordered by display_order, ready to
// drop into any `db.select({...}).from(quotes)` projection as a column. Returns
// `[]` for a quote with no lines.
export const renderLinesColumn = sql<RenderLineRow[]>`(
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'label', li.label,
        'description', li.description,
        'qty', li.qty,
        'unitPrice', li.unit_price,
        'overrideUnitPrice', li.override_unit_price,
        'lineTotal', li.line_total
      ) order by li.display_order
    ),
    '[]'::jsonb
  )
  from quote_line_items li
  where li.quote_id = ${quotes.id}
)`;

// Map the subquery rows to the PDF renderer's shape: the SKU label is the line
// description, the catalogue description is the sub-line, and the effective
// (override-or-catalogue) price drives the unit column.
export function mapRenderLines(rows: RenderLineRow[]): QuoteLineItem[] {
  return rows.map((r) => {
    const unit = r.overrideUnitPrice != null ? Number(r.overrideUnitPrice) : Number(r.unitPrice);
    const sub =
      typeof r.description === 'string' && r.description.trim().length > 0 ? r.description : undefined;
    return {
      description: r.label,
      ...(sub ? { subDescription: sub } : {}),
      quantity: r.qty,
      unitPrice: unit,
      total: Number(r.lineTotal),
    };
  });
}

// Stable digest of the prospect-visible line essence (label · qty · effective
// unit · line total), used by the `quote.edited` audit to detect no-op saves.
// Structural param so it hashes both the subquery rows and `PickedLine[]`.
export function lineFingerprint(
  lines: Array<{
    label: string;
    qty: number;
    unitPrice: number;
    overrideUnitPrice?: number | null;
    lineTotal: number;
  }>,
): string {
  const norm = lines.map((l) => ({
    label: l.label,
    qty: Number(l.qty),
    unit: l.overrideUnitPrice != null ? Number(l.overrideUnitPrice) : Number(l.unitPrice),
    total: Number(l.lineTotal),
  }));
  return createHash('sha256').update(JSON.stringify(norm)).digest('hex').slice(0, 16);
}
