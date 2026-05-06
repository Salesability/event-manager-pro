'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ColumnFiltersState, FilterFn } from '@tanstack/react-table';
import { Dialog } from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';
import { toast } from '@/components/ui/toaster';
import { archivePerson, createPerson, updatePerson } from '@/features/people/actions';
import type {
  AdminPersonRow,
  DealerContactRole,
  DealerLink,
} from '@/features/people/queries';
import { buildPeopleColumns } from '@/features/people/people-columns';
import type { Dealer } from '@/features/schedule/queries';

// Cross-column substring search for the toolbar input. Hits displayName,
// primary email, and any linked dealer name — dealer search by typing the
// dealership name was a stated muscle-memory want.
const peopleGlobalFilterFn: FilterFn<AdminPersonRow> = (row, _columnId, filterValue) => {
  const q = String(filterValue ?? '').toLowerCase().trim();
  if (!q) return true;
  const p = row.original;
  if (p.displayName.toLowerCase().includes(q)) return true;
  if (p.email && p.email.toLowerCase().includes(q)) return true;
  if (p.dealerLinks.some((l) => l.dealerName.toLowerCase().includes(q))) return true;
  return false;
};

function toggleRoleFilter(
  prev: ColumnFiltersState,
  role: 'coach' | 'admin',
  enabled: boolean,
): ColumnFiltersState {
  const others = prev.filter((f) => f.id !== 'roles');
  const current =
    (prev.find((f) => f.id === 'roles')?.value as string[] | undefined) ?? [];
  const next = enabled
    ? Array.from(new Set([...current, role]))
    : current.filter((r) => r !== role);
  if (next.length === 0) return others;
  return [...others, { id: 'roles', value: next }];
}

function toggleCustomerFilter(
  prev: ColumnFiltersState,
  enabled: boolean,
): ColumnFiltersState {
  const others = prev.filter((f) => f.id !== 'dealerLinks');
  if (enabled) return [...others, { id: 'dealerLinks', value: 'has-customer' }];
  return others;
}

const inputClass =
  'min-w-0 rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20';

const headerAddClass =
  'rounded-lg border border-accent/40 bg-white px-3 py-1 text-xs font-semibold text-accent transition hover:border-accent hover:bg-accent/10';

const rowEditClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy';

const rowDeleteClass =
  'rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-bold text-status-red transition hover:border-status-red hover:bg-status-red/10 disabled:cursor-not-allowed disabled:opacity-50';

const submitClass =
  'rounded-lg bg-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-navy-light disabled:cursor-not-allowed disabled:opacity-60';

function pillClass(active: boolean): string {
  return active
    ? 'rounded-full border border-accent bg-accent/15 px-3 py-1 text-xs font-semibold text-accent transition'
    : 'rounded-full border border-stone-200 bg-white px-3 py-1 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy';
}

const DEALER_CONTACT_ROLES: DealerContactRole[] = ['customer', 'staff', 'prospect'];

