'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toaster';
import { archivePerson, createPerson, updatePerson } from '@/features/people/actions';
import type {
  AdminPersonRow,
  DealerContactRole,
  DealerLink,
} from '@/features/people/queries';
import type { Dealer } from '@/features/schedule/queries';

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

const chipBase =
  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide';

const DEALER_CONTACT_ROLES: DealerContactRole[] = ['customer', 'staff', 'prospect'];

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

type Lifecycle = 'active' | 'banned' | 'inactive';

// A person's lifecycle is derived from the *active* facets the query returns.
// `loadAdminPeople` filters archived team_member_roles + dealer_contacts, so
// empty arrays mean "no live relationships." `hasAppAccess` + `bannedUntil`
// cover the auth-side. After `archivePerson` runs on a contact-only person
// (no auth, no roles, no dealer links), all three are empty and the row drops
// to `inactive` — which is the signal to hide the Archive button.
function lifecycle(p: AdminPersonRow): Lifecycle {
  if (p.hasAppAccess) {
    if (p.authUser?.bannedUntil) {
      const t = Date.parse(p.authUser.bannedUntil);
      if (Number.isFinite(t) && t >= Date.now()) return 'banned';
    }
    return 'active';
  }
  if (p.roles.length > 0 || p.dealerLinks.length > 0) return 'active';
  return 'inactive';
}

export function PeopleAdmin({
  people,
  dealers,
}: {
  people: AdminPersonRow[];
  dealers: Dealer[];
}) {
  const [addOpen, setAddOpen] = useState(false);

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-[0_1px_4px_rgba(15,30,60,0.08)]">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-2xl text-navy">Team & contacts</h2>
          <p className="text-xs text-stone-500">{people.length} people</p>
        </div>
        <button onClick={() => setAddOpen(true)} className={headerAddClass}>
          + Add Person
        </button>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-200 text-left text-[11px] font-semibold uppercase tracking-wide text-stone-500">
              <th className="px-2 py-2">Name</th>
              <th className="px-2 py-2">Email</th>
              <th className="px-2 py-2">Roles</th>
              <th className="px-2 py-2">Dealers</th>
              <th className="px-2 py-2">Last sign-in</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {people.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-6 text-center text-sm text-stone-500">
                  No people yet.
                </td>
              </tr>
            ) : (
              people.map((p) => <PersonRow key={p.contactId} person={p} dealers={dealers} />)
            )}
          </tbody>
        </table>
      </div>

      <Dialog.Root open={addOpen} onClose={setAddOpen}>
        <Dialog.Backdrop />
        <Dialog.Panel>
          <Dialog.Title>Add Person</Dialog.Title>
          <Dialog.Description>
            Adds a contact. Toggle App access to also create a sign-in account.
          </Dialog.Description>
          {addOpen && <PersonForm mode="create" dealers={dealers} onSuccess={() => setAddOpen(false)} />}
        </Dialog.Panel>
      </Dialog.Root>
    </section>
  );
}

