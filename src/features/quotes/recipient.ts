import 'server-only';

import { and, asc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contactIdentifiers, contacts, dealerContacts } from '@/lib/db/schema';

// Resolves the customer recipient that a Quote email should go to. The Quote
// email goes to one person — the dealer's primary customer contact's primary
// email — for v1. Multi-recipient (cc'ing additional customer contacts,
// bcc'ing the coach) is deferred to v2.
//
// Source of truth:
//   - `dealer_contacts.role = 'customer'` for the quote's dealer (archived
//     rows excluded).
//   - `contact_identifiers.kind = 'email' AND is_primary = true` for that
//     contact (archived rows excluded).
//   - Single email per send (multi-customer-contact dealers pick the
//     deterministically-lowest `dealer_contacts.id`).
//
// Fail-closed shape: returns `{ error }` when the dealer has no customer
// contact, or that contact has no primary email. The caller surfaces the
// error to the coach; we don't silently fall back to a "drop the email"
// behaviour.

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
        eq(dealerContacts.role, 'customer'),
        isNull(dealerContacts.archivedAt),
      ),
    )
    .orderBy(asc(dealerContacts.id))
    .limit(1);

  if (!row) {
    return {
      error:
        'Dealer has no customer contact with a primary email address. Add a customer contact before sending.',
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
