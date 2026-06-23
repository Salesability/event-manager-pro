import 'server-only';

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contactIdentifiers, contacts, dealerContacts } from '@/lib/db/schema';

// Resolves the recipient that a Quote / MSA email should go to. The email goes
// to one person — the dealer's **primary contact's** primary email — for v1.
// Multi-recipient (cc'ing additional contacts, bcc'ing the coach) is deferred.
//
// Recipient selection mirrors how `loadDealers` picks a dealer's primary contact
// (`DEALER_CONTACT_ROLE_PRIORITY` = staff > customer > prospect): the highest-
// priority **non-archived** `dealer_contacts` row that has a non-archived primary
// email, breaking ties by the lowest `dealer_contacts.id`. It does NOT require
// `role = 'customer'` — UI-created dealers + the 0086 Atlantic / QBO imports all
// tag their contact `staff`, so a customer-only rule rejected nearly every dealer
// (the displayed primary contact is the staff one). Picking the same priority-
// primary the dealer page already shows keeps the recipient consistent with the
// UI. The proper role rationalization (explicit primary/billing designation) is
// its own chunk; this is the unblock.
//
// Source of truth:
//   - any non-archived `dealer_contacts` row for the dealer (role is a priority
//     tiebreak, no longer a hard filter).
//   - `contact_identifiers.kind = 'email' AND is_primary = true` for that
//     contact (archived rows excluded) — emailless contacts are skipped, so the
//     pick is the highest-priority contact that can actually be emailed.
//
// Fail-closed shape: returns `{ error }` when the dealer has no contact with a
// primary email. The caller surfaces the error to the coach; we don't silently
// fall back to a "drop the email" behaviour.

export type QuoteRecipient = {
  email: string;
  firstName: string;
};

export type ResolveRecipientResult =
  | { ok: true; recipient: QuoteRecipient }
  | { error: string };

export async function resolveQuoteRecipient(
  dealerId: number,
): Promise<ResolveRecipientResult> {
  const [row] = await db
    .select({
      firstName: contacts.firstName,
      email: contactIdentifiers.value,
    })
    .from(dealerContacts)
    .innerJoin(
      contacts,
      and(
        eq(contacts.id, dealerContacts.contactId),
        isNull(contacts.archivedAt),
      ),
    )
    .innerJoin(
      contactIdentifiers,
      and(
        eq(contactIdentifiers.contactId, contacts.id),
        eq(contactIdentifiers.kind, 'email'),
        eq(contactIdentifiers.isPrimary, true),
        isNull(contactIdentifiers.archivedAt),
      ),
    )
    .where(
      and(
        eq(dealerContacts.dealerId, dealerId),
        isNull(dealerContacts.archivedAt),
      ),
    )
    // Same priority as loadDealers' DEALER_CONTACT_ROLE_PRIORITY (staff > customer
    // > prospect), then lowest id — so the recipient matches the dealer page's
    // displayed primary contact.
    .orderBy(
      sql`case ${dealerContacts.role} when 'staff' then 0 when 'customer' then 1 when 'prospect' then 2 else 3 end`,
      asc(dealerContacts.id),
    )
    .limit(1);

  if (!row) {
    return {
      error:
        'Dealer has no contact with a primary email address. Add a contact email before sending.',
    };
  }

  return {
    ok: true,
    recipient: {
      email: row.email,
      firstName: row.firstName,
    },
  };
}
