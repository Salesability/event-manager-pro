import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks/scaffolding identical in shape to quotes/actions.test.ts + people's.
// Targets the dealer-side surface in `src/features/schedule/actions.ts` and
// covers the 0035 Phase 2 changes: `status` + `acquiredVia` on
// `createDealer` / `updateDealer`, plus the new `convertProspectToActive`.

const mocks = vi.hoisted(() => ({
  assertCan: vi.fn(),
  getUser: vi.fn(),
  loadCurrentMembership: vi.fn(),
  recordAudit: vi.fn(),
  // 0084 — the best-effort app→QBO auto-push deps wired into the dealer actions.
  getValidAccessToken: vi.fn(),
  pushDealerToQuickbooks: vi.fn(),
  loadDealer: vi.fn(),
  // 0085 — the create-time dedup lookups. Mocked so the action's dup checks are
  // driven per-test without the real db-stub needing the join chain.
  findExistingContactByIdentifier: vi.fn(),
  findExistingDealerByNameAddress: vi.fn(),
  dbResults: [] as unknown[][],
  inserts: [] as Array<{ table: string; values: unknown }>,
  updates: [] as Array<{ table: string; patch: unknown }>,
}));

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    const err = new Error(`NEXT_REDIRECT;replace;${path};307;`);
    (err as Error & { digest: string }).digest = `NEXT_REDIRECT;replace;${path};307;`;
    throw err;
  },
}));
vi.mock('@/lib/auth/assert-can', () => ({ assertCan: mocks.assertCan }));
vi.mock('@/lib/supabase/session', () => ({ getUser: mocks.getUser }));
vi.mock('@/lib/auth/load-team-membership', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth/load-team-membership')>();
  return { ...real, loadCurrentMembership: mocks.loadCurrentMembership };
});
vi.mock('@/features/audit/actions', () => ({ recordAudit: mocks.recordAudit }));
// 0084 — stub the QBO auto-push surface so the dealer actions can be exercised
// without a live connection. `@/features/schedule/queries` and the relative
// `./queries` import inside `schedule/actions.ts` resolve to the same module, so
// this mock intercepts the action's `loadDealer` call.
vi.mock('@/lib/quickbooks/connection', () => ({ getValidAccessToken: mocks.getValidAccessToken }));
vi.mock('@/lib/quickbooks/dealer-push', () => ({
  pushDealerToQuickbooks: mocks.pushDealerToQuickbooks,
}));
vi.mock('@/features/schedule/queries', () => ({ loadDealer: mocks.loadDealer }));
// 0085 — stub the dedup lookups so each test controls match/no-match directly.
vi.mock('@/features/dealers/dedup', () => ({
  findExistingContactByIdentifier: mocks.findExistingContactByIdentifier,
  findExistingDealerByNameAddress: mocks.findExistingDealerByNameAddress,
}));

vi.mock('@/lib/db', () => {
  function tableName(t: unknown): string {
    if (typeof t === 'object' && t != null) {
      const sym = Object.getOwnPropertySymbols(t).find(
        (s) => s.description === 'drizzle:Name',
      );
      if (sym) return String((t as Record<symbol, unknown>)[sym]);
    }
    return 'unknown';
  }
  const txStub = {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        mocks.inserts.push({ table: tableName(table), values });
        return {
          returning: async () => mocks.dbResults.shift() ?? [{ id: 999 }],
          // 0085 — the dealer-side `teamMemberRoles` insert upserts now.
          onConflictDoUpdate: () => Promise.resolve(),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (patch: unknown) => {
        mocks.updates.push({ table: tableName(table), patch });
        return {
          where: () => {
            const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
            return {
              returning: () => next(),
              then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
            };
          },
        };
      },
    }),
    select: () => ({
      from: () => {
        const next = () => Promise.resolve(mocks.dbResults.shift() ?? []);
        const terminal = {
          limit: () => next(),
          orderBy: () => next(),
          then: (onFulfilled: (v: unknown[]) => unknown) => next().then(onFulfilled),
        };
        return { where: () => terminal };
      },
    }),
  };
  return {
    db: {
      ...txStub,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(txStub),
    },
  };
});

import { convertProspectToActive, createDealer, updateDealer } from '../schedule/actions';

async function call<T>(
  p: Promise<{ data?: T; serverError?: string; validationErrors?: unknown } | undefined | null>,
): Promise<T> {
  const r = await p;
  if (!r) throw new Error('action returned null/undefined');
  if (r.serverError) throw new Error(`unexpected serverError: ${r.serverError}`);
  if (r.validationErrors) {
    throw new Error(`unexpected validationErrors: ${JSON.stringify(r.validationErrors)}`);
  }
  if (r.data === undefined) throw new Error('action returned undefined data');
  return r.data;
}