export function PeopleAdmin({
  people,
  dealers,
}: {
  people: AdminPersonRow[];
  dealers: Dealer[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPersonRow | null>(null);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [, startTransition] = useTransition();

  // Hide the `Last sign-in` column when no row in the population has app
  // access — saves the column from being a wall of em-dashes for chunks
  // that are mostly customer-side contacts.
  const columnVisibility = useMemo(
    () => ({ lastSignInAt: people.some((p) => p.hasAppAccess) }),
    [people],
  );

  const rolesFilterValue =
    (columnFilters.find((f) => f.id === 'roles')?.value as string[] | undefined) ?? [];
  const coachActive = rolesFilterValue.includes('coach');
  const adminActive = rolesFilterValue.includes('admin');
  const customerActive = columnFilters.some(
    (f) => f.id === 'dealerLinks' && f.value === 'has-customer',
  );
  const isFiltered = globalFilter.trim().length > 0 || columnFilters.length > 0;
  const clearFilters = () => {
    setGlobalFilter('');
    setColumnFilters([]);
  };

  function archive(person: AdminPersonRow) {
    if (!confirm(buildArchiveConfirmMessage(person))) {
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set('contactId', String(person.contactId));
      const result = await archivePerson(fd);
      if ('ok' in result) {
        if (result.warning) toast.error(result.warning);
        else toast.success('Person archived');
        router.refresh();
      } else {
        toast.error(result.error);
        router.refresh();
      }
    });
  }

  const columns = useMemo(
    () => buildPeopleColumns({ onEdit: setEditing, onArchive: archive }),
    // Intentionally re-build on every render — the closures capture state
    // setters and `archive`, which are stable, but referencing `archive`
    // here would need a dep array that ESLint can't statically verify
    // since `archive` is defined per-render. Cheap given the column count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-stone-500">{people.length} people</p>
        </div>
        <button onClick={() => setAddOpen(true)} className={headerAddClass}>
          + Add Person
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search by name, email, or dealer…"
          aria-label="Search people"
          className="min-w-[16rem] flex-1 rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-sm text-stone-800 outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20"
        />
        <button
          type="button"
          aria-pressed={coachActive}
          onClick={() =>
            setColumnFilters((prev) => toggleRoleFilter(prev, 'coach', !coachActive))
          }
          className={pillClass(coachActive)}
        >
          Coach
        </button>
        <button
          type="button"
          aria-pressed={adminActive}
          onClick={() =>
            setColumnFilters((prev) => toggleRoleFilter(prev, 'admin', !adminActive))
          }
          className={pillClass(adminActive)}
        >
          Admin
        </button>
        <button
          type="button"
          aria-pressed={customerActive}
          onClick={() =>
            setColumnFilters((prev) => toggleCustomerFilter(prev, !customerActive))
          }
          className={pillClass(customerActive)}
        >
          Customer-side
        </button>
      </div>

      <div className="mt-3">
        <DataTable
          columns={columns}
          data={people}
          initialSorting={[{ id: 'displayName', desc: false }]}
          columnVisibility={columnVisibility}
          globalFilter={globalFilter}
          onGlobalFilterChange={setGlobalFilter}
          columnFilters={columnFilters}
          onColumnFiltersChange={setColumnFilters}
          globalFilterFn={peopleGlobalFilterFn}
          emptyState={
            isFiltered ? (
              <span className="inline-flex items-center gap-2">
                <span>No people match.</span>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs font-medium text-stone-600 transition hover:border-navy hover:text-navy"
                >
                  Clear filters
                </button>
              </span>
            ) : (
              'No people yet.'
            )
          }
        />
      </div>

      <Dialog.Root open={addOpen} onClose={setAddOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Add Person</Dialog.Title>
          <Dialog.Description>
            Adds a contact. Picking Admin or Coach also creates a sign-in at this email.
          </Dialog.Description>
          {addOpen && <PersonForm mode="create" dealers={dealers} onSuccess={() => setAddOpen(false)} />}
        </Dialog.Panel>
      </Dialog.Root>

      <Dialog.Root open={editing != null} onClose={() => setEditing(null)}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Edit Person — {editing?.displayName}</Dialog.Title>
          {editing && (
            <PersonForm
              mode="edit"
              person={editing}
              dealers={dealers}
              onSuccess={() => setEditing(null)}
            />
          )}
        </Dialog.Panel>
      </Dialog.Root>
    </section>
  );
}

// Compose the archive confirm message from the row's actual facets so the
// admin sees exactly what's about to disappear: each active role, each
// dealer relationship (with role), and the auth-side ban if applicable.
// Falls back to a "nothing to remove" phrasing for orphan contacts.
function buildArchiveConfirmMessage(person: AdminPersonRow): string {
  const facets: string[] = [];
  for (const role of person.roles) facets.push(`drop ${role} role`);
  for (const link of person.dealerLinks) {
    facets.push(`end relationship with ${link.dealerName} (${link.role})`);
  }
  if (person.hasAppAccess) {
    const email = person.authUser?.email ?? person.email;
    facets.push(email ? `ban sign-in for ${email}` : 'ban sign-in account');
  }
  if (facets.length === 0) {
    return `Archive ${person.displayName}? No active roles or relationships to remove. The contact record stays.`;
  }
  const list =
    facets.length === 1
      ? facets[0]
      : facets.length === 2
        ? `${facets[0]} and ${facets[1]}`
        : `${facets.slice(0, -1).join(', ')}, and ${facets[facets.length - 1]}`;
  return `This archive will: ${list}. The contact record stays. Continue?`;
}

type DealerLinkDraft = { dealerId: string; role: DealerContactRole };

function dealerLinksFromPerson(person?: AdminPersonRow): DealerLinkDraft[] {
  if (!person) return [];
  return person.dealerLinks.map<DealerLinkDraft>((d: DealerLink) => ({
    dealerId: String(d.dealerId),
    role: d.role,
  }));
}

type PersonFormState =
  | { ok: true; contactId?: number; warning?: string }
  | { error: string }
  | null;

function PersonForm({
  mode,
  person,
  dealers,
  onSuccess,
}: {
  mode: 'create' | 'edit';
  person?: AdminPersonRow;
  dealers: Dealer[];
  onSuccess: () => void;
}) {
  const router = useRouter();
  const [admin, setAdmin] = useState(person?.roles.includes('admin') ?? false);
  const [coach, setCoach] = useState(person?.roles.includes('coach') ?? false);
  const [dealer, setDealer] = useState(person?.roles.includes('dealer') ?? false);
  const [dealerLinks, setDealerLinks] = useState<DealerLinkDraft[]>(
    dealerLinksFromPerson(person),
  );

  // App access is derived, not toggled. The convention going forward is
  // "everyone who needs a sign-in has one by default" — picking Admin or
  // Coach implies App access, leaving both unchecked (e.g. a dealer-side
  // contact) leaves the contact sign-in-less. The `dealer` role is
  // deliberately excluded — dealer-side staff are them-side and don't
  // get auth.users rows.
  const wantsAppAccess = admin || coach;
  const hasAnyRole = admin || coach || dealer;

  function setDealerChecked(checked: boolean) {
    setDealer(checked);
    // Clear pending dealer-link rows so a stale draft doesn't survive when
    // the role is unticked — the section is hidden and the form should not
    // submit links the user can no longer see.
    if (!checked) setDealerLinks([]);
  }

  const action = mode === 'create' ? createPerson : updatePerson;
  const [state, formAction, pending] = useActionState<PersonFormState, FormData>(
    async (_prev, fd) => {
      // Destructive-edit guard: saving with neither Admin nor Coach checked
      // bans the existing auth user. Triggered even if `dealer` is ticked,
      // because dealer alone doesn't grant app access. Confirm before
      // letting the action run. Returning null leaves state unchanged so
      // no toast fires.
      if (mode === 'edit' && person?.hasAppAccess && !wantsAppAccess) {
        const firstName = String(fd.get('firstName') ?? '').trim();
        const lastName = String(fd.get('lastName') ?? '').trim();
        const ok = window.confirm(
          `Saving will end app access for ${firstName} ${lastName} and ban their sign-in account. The contact record stays. Continue?`,
        );
        if (!ok) return null;
      }
      return action(fd);
    },
    null,
  );

  useEffect(() => {
    if (!state) return;
    if ('ok' in state) {
      if (state.warning) {
        // Partial success — DB committed, auth-side step had a problem.
        // Still close + refresh; surface the warning so the admin knows
        // what to retry.
        toast.error(state.warning);
      } else {
        toast.success(mode === 'create' ? 'Person added' : 'Person updated');
      }
      router.refresh();
      onSuccess();
    } else {
      // Hard failure — keep the dialog open. Refresh anyway because some
      // error paths revalidate (e.g. race-loss bans the just-created auth
      // user); the table should reflect that.
      toast.error(state.error);
      router.refresh();
    }
  }, [state, mode, router, onSuccess]);

  function setDealerLink(i: number, patch: Partial<DealerLinkDraft>) {
    setDealerLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addDealerLink() {
    setDealerLinks((prev) => [...prev, { dealerId: '', role: 'staff' }]);
  }

  function removeDealerLink(i: number) {
    setDealerLinks((prev) => prev.filter((_, idx) => idx !== i));
  }

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      {mode === 'edit' && person && (
        <input type="hidden" name="contactId" value={person.contactId} />
      )}
      {wantsAppAccess && <input type="hidden" name="appAccess" value="1" />}
      {/* Hidden role inputs — restore the wire format `parseRolesField` reads
          in `src/features/people/actions.ts`. The 0020 Phase 3 form built
          these via `FormData.append` inside an onSubmit handler; the React 19
          migration (4a4afbd) switched to `<form action>` and dropped the
          imperative build without adding hidden inputs, silently submitting
          `roles=[]`. 0023 Phase 3 restores the contract declaratively. */}
      {admin && <input type="hidden" name="roles" value="admin" />}
      {coach && <input type="hidden" name="roles" value="coach" />}
      {dealer && <input type="hidden" name="roles" value="dealer" />}
      {dealerLinks
        .filter((l) => l.dealerId)
        .map((l, i) => (
          <input
            key={`dl-${i}`}
            type="hidden"
            name="dealerLinks"
            value={`${l.dealerId}:${l.role}`}
          />
        ))}

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          First name
          <input
            type="text"
            name="firstName"
            defaultValue={person?.firstName ?? ''}
            className={inputClass}
            autoFocus
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Last name
          <input
            type="text"
            name="lastName"
            defaultValue={person?.lastName ?? ''}
            className={inputClass}
            required
          />
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Email
          <input
            type="email"
            name="email"
            defaultValue={person?.email ?? ''}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Phone
          <input
            type="tel"
            name="phone"
            defaultValue={person?.phone ?? ''}
            className={inputClass}
          />
        </label>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-stone-50/40 px-3 py-2">
        <p className="text-[11px] text-stone-500">
          Roles
        </p>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={admin}
            onChange={(e) => setAdmin(e.target.checked)}
          />
          <span>
            <strong>Admin</strong>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={coach}
            onChange={(e) => setCoach(e.target.checked)}
          />
          <span>
            <strong>Coach</strong>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={dealer}
            onChange={(e) => setDealerChecked(e.target.checked)}
          />
          <span>
            <strong>Dealer</strong>{' '}
            <span className="text-xs text-stone-500">
              External dealer-side contact
            </span>
          </span>
        </label>
        {!hasAnyRole && (
          <p className="text-[11px] text-status-red">
            Pick at least one role.
          </p>
        )}
      </div>

      {dealer && (
        <div className="flex flex-col gap-2 rounded-lg border border-stone-200 bg-stone-50/40 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-600">Dealers</span>
            <button type="button" onClick={addDealerLink} className={rowEditClass}>
              + Link dealer
            </button>
          </div>
          {dealerLinks.length === 0 && (
            <p className="text-[11px] text-stone-500">No dealer relationships.</p>
          )}
          {dealerLinks.map((link, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
              <select
                value={link.dealerId}
                onChange={(e) => setDealerLink(i, { dealerId: e.target.value })}
                className={inputClass}
                required
              >
                <option value="">Pick a dealer…</option>
                {dealers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                value={link.role}
                onChange={(e) =>
                  setDealerLink(i, { role: e.target.value as DealerContactRole })
                }
                className={inputClass}
              >
                {DEALER_CONTACT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeDealerLink(i)}
                aria-label="Remove dealer link"
                className={rowDeleteClass}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <Dialog.Close className={rowEditClass}>Cancel</Dialog.Close>
        <button
          type="submit"
          disabled={pending || !hasAnyRole}
          className={submitClass}
        >
          {pending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Add Person'
              : 'Save'}
        </button>
      </div>
    </form>
  );
}