function PersonRow({
  person,
  dealers,
}: {
  person: AdminPersonRow;
  dealers: Dealer[];
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const status = lifecycle(person);
  const active = status === 'active';

  function onArchive() {
    if (
      !confirm(
        `Archive ${person.displayName}? Their team-member roles and dealer relationships will be archived. ${
          person.hasAppAccess ? 'Their sign-in account will also be banned.' : ''
        } The contact record itself stays for historical references.`,
      )
    ) {
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

  return (
    <tr className={active ? '' : 'opacity-60'}>
      <td className="px-2 py-2 align-middle">
        <div className="font-medium text-stone-800">{person.displayName}</div>
      </td>
      <td className="px-2 py-2 align-middle text-xs text-stone-600">
        {person.email ?? <span className="text-stone-400">—</span>}
      </td>
      <td className="px-2 py-2 align-middle">
        <div className="flex flex-wrap gap-1">
          {!person.hasAppAccess && person.roles.length === 0 && (
            <span className="text-xs text-stone-400">—</span>
          )}
          {person.hasAppAccess && (
            <span className={`${chipBase} bg-stone-100 text-stone-600`}>app</span>
          )}
          {person.roles.map((r) => (
            <span
              key={r}
              className={`${chipBase} ${
                r === 'admin'
                  ? 'bg-accent/15 text-accent'
                  : r === 'coach'
                    ? 'bg-navy/10 text-navy'
                    : 'bg-stone-100 text-stone-600'
              }`}
            >
              {r}
            </span>
          ))}
        </div>
      </td>
      <td className="px-2 py-2 align-middle">
        <div className="flex flex-wrap gap-1">
          {person.dealerLinks.length === 0 ? (
            <span className="text-xs text-stone-400">—</span>
          ) : (
            person.dealerLinks.map((d, i) => (
              <span
                key={`${d.dealerId}:${d.role}:${i}`}
                className={`${chipBase} bg-stone-100 text-stone-600`}
                title={`${d.role} at ${d.dealerName}`}
              >
                {d.dealerName} · {d.role}
              </span>
            ))
          )}
        </div>
      </td>
      <td className="px-2 py-2 align-middle text-xs text-stone-600">
        {fmtDateTime(person.authUser?.lastSignInAt ?? null)}
      </td>
      <td className="px-2 py-2 align-middle">
        <span
          className={`${chipBase} ${
            status === 'active'
              ? 'bg-status-green/15 text-status-green'
              : 'bg-stone-200 text-stone-600'
          }`}
        >
          {status}
        </span>
      </td>
      <td className="px-2 py-2 align-middle">
        <div className="flex shrink-0 items-center justify-end gap-1">
          <button onClick={() => setEditOpen(true)} className={rowEditClass}>
            Edit
          </button>
          {active && (
            <button
              onClick={onArchive}
              disabled={pending}
              aria-label={`Archive ${person.displayName}`}
              className={rowDeleteClass}
            >
              ✕
            </button>
          )}
        </div>
        <Dialog.Root open={editOpen} onClose={setEditOpen}>
          <Dialog.Backdrop />
          <Dialog.Panel>
            <Dialog.Title>Edit Person — {person.displayName}</Dialog.Title>
            {editOpen && (
              <PersonForm
                mode="edit"
                person={person}
                dealers={dealers}
                onSuccess={() => setEditOpen(false)}
              />
            )}
          </Dialog.Panel>
        </Dialog.Root>
      </td>
    </tr>
  );
}

type DealerLinkDraft = { dealerId: string; role: DealerContactRole };

function dealerLinksFromPerson(person?: AdminPersonRow): DealerLinkDraft[] {
  if (!person) return [];
  return person.dealerLinks.map<DealerLinkDraft>((d: DealerLink) => ({
    dealerId: String(d.dealerId),
    role: d.role,
  }));
}

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
  const [firstName, setFirstName] = useState(
    person ? person.displayName.split(/\s+/, 1)[0] ?? '' : '',
  );
  const [lastName, setLastName] = useState(
    person ? person.displayName.split(/\s+/).slice(1).join(' ') : '',
  );
  const [email, setEmail] = useState(person?.email ?? '');
  const [phone, setPhone] = useState(person?.phone ?? '');
  const [appAccess, setAppAccess] = useState(person?.hasAppAccess ?? false);
  const [admin, setAdmin] = useState(person?.roles.includes('admin') ?? false);
  const [coach, setCoach] = useState(person?.roles.includes('coach') ?? false);
  const [dealerLinks, setDealerLinks] = useState<DealerLinkDraft[]>(
    dealerLinksFromPerson(person),
  );
  const [pending, startTransition] = useTransition();

  function setDealerLink(i: number, patch: Partial<DealerLinkDraft>) {
    setDealerLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function addDealerLink() {
    setDealerLinks((prev) => [...prev, { dealerId: '', role: 'staff' }]);
  }

  function removeDealerLink(i: number) {
    setDealerLinks((prev) => prev.filter((_, idx) => idx !== i));
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      toast.error('First and last name are required.');
      return;
    }
    if (appAccess && !email.trim()) {
      toast.error('Email is required when granting app access.');
      return;
    }
    if (!appAccess && (admin || coach)) {
      toast.error('Roles need app access. Toggle App access on or clear the role checkboxes.');
      return;
    }
    const filledLinks = dealerLinks.filter((l) => l.dealerId);
    if (filledLinks.some((l) => !l.dealerId || !l.role)) {
      toast.error('Each dealer link needs both a dealer and a role.');
      return;
    }

    startTransition(async () => {
      const fd = new FormData();
      if (mode === 'edit' && person) fd.set('contactId', String(person.contactId));
      fd.set('firstName', firstName.trim());
      fd.set('lastName', lastName.trim());
      if (email.trim()) fd.set('email', email.trim().toLowerCase());
      if (phone.trim()) fd.set('phone', phone.trim());
      if (appAccess) fd.set('appAccess', '1');
      if (admin) fd.append('roles', 'admin');
      if (coach) fd.append('roles', 'coach');
      for (const link of filledLinks) {
        fd.append('dealerLinks', `${link.dealerId}:${link.role}`);
      }

      const action = mode === 'create' ? createPerson : updatePerson;
      const result = await action(fd);
      if ('ok' in result) {
        if (result.warning) {
          // Partial success — DB committed, auth-side step had a problem.
          // Still close + refresh so the new/updated row is visible; surface
          // the warning so the admin knows what to retry.
          toast.error(result.warning);
        } else {
          toast.success(mode === 'create' ? 'Person added' : 'Person updated');
        }
        router.refresh();
        onSuccess();
      } else {
        // Hard failure — keep the dialog open so the admin can fix and retry.
        // Refresh anyway because some error paths revalidate (e.g. race-loss
        // bans the just-created auth user); the table should reflect that.
        toast.error(result.error);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          First name
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className={inputClass}
            autoFocus
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Last name
          <input
            type="text"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-stone-600">
          Phone
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <div className="flex flex-col gap-1 rounded-lg border border-stone-200 bg-stone-50/40 px-3 py-2">
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={appAccess}
            onChange={(e) => setAppAccess(e.target.checked)}
          />
          <span>
            <strong>App access</strong> — creates a sign-in account at this email
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={admin}
            onChange={(e) => setAdmin(e.target.checked)}
            disabled={!appAccess}
          />
          <span>
            <strong>Admin</strong> — gates <code className="text-xs">/admin/*</code>
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={coach}
            onChange={(e) => setCoach(e.target.checked)}
            disabled={!appAccess}
          />
          <span>
            <strong>Coach</strong> — assignable on the calendar; auto-filters their{' '}
            <code className="text-xs">/calendar</code>
          </span>
        </label>
      </div>

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

      <div className="mt-2 flex justify-end gap-2">
        <Dialog.Close className={rowEditClass}>Cancel</Dialog.Close>
        <button type="submit" disabled={pending} className={submitClass}>
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
