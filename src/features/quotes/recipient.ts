import 'server-only';

import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { db } from '@/lib/db';
import { contactIdentifiers, contacts, dealerContacts } from '@/lib/db/schema';

// Resolves the recipient that a Quote / MSA email should go to. The email goes
// to one person — the dealer's **primary contact's** primary email — for v1.
// Multi-recipient (cc'ing additional contacts, bcc'ing the coach) is deferred.
//
// Recipient selection keys off the explicit `dealer_contacts.is_primary`
// designation (0089), superseding hotfix A's `DEALER_CONTACT_ROLE_PRIORITY`
// heuristic. Among the dealer's **non-archived** contacts that have a
// non-archived primary email, the designated primary (`is_primary = true`) is
// chosen first, falling back to the lowest `dealer_contacts.id` emailable
// contact. Because the query inner-joins an emailable identifier, a primary
// contact with no email is automatically skipped in favour of the next emailable
// one — exactly the deterministic fallback decision.md D3 specifies.
//
// Source of truth:
//   - any non-archived `dealer_contacts` row for the dealer (`is_primary` is the
//     ordering key, not a hard filter — so an emailless primary never strands
//     the send).
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
  /** Present so the MSA signature block can print the signer's full legal
   *  name (first name alone is not legally binding — chunk 0099). `contacts
   *  .last_name` is `notNull`, so this is always a string. */
  lastName: string;
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
      lastName: contacts.lastName,
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
    // Designated primary first (0089), then lowest id — matching the dealer
    // page's displayed primary contact (loadDealers also reads is_primary).
    .orderBy(
      desc(dealerContacts.isPrimary),
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
      lastName: row.lastName,
    },
  };
}
