import { getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { quoteLineItems } from './quote-line-items';

// Pure schema-introspection test (no DB) — locks the `quote_line_items` shape
// the 0062 picker depends on: the column set, the money-column types, and the
// index set. Drizzle's getTableConfig reads the table definition object, so
// this runs in vitest without a live Postgres.
describe('quote_line_items schema', () => {
  const config = getTableConfig(quoteLineItems);
  const columnsByName = new Map(config.columns.map((c) => [c.name, c]));

  it('has the columns the picker persists', () => {
    expect([...columnsByName.keys()].sort()).toEqual(
      [
        'code',
        'created_at',
        'created_by_id',
        'description',
        'display_order',
        'id',
        'label',
        'line_total',
        'override_unit_price',
        'qty',
        'quote_id',
        'service_item_id',
        'unit_price',
        'updated_at',
        'updated_by_id',
      ].sort()
    );
  });

  it('keeps money columns numeric and notNull where required', () => {
    const unitPrice = columnsByName.get('unit_price');
    const lineTotal = columnsByName.get('line_total');
    const override = columnsByName.get('override_unit_price');
    expect(unitPrice?.columnType).toBe('PgNumeric');
    expect(lineTotal?.columnType).toBe('PgNumeric');
    expect(override?.columnType).toBe('PgNumeric');
    // catalogue snapshot + computed total are required; the per-quote override
    // is nullable (absent until the coach tunes the price).
    expect(unitPrice?.notNull).toBe(true);
    expect(lineTotal?.notNull).toBe(true);
    expect(override?.notNull).toBe(false);
  });

  it('requires the catalogue snapshot fields, leaves description optional', () => {
    expect(columnsByName.get('code')?.notNull).toBe(true);
    expect(columnsByName.get('label')?.notNull).toBe(true);
    expect(columnsByName.get('qty')?.notNull).toBe(true);
    expect(columnsByName.get('quote_id')?.notNull).toBe(true);
    expect(columnsByName.get('description')?.notNull).toBe(false);
    expect(columnsByName.get('service_item_id')?.notNull).toBe(false);
  });

  it('declares the expected indexes', () => {
    const indexNames = config.indexes.map((i) => i.config.name).sort();
    expect(indexNames).toEqual(
      [
        'quote_line_items_created_by_id_idx',
        'quote_line_items_quote_id_idx',
        'quote_line_items_service_item_id_idx',
        'quote_line_items_updated_by_id_idx',
      ].sort()
    );
  });

  it('links quote_id (cascade) and service_item_id (set null)', () => {
    const fkTargets = config.foreignKeys.map((fk) => {
      const ref = fk.reference();
      return {
        column: ref.columns[0]?.name,
        table: getTableConfig(ref.foreignTable).name,
        onDelete: fk.onDelete,
      };
    });
    expect(fkTargets).toEqual(
      expect.arrayContaining([
        { column: 'quote_id', table: 'quotes', onDelete: 'cascade' },
        { column: 'service_item_id', table: 'service_items', onDelete: 'set null' },
      ])
    );
  });
});