function fd(entries: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertCan.mockResolvedValue({ id: 'admin-uuid', app_metadata: { role: 'admin' } });
  mocks.getUser.mockResolvedValue({
    id: 'admin-uuid',
    email: 'admin@test.local',
    app_metadata: { role: 'admin' },
  });
  mocks.loadCurrentMembership.mockResolvedValue(null);
  // 0084 defaults: QBO "connected" + push resolves; loadDealer returns nothing so
  // the edit/activate paths don't push unless a test sets up a dealer. (The
  // existing create tests with status='active' will invoke the push — harmless,
  // unasserted.)
  mocks.getValidAccessToken.mockResolvedValue({ realmId: 'realm-1', accessToken: 'access-1' });
  mocks.pushDealerToQuickbooks.mockResolvedValue({ action: 'created', qbId: 'qb-1' });
  mocks.loadDealer.mockResolvedValue(null);
  // 0085 defaults: no duplicate found, so the existing create tests insert as
  // before. Phase 2/3/4 tests override these per-case.
  mocks.findExistingContactByIdentifier.mockResolvedValue(null);
  mocks.findExistingDealerByNameAddress.mockResolvedValue(null);
  mocks.dbResults = [];
  mocks.inserts = [];
  mocks.updates = [];
});

// 0084 — a `loadDealer`-shaped row for the edit/activate push-gating tests.
function dealerRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 42,
    publicId: 'pub-42',
    name: 'Acme Motors',
    address: null,
    province: null,
    status: 'active',
    acquiredVia: null,
    archivedAt: null,
    quickbooksId: null,
    contactId: null,
    contactFirstName: null,
    contactLastName: null,
    primaryEmail: null,
    primaryPhone: null,
    ...over,
  };
}

