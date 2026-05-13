'use client';

import {
  useActionState,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import { useRouter } from 'next/navigation';
import * as Checkbox from '@radix-ui/react-checkbox';
import * as Select from '@radix-ui/react-select';
import type { ColumnFiltersState, FilterFn } from '@tanstack/react-table';
import { Can } from '@/components/auth/can';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/ui/data-table';
import {
  Field,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toaster';
import { toLegacyResult } from '@/lib/actions/legacy-result';
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

// Per-field touched/invalid state for inline required-field messages. Radix
// Form's `<Form.Message match="valueMissing">` only fires on `change` and
// `invalid` events — not blur — so a required field tabbed past without
// typing stays silent until submit. This hook adds the blur path: onBlur of
// an empty input flips touched=true; onChange to a non-empty value flips it
// back to false; onInvalid catches never-focused required fields on submit.
// typeMismatch (email shape) is still wired through Radix's stock match.
function useTouched() {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fieldHandlers = useCallback(
    (name: string) => ({
      onBlur: (e: React.FocusEvent<HTMLInputElement>) => {
        const empty = !e.currentTarget.value.trim();
        setTouched((t) => (t[name] === empty ? t : { ...t, [name]: empty }));
      },
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.currentTarget.value.trim()) {
          setTouched((t) => (t[name] ? { ...t, [name]: false } : t));
        }
      },
      onInvalid: () => {
        setTouched((t) => (t[name] ? t : { ...t, [name]: true }));
      },
    }),
    [],
  );
  return { touched, fieldHandlers };
}

// Radix Checkbox doesn't render a tick visual itself — it ships an unstyled
// button + Indicator slot. These classes turn the button into a checkbox-
// shaped target and flip the navy-on-white look when `data-state="checked"`.
// `roleCheckboxClass` is shared across the three role checkboxes so the
// fieldset stays visually uniform. `CheckIcon` is the indicator SVG (matches
// the inline-SVG idiom used by the Dialog wrapper).
const roleCheckboxClass =
  'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-input bg-white transition data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30';

function CheckIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3 w-3"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.704 5.29a1 1 0 0 1 .005 1.414l-7.5 7.55a1 1 0 0 1-1.42.004l-3.5-3.5a1 1 0 1 1 1.414-1.415l2.79 2.79 6.79-6.84a1 1 0 0 1 1.42-.004Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function pillClass(active: boolean): string {
  return active
    ? 'rounded-full border border-accent bg-accent/15 px-3 py-1 text-xs font-semibold text-accent transition'
    : 'rounded-full border border-border bg-white px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-primary';
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
      const result = toLegacyResult<{ ok: true; contactId?: number; warning?: string }>(
        await archivePerson(fd),
      );
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
    <section className="rounded-2xl border border-border bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{people.length} people</p>
        </div>
        <Can capability="person:create">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAddOpen(true)}
            className="border-accent/40 text-accent hover:border-accent hover:bg-accent/10"
          >
            + Add Person
          </Button>
        </Can>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Search by name, email, or dealer…"
          aria-label="Search people"
          className="min-w-[16rem] flex-1 rounded-lg border border-border bg-white px-3 py-1.5 text-sm text-foreground outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20"
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
                  className="rounded border border-border bg-white px-2 py-0.5 text-xs font-medium text-muted-foreground transition hover:border-primary hover:text-primary"
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogTitle>Add Person</DialogTitle>
          <DialogDescription>
            Adds a contact. Picking Admin or Coach also creates a sign-in at this email.
          </DialogDescription>
          {addOpen && <PersonForm mode="create" dealers={dealers} onSuccess={() => setAddOpen(false)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={editing != null} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogTitle>Edit Person — {editing?.displayName}</DialogTitle>
          {editing && (
            <PersonForm
              mode="edit"
              person={editing}
              dealers={dealers}
              onSuccess={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
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
  const { touched, fieldHandlers } = useTouched();
  const [admin, setAdmin] = useState(person?.roles.includes('admin') ?? false);
  const [coach, setCoach] = useState(person?.roles.includes('coach') ?? false);
  const [dealer, setDealer] = useState(person?.roles.includes('dealer') ?? false);
  const [dealerLinks, setDealerLinks] = useState<DealerLinkDraft[]>(
    dealerLinksFromPerson(person),
  );

  // Adapter from the dealers-prop list to Combobox's `{value, label}` shape.
  // Memoized so the Combobox's typeahead engine doesn't see a fresh array
  // identity on every parent render and reset its filter state mid-typing.
  const dealerOptions = useMemo(
    () => dealers.map((d) => ({ value: String(d.id), label: d.name })),
    [dealers],
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
      return toLegacyResult<{ ok: true; contactId?: number; warning?: string }>(
        await action(fd),
      );
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
      {/* Roles wire-format: each Radix Checkbox below renders its own hidden
          `<input type="checkbox" name="roles" value="…">` next to the visible
          button when `name`+`value` are passed (see `<Checkbox.Root>` calls in
          the Roles fieldset). Phase 2 of 0024 dropped the explicit hidden
          `<input>` rows that 0023 Phase 3 added — Radix Checkbox handles the
          serialization itself. The 0020-vintage onSubmit-handler regression
          that 0023 documented is fully closed: the wire format now flows from
          the same control that renders the UI, with no hand-maintained mirror. */}
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
        <Field data-invalid={touched.firstName || undefined}>
          <FieldLabel htmlFor="person-firstName">First name</FieldLabel>
          <Input
            id="person-firstName"
            name="firstName"
            type="text"
            defaultValue={person?.firstName ?? ''}
            autoFocus
            required
            aria-invalid={touched.firstName || undefined}
            {...fieldHandlers('firstName')}
          />
          {touched.firstName && <FieldError>First name is required.</FieldError>}
        </Field>
        <Field data-invalid={touched.lastName || undefined}>
          <FieldLabel htmlFor="person-lastName">Last name</FieldLabel>
          <Input
            id="person-lastName"
            name="lastName"
            type="text"
            defaultValue={person?.lastName ?? ''}
            required
            aria-invalid={touched.lastName || undefined}
            {...fieldHandlers('lastName')}
          />
          {touched.lastName && <FieldError>Last name is required.</FieldError>}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field>
          <FieldLabel htmlFor="person-email">Email</FieldLabel>
          <Input
            id="person-email"
            name="email"
            type="email"
            defaultValue={person?.email ?? ''}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="person-phone">Phone</FieldLabel>
          <Input
            id="person-phone"
            name="phone"
            type="tel"
            defaultValue={person?.phone ?? ''}
          />
        </Field>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          Roles
        </p>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox.Root
            name="roles"
            value="admin"
            checked={admin}
            onCheckedChange={(c) => setAdmin(c === true)}
            className={roleCheckboxClass}
          >
            <Checkbox.Indicator>
              <CheckIcon />
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span>
            <strong>Admin</strong>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox.Root
            name="roles"
            value="coach"
            checked={coach}
            onCheckedChange={(c) => setCoach(c === true)}
            className={roleCheckboxClass}
          >
            <Checkbox.Indicator>
              <CheckIcon />
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span>
            <strong>Coach</strong>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox.Root
            name="roles"
            value="dealer"
            checked={dealer}
            onCheckedChange={(c) => setDealerChecked(c === true)}
            className={roleCheckboxClass}
          >
            <Checkbox.Indicator>
              <CheckIcon />
            </Checkbox.Indicator>
          </Checkbox.Root>
          <span>
            <strong>Dealer</strong>{' '}
            <span className="text-xs text-muted-foreground">
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
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Dealers</span>
            <Button type="button" variant="outline" size="xs" onClick={addDealerLink}>
              + Link dealer
            </Button>
          </div>
          {dealerLinks.length === 0 && (
            <p className="text-[11px] text-muted-foreground">No dealer relationships.</p>
          )}
          {dealerLinks.map((link, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
              <Combobox
                items={dealerOptions}
                itemToStringValue={(item) => item.value}
                itemToStringLabel={(item) => item.label}
                value={dealerOptions.find((o) => o.value === String(link.dealerId)) ?? null}
                onValueChange={(item) =>
                  setDealerLink(i, { dealerId: item?.value ?? '' })
                }
              >
                <ComboboxInput
                  placeholder="Type a dealership name…"
                  aria-label="Dealer"
                />
                <ComboboxContent>
                  <ComboboxEmpty>No matching dealers.</ComboboxEmpty>
                  <ComboboxList>
                    {(item) => (
                      <ComboboxItem key={item.value} value={item}>
                        {item.label}
                      </ComboboxItem>
                    )}
                  </ComboboxList>
                </ComboboxContent>
              </Combobox>
              <Select.Root
                value={link.role}
                onValueChange={(v) =>
                  setDealerLink(i, { role: v as DealerContactRole })
                }
              >
                <Select.Trigger
                  aria-label="Role"
                  className="flex items-center justify-between gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-accent focus:ring-3 focus:ring-accent/20"
                >
                  <Select.Value placeholder="role" />
                  <Select.Icon>
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="h-3 w-3 text-muted-foreground"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M5.22 7.22a.75.75 0 0 1 1.06 0L10 10.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 8.28a.75.75 0 0 1 0-1.06Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </Select.Icon>
                </Select.Trigger>
                <Select.Portal>
                  <Select.Content
                    position="popper"
                    sideOffset={4}
                    className="z-50 overflow-hidden rounded-lg border border-border bg-white shadow-[0_8px_24px_rgba(15,30,60,0.12)]"
                  >
                    <Select.Viewport className="p-1">
                      {DEALER_CONTACT_ROLES.map((r) => (
                        <Select.Item
                          key={r}
                          value={r}
                          className="cursor-pointer rounded px-2 py-1.5 text-sm text-foreground outline-none data-[highlighted]:bg-accent/10 data-[highlighted]:text-primary"
                        >
                          <Select.ItemText>{r}</Select.ItemText>
                        </Select.Item>
                      ))}
                    </Select.Viewport>
                  </Select.Content>
                </Select.Portal>
              </Select.Root>
              <Button
                type="button"
                variant="destructive"
                size="xs"
                onClick={() => removeDealerLink(i)}
                aria-label="Remove dealer link"
              >
                ✕
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="mt-2 flex justify-end gap-2">
        <DialogClose className={buttonVariants({ variant: 'outline', size: 'xs' })}>
          Cancel
        </DialogClose>
        <Button type="submit" variant="default" size="sm" disabled={pending || !hasAnyRole}>
          {pending
            ? mode === 'create'
              ? 'Creating…'
              : 'Saving…'
            : mode === 'create'
              ? 'Add Person'
              : 'Save'}
        </Button>
      </div>
    </form>
  );
}
