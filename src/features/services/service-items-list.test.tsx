import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { ServiceItemsList } from './service-items-list';
import type { ServiceItemAdminRow } from './queries';

// Node-env render check (no DOM): call the server component as a function and
// flatten its element tree's text leaves, then assert on the concatenated text.
// Mirrors `src/components/ui/token-pill.test.tsx`'s walk-the-tree approach.
function texts(node: unknown, out: string[] = []): string[] {
  if (node == null || typeof node === 'boolean') return out;
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    for (const c of node) texts(c, out);
    return out;
  }
  if (typeof node === 'object' && 'props' in (node as object)) {
    texts((node as ReactElement<{ children?: unknown }>).props?.children, out);
  }
  return out;
}
const flat = (items: ServiceItemAdminRow[]) => texts(ServiceItemsList({ items })).join('');

const row = (
  over: Partial<ServiceItemAdminRow> & { id: number; code: string },
): ServiceItemAdminRow => ({
  label: over.code,
  unitPrice: null,
  description: null,
  quickbooksId: null,
  archivedAt: null,
  ...over,
});

describe('ServiceItemsList', () => {
  it('renders catalog rows with price + linked/archived badges and a counts header', () => {
    const all = flat([
      row({ id: 1, code: 'base-event', label: 'Base Event', unitPrice: '6900.00', quickbooksId: '42' }),
      row({ id: 2, code: 'travel', label: 'Travel', unitPrice: null, archivedAt: new Date('2026-01-01') }),
    ]);
    expect(all).toContain('base-event');
    expect(all).toContain('Base Event');
    expect(all).toContain('$6900.00');
    expect(all).toContain('Linked'); // row 1 has quickbooks_id
    expect(all).toContain('variable'); // row 2 null price
    expect(all).toContain('Archived'); // row 2 archived
    expect(all).toContain('Active'); // row 1 not archived
    expect(all).toContain('2 items');
    expect(all).toContain('1 linked to QuickBooks');
    expect(all).toContain('1 archived');
  });

  it('shows an empty-state row when the catalog is empty', () => {
    const all = flat([]);
    expect(all).toContain('No service items in the catalog.');
    expect(all).toContain('0 items');
  });
});