describe('createDealer', () => {
  it("defaults status='active' when no status submitted (back-office add)", async () => {
    const result = await call(createDealer(fd({ name: 'Acme Motors' })));
    expect(result).toEqual({ ok: true, dealerId: 999 });
    const dealerInsert = mocks.inserts.find((i) => i.table === 'dealers');
    const values = dealerInsert!.values as Record<string, unknown>;
    expect(values.status).toBe('active');
    expect(values.acquiredVia).toBeNull();
  });

  it("accepts explicit status='prospect' (inline composer path)", async () => {
    await call(createDealer(fd({ name: 'Acme', status: 'prospect' })));
    const dealerInsert = mocks.inserts.find((i) => i.table === 'dealers');
    expect((dealerInsert!.values as Record<string, unknown>).status).toBe('prospect');
  });

  it('persists acquiredVia text', async () => {
    await call(
      createDealer(fd({ name: 'Acme', status: 'prospect', acquiredVia: 'Book Your Event form' })),
    );
    const dealerInsert = mocks.inserts.find((i) => i.table === 'dealers');
    expect((dealerInsert!.values as Record<string, unknown>).acquiredVia).toBe(
      'Book Your Event form',
    );
  });

  it('rejects invalid status enum value', async () => {
    const result = await call(createDealer(fd({ name: 'Acme', status: 'bogus' })));
    expect(result).toMatchObject({ error: 'Invalid dealer status.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('rejects acquiredVia over 200 chars', async () => {
    const result = await call(
      createDealer(fd({ name: 'Acme', acquiredVia: 'x'.repeat(201) })),
    );
    expect(result).toMatchObject({
      error: 'Acquired-via must be 200 characters or fewer.',
    });
    expect(mocks.inserts).toHaveLength(0);
  });

  it('still rejects when name is missing', async () => {
    const result = await call(createDealer(fd({})));
    expect(result).toMatchObject({ error: 'Dealership name is required.' });
    expect(mocks.inserts).toHaveLength(0);
  });

  // 0045 Phase 2 — schema-as-contract: action returns `fieldErrors` alongside
  // `error` so a future form consumer can route per-field via `setError`.
  it('surfaces per-field errors on safeParse failure', async () => {
    const result = (await call(
      createDealer(fd({ name: 'Acme', status: 'bogus', acquiredVia: 'x'.repeat(201) })),
    )) as { error: string; fieldErrors: Record<string, string[]> };
    expect(result.fieldErrors.status).toEqual(['Invalid dealer status.']);
    expect(result.fieldErrors.acquiredVia).toEqual([
      'Acquired-via must be 200 characters or fewer.',
    ]);
  });

  // 0085 Phase 2 — contact email/phone dedup guard.
  it('returns a contact duplicate (no insert) when the email already belongs to another contact', async () => {
    mocks.findExistingContactByIdentifier.mockResolvedValue({
      contactId: 7,
      firstName: 'Jane',
      lastName: 'Smith',
      matchedKind: 'email',
      matchedValue: 'jane@x.io',
    });
    const result = await call(
      createDealer(
        fd({ name: 'Acme', contactFirst: 'Jane', contactLast: 'Doe', contactEmail: 'jane@x.io' }),
      ),
    );
    expect(result).toEqual({
      duplicate: { kind: 'contact', via: 'email', contactId: 7, name: 'Jane Smith', matchedValue: 'jane@x.io' },
    });
    // Returned before the transaction — nothing inserted.
    expect(mocks.inserts).toHaveLength(0);
  });

  it('reuseContactId links the existing contact instead of inserting a new one', async () => {
    const result = await call(
      createDealer(
        fd({
          name: 'Acme',
          contactFirst: 'Jane',
          contactLast: 'Doe',
          contactEmail: 'jane@x.io',
          reuseContactId: '7',
        }),
      ),
    );
    expect(result).toEqual({ ok: true, dealerId: 999 });
    // No new contact row; the dealer link points at the reused contact.
    expect(mocks.inserts.find((i) => i.table === 'contacts')).toBeUndefined();
    const link = mocks.inserts.find((i) => i.table === 'dealer_contacts');
    expect((link!.values as Record<string, unknown>).contactId).toBe(7);
    // Dedup check is skipped once a reuse decision is present.
    expect(mocks.findExistingContactByIdentifier).not.toHaveBeenCalled();
  });

  it('createAnyway skips the dedup check and inserts a fresh contact', async () => {
    mocks.findExistingContactByIdentifier.mockResolvedValue({
      contactId: 7,
      firstName: 'Jane',
      lastName: 'Smith',
      matchedKind: 'email',
      matchedValue: 'jane@x.io',
    });
    const result = await call(
      createDealer(
        fd({
          name: 'Acme',
          contactFirst: 'Jane',
          contactLast: 'Doe',
          contactEmail: 'jane@x.io',
          createAnyway: '1',
        }),
      ),
    );
    expect(result).toEqual({ ok: true, dealerId: 999 });
    expect(mocks.findExistingContactByIdentifier).not.toHaveBeenCalled();
    expect(mocks.inserts.find((i) => i.table === 'contacts')).toBeDefined();
  });
});

describe('updateDealer', () => {
  it("omits status from SET when not submitted (no clobber of concurrent flip)", async () => {
    // Guarded UPDATE returns one row → success.
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Renamed' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect(dealerUpdate!.patch as Record<string, unknown>).not.toHaveProperty('status');
  });

  it('omits acquiredVia from SET when not submitted (no accidental clear)', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Renamed' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect(dealerUpdate!.patch as Record<string, unknown>).not.toHaveProperty('acquiredVia');
  });

  it("flips status when explicitly submitted", async () => {
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Acme', status: 'active' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect((dealerUpdate!.patch as Record<string, unknown>).status).toBe('active');
  });

  it('clears acquiredVia when an empty value is explicitly submitted', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Acme', acquiredVia: '' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect((dealerUpdate!.patch as Record<string, unknown>).acquiredVia).toBeNull();
  });

  it('rejects invalid status on update', async () => {
    const result = await call(
      updateDealer(fd({ id: '42', name: 'Acme', status: 'bogus' })),
    );
    expect(result).toMatchObject({ error: 'Invalid dealer status.' });
    expect(mocks.updates).toHaveLength(0);
  });

  it("treats status='' as absent (preserve existing status, omit from patch)", async () => {
    // Regression guard for 0045 eval Codex Medium: empty-string status from a
    // programmatic caller would otherwise fail `z.enum(...).optional()`. The
    // action layer normalises `status='' → absent` before safeParse.
    mocks.dbResults.push([{ id: 42 }]);
    await call(updateDealer(fd({ id: '42', name: 'Acme', status: '' })));
    const dealerUpdate = mocks.updates.find((u) => u.table === 'dealers');
    expect(dealerUpdate!.patch as Record<string, unknown>).not.toHaveProperty('status');
  });

  it('returns "Dealer not found" when the guarded UPDATE matches no row (archived or missing)', async () => {
    mocks.dbResults.push([]);
    const result = await call(updateDealer(fd({ id: '99', name: 'Acme' })));
    expect(result).toEqual({ error: 'Dealer not found.' });
  });

  // 0085 Phase 2 (D4) — an inline-contact email collision surfaces the owner as
  // an informational duplicate, not the generic "already linked" toast.
  it('surfaces a contact duplicate when the edited email belongs to another contact', async () => {
    mocks.findExistingContactByIdentifier.mockResolvedValue({
      contactId: 7,
      firstName: 'Jane',
      lastName: 'Smith',
      matchedKind: 'email',
      matchedValue: 'jane@x.io',
    });
    // dbResults order, in tx call sequence:
    //  1) guarded dealer UPDATE → one row (found)
    //  2) existing dealer_contacts links → none (new-contact branch)
    //  3) contact insert returning → the new contact id
    //  4) swapPrimaryIdentifier(email) existing-primary select → none
    //  5) swapPrimaryIdentifier(email) conflict select → a *different* contact → throw
    mocks.dbResults.push([{ id: 42 }], [], [{ id: 55 }], [], [{ contactId: 7 }]);
    const result = await call(
      updateDealer(
        fd({ id: '42', name: 'Acme', contactFirst: 'Jane', contactLast: 'Doe', contactEmail: 'jane@x.io' }),
      ),
    );
    expect(result).toEqual({
      duplicate: { kind: 'contact', via: 'email', contactId: 7, name: 'Jane Smith', matchedValue: 'jane@x.io' },
    });
  });
});

