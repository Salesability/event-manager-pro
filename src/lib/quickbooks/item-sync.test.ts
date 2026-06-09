import { describe, expect, it, vi } from 'vitest';
import {
  type ExistingServiceItem,
  classifyItemSyncPlan,
  decodeItemSyncSummary,
  encodeItemSyncSummary,
  mapItemToServiceItem,
  slugifyItemCode,
} from './item-sync';
import type { QboItem } from './client';

// `item-sync` imports `@/lib/db` for the default executor; stub it so the module
// loads without a Postgres pool. The functions tested here are pure.
vi.mock('@/lib/db', () => ({ db: {} }));

describe('mapItemToServiceItem', () => {
  it('prefers Sku for code; maps Name/UnitPrice/Description; Service is syncable', () => {
    const item: QboItem = {
      Id: '10',
      Name: 'Record Retrieval',
      Sku: 'REC-RET',
      UnitPrice: 100,
      Description: 'Pulls records',
      Type: 'Service',
    };
    expect(mapItemToServiceItem(item)).toEqual({
      qbId: '10',
      code: 'REC-RET',
      label: 'Record Retrieval',
      unitPrice: '100.00',
      description: 'Pulls records',
      isSyncable: true,
    });
  });

  it('slugifies Name when Sku is blank; null UnitPrice → null; NonInventory is syncable', () => {
    const m = mapItemToServiceItem({ Id: '11', Name: 'On-Site Travel', Type: 'NonInventory' });
    expect(m.code).toBe('on-site-travel');
    expect(m.unitPrice).toBeNull();
    expect(m.description).toBeNull();
    expect(m.isSyncable).toBe(true);
  });

  it('marks Category / sub-item / parented / nameless items not syncable', () => {
    expect(mapItemToServiceItem({ Id: '1', Name: 'Cat', Type: 'Category' }).isSyncable).toBe(false);
    expect(mapItemToServiceItem({ Id: '2', Name: 'Sub', Type: 'Service', SubItem: true }).isSyncable).toBe(false);
    expect(
      mapItemToServiceItem({ Id: '3', Name: 'Child', Type: 'Service', ParentRef: { value: '2' } }).isSyncable,
    ).toBe(false);
    expect(mapItemToServiceItem({ Id: '4', Name: '', Type: 'Service' }).isSyncable).toBe(false);
  });
});

describe('slugifyItemCode', () => {
  it('lowercases, hyphenates non-alphanumerics, trims, falls back to "item"', () => {
    expect(slugifyItemCode('Record Retrieval')).toBe('record-retrieval');
    expect(slugifyItemCode('  A/B  C! ')).toBe('a-b-c');
    expect(slugifyItemCode('***')).toBe('item');
  });
});

describe('classifyItemSyncPlan', () => {
  const existing = (
    over: Partial<ExistingServiceItem> & { id: number; code: string },
  ): ExistingServiceItem => ({
    label: over.code,
    unitPrice: null,
    description: null,
    quickbooksId: null,
    archivedAt: null,
    ...over,
  });

  it('creates a QBO item with no local match', () => {
    const plan = classifyItemSyncPlan([{ Id: '10', Name: 'New SKU', Type: 'Service', UnitPrice: 50 }], []);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ action: 'create', qbId: '10', code: 'new-sku', unitPrice: '50.00' });
  });

  it('updates a linked row when fields differ; current when numerically identical', () => {
    const items: QboItem[] = [{ Id: '10', Name: 'Renamed', Type: 'Service', UnitPrice: 75 }];
    const diff = existing({ id: 1, code: 'rec', label: 'Old', unitPrice: '50.00', quickbooksId: '10' });
    expect(classifyItemSyncPlan(items, [diff])[0]).toMatchObject({
      action: 'update',
      serviceItemId: 1,
      label: 'Renamed',
      unitPrice: '75.00',
      code: 'rec', // immutable — existing code kept
    });

    const same = existing({ id: 1, code: 'rec', label: 'Renamed', unitPrice: '75.00', quickbooksId: '10' });
    expect(classifyItemSyncPlan(items, [same])[0]).toMatchObject({ action: 'current' }); // 75 === 75.00
  });

  it('revives (update) an archived linked row that QBO still has active', () => {
    const items: QboItem[] = [{ Id: '10', Name: 'Back', Type: 'Service', UnitPrice: 10 }];
    const archived = existing({
      id: 1,
      code: 'back',
      label: 'Back',
      unitPrice: '10.00',
      quickbooksId: '10',
      archivedAt: new Date('2026-01-01'),
    });
    expect(classifyItemSyncPlan(items, [archived])[0]).toMatchObject({ action: 'update' });
  });

  it('archives a linked row absent from the active QBO set', () => {
    const linked = existing({ id: 2, code: 'gone', quickbooksId: '99' });
    const plan = classifyItemSyncPlan([{ Id: '10', Name: 'Other', Type: 'Service' }], [linked]);
    expect(plan.find((r) => r.serviceItemId === 2)).toMatchObject({ action: 'archive', qbId: '99' });
  });

  it('purges a pre-existing unlinked (legacy) row', () => {
    const legacy = existing({ id: 3, code: 'legacy', quickbooksId: null });
    const plan = classifyItemSyncPlan([], [legacy]);
    expect(plan).toEqual([
      { action: 'purge', code: 'legacy', label: 'legacy', unitPrice: null, description: null, serviceItemId: 3 },
    ]);
  });

  it('skips non-syncable items and derived-code collisions among creates', () => {
    const items: QboItem[] = [
      { Id: '10', Name: 'Dup Name', Type: 'Service' },
      { Id: '11', Name: 'Dup Name', Type: 'Service' }, // same slug → second skipped
      { Id: '12', Name: 'A Category', Type: 'Category' }, // non-syncable
    ];
    const plan = classifyItemSyncPlan(items, []);
    expect(plan.filter((r) => r.action === 'create')).toHaveLength(1);
    expect(plan.filter((r) => r.action === 'skip')).toHaveLength(2);
  });

  it('does not let a create collide with an existing LINKED code', () => {
    const linked = existing({ id: 1, code: 'taken', quickbooksId: '1' });
    const items: QboItem[] = [
      { Id: '1', Name: 'Taken', Type: 'Service' }, // matches linked by qbId → current/update
      { Id: '2', Name: 'taken', Type: 'Service' }, // slug 'taken' collides with linked code
    ];
    const plan = classifyItemSyncPlan(items, [linked]);
    expect(plan.find((r) => r.qbId === '2')).toMatchObject({ action: 'skip', reason: 'code-collision' });
  });
});

describe('item sync summary round-trip', () => {
  it('encodes + decodes created.updated.archived.purged', () => {
    expect(encodeItemSyncSummary({ created: 3, updated: 2, archived: 1, purged: 5 })).toBe('3.2.1.5');
    expect(decodeItemSyncSummary('3.2.1.5')).toEqual({ created: 3, updated: 2, archived: 1, purged: 5 });
  });
  it('rejects malformed params', () => {
    expect(decodeItemSyncSummary('1.2.3')).toBeNull(); // too few
    expect(decodeItemSyncSummary('1.2.3.4.5')).toBeNull(); // too many
    expect(decodeItemSyncSummary('1x.2.3.4')).toBeNull(); // non-digit
    expect(decodeItemSyncSummary('1e9.0.0.0')).toBeNull();
  });
});