describe('convertProspectToActive', () => {
  it('flips prospect → active and emits audit', async () => {
    mocks.dbResults.push([{ id: 7 }]); // guarded UPDATE returns one row
    const result = await call(convertProspectToActive(fd({ id: '7' })));
    expect(result).toEqual({ ok: true });
    const patch = mocks.updates[0].patch as Record<string, unknown>;
    expect(patch.status).toBe('active');
    expect(patch.updatedById).toBe('admin-uuid');
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: 'dealer.activated',
      targetTable: 'dealers',
      targetId: 7,
      payload: { from: 'prospect' },
    });
  });

  it('is a no-op when the dealer is already active (no audit emit)', async () => {
    mocks.dbResults.push([]); // guarded UPDATE matches nothing → already-active or archived
    const result = await call(convertProspectToActive(fd({ id: '7' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('is a no-op when the dealer is archived (no audit emit)', async () => {
    mocks.dbResults.push([]); // guarded UPDATE with archivedAt IS NULL won't match
    const result = await call(convertProspectToActive(fd({ id: '7' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it('rejects invalid id without a db round-trip', async () => {
    const result = await call(convertProspectToActive(fd({})));
    expect(result).toEqual({ error: 'Invalid dealer id.' });
    expect(mocks.updates).toHaveLength(0);
  });
});

// 0084 — best-effort app→QBO auto-push on create / activate / edit. The push
// CORE (Customer create+backfill, update-branch SyncToken read-before-write) is
// covered in tests/integration/dealer-push.test.ts; these assert the ACTION-level
// wiring: which paths invoke the push, the inline-built payload, the D2 edit
// gating, and that a missing/erroring QuickBooks never blocks the dealer save.
describe('auto-push to QuickBooks (0084)', () => {
  it('createDealer pushes an ACTIVE dealer, carrying the inline contact name/email/phone', async () => {
    const result = await call(
      createDealer(
        fd({
          name: 'Acme Motors', // default status = active
          contactFirst: 'Dana',
          contactLast: 'Reyes',
          contactEmail: 'Dana@Acme.Test',
          contactPhone: '555-1000',
        }),
      ),
    );
    expect(result).toEqual({ ok: true, dealerId: 999 });
    expect(mocks.pushDealerToQuickbooks).toHaveBeenCalledTimes(1);
    const [dealerArg, realmId, accessToken] = mocks.pushDealerToQuickbooks.mock.calls[0];
    expect(dealerArg).toMatchObject({
      id: 999,
      name: 'Acme Motors',
      quickbooksId: null,
      contactFirstName: 'Dana',
      contactLastName: 'Reyes',
      primaryEmail: 'dana@acme.test', // lowercased by the action
      primaryPhone: '555-1000',
    });
    expect(realmId).toBe('realm-1');
    expect(accessToken).toBe('access-1');
  });

  it('createDealer does NOT push a PROSPECT dealer', async () => {
    await call(createDealer(fd({ name: 'Lead Co', status: 'prospect' })));
    expect(mocks.pushDealerToQuickbooks).not.toHaveBeenCalled();
  });

  it('createDealer still resolves ok when QuickBooks is not connected (best-effort swallow)', async () => {
    mocks.getValidAccessToken.mockRejectedValue(new Error('QuickBooks is not connected.'));
    const result = await call(createDealer(fd({ name: 'Acme Motors' })));
    expect(result).toEqual({ ok: true, dealerId: 999 });
    expect(mocks.pushDealerToQuickbooks).not.toHaveBeenCalled();
  });

  it('createDealer still resolves ok when the QBO push throws (D1 6240 → leave unlinked)', async () => {
    mocks.pushDealerToQuickbooks.mockRejectedValue(new Error('Intuit 6240: duplicate name'));
    const result = await call(createDealer(fd({ name: 'Acme Motors' })));
    expect(result).toEqual({ ok: true, dealerId: 999 });
    expect(mocks.pushDealerToQuickbooks).toHaveBeenCalledTimes(1);
  });

  it('convertProspectToActive pushes the freshly-activated dealer', async () => {
    mocks.dbResults.push([{ id: 7 }]); // guarded UPDATE returns one row
    const activated = dealerRow({ id: 7, status: 'active', quickbooksId: null });
    mocks.loadDealer.mockResolvedValue(activated);
    const result = await call(convertProspectToActive(fd({ id: '7' })));
    expect(result).toEqual({ ok: true });
    expect(mocks.loadDealer).toHaveBeenCalledWith(7);
    expect(mocks.pushDealerToQuickbooks).toHaveBeenCalledTimes(1);
    expect(mocks.pushDealerToQuickbooks.mock.calls[0][0]).toBe(activated);
  });

  it('convertProspectToActive does NOT push when the flip is a no-op (already active/archived)', async () => {
    mocks.dbResults.push([]); // guarded UPDATE matches nothing
    await call(convertProspectToActive(fd({ id: '7' })));
    expect(mocks.loadDealer).not.toHaveBeenCalled();
    expect(mocks.pushDealerToQuickbooks).not.toHaveBeenCalled();
  });

  it('convertProspectToActive still resolves ok when the QBO push throws (best-effort)', async () => {
    mocks.dbResults.push([{ id: 7 }]);
    mocks.loadDealer.mockResolvedValue(dealerRow({ id: 7, status: 'active' }));
    mocks.pushDealerToQuickbooks.mockRejectedValue(new Error('QBO 500'));
    const result = await call(convertProspectToActive(fd({ id: '7' })));
    expect(result).toEqual({ ok: true });
  });

  it('updateDealer pushes a LINKED dealer even when it is a prospect (D2 = active OR linked)', async () => {
    mocks.dbResults.push([{ id: 42 }]); // guarded UPDATE matches
    const linkedProspect = dealerRow({ status: 'prospect', quickbooksId: 'QB-42' });
    mocks.loadDealer.mockResolvedValue(linkedProspect);
    await call(updateDealer(fd({ id: '42', name: 'Acme Motors' })));
    expect(mocks.pushDealerToQuickbooks).toHaveBeenCalledTimes(1);
    expect(mocks.pushDealerToQuickbooks.mock.calls[0][0]).toBe(linkedProspect);
  });

  it('updateDealer pushes an ACTIVE but unlinked dealer (create branch → auto-link)', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    mocks.loadDealer.mockResolvedValue(dealerRow({ status: 'active', quickbooksId: null }));
    await call(updateDealer(fd({ id: '42', name: 'Acme Motors' })));
    expect(mocks.pushDealerToQuickbooks).toHaveBeenCalledTimes(1);
  });

  it('updateDealer does NOT push a prospect + unlinked dealer (D2)', async () => {
    mocks.dbResults.push([{ id: 42 }]);
    mocks.loadDealer.mockResolvedValue(dealerRow({ status: 'prospect', quickbooksId: null }));
    await call(updateDealer(fd({ id: '42', name: 'Lead Co' })));
    expect(mocks.pushDealerToQuickbooks).not.toHaveBeenCalled();
  });

  it('updateDealer does NOT reach the push when the dealer is not found', async () => {
    mocks.dbResults.push([]); // guarded UPDATE matches no row
    const result = await call(updateDealer(fd({ id: '99', name: 'Acme' })));
    expect(result).toEqual({ error: 'Dealer not found.' });
    expect(mocks.loadDealer).not.toHaveBeenCalled();
    expect(mocks.pushDealerToQuickbooks).not.toHaveBeenCalled();
  });
});
