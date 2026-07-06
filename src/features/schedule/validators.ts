// Surviving primitives after the 0045 Phase 7 retirement. The hand-rolled
// helpers superseded by zod schemas (`validateContactInputs`, `parseDate`,
// `parseOptionalInt`) were deleted in this phase along with their tests.
//
// What stays and why:
// - `EMAIL_RE` — `adoptOrphanAuthUser` in `people/actions.ts` still uses it.
//   Once that action gets its own schema (out of scope here), this can move
//   into the relevant `*-schema.ts` or be retired entirely.
// - `field()` / `parseId()` / `parseOptionalId()` — utility readers for
//   FormData entries that aren't covered by a single per-form schema (the
//   composer's JSON `inputs` blob, custom `id` / `quoteId` / `dealerId`
//   wrapper fields, multi-action contact-id paths). They're tiny and
//   schema-agnostic; no harm in keeping them.
// - `parseCampaignInput` — kept as the action-side wrapper around
//   `bookingFormSchema` since it folds cross-field rules (endDate ≥ startDate)
//   and the wire → DB normalization that the schema doesn't model.

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

export function parseId(formData: FormData, name = 'id'): number | null {
  const raw = formData.get(name);
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseOptionalId(formData: FormData, name: string): number | null {
  const raw = formData.get(name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export type CampaignInput = {
  startDate: string;
  endDate: string;
  dealerId: number;
  coachId: number | null;
  styleId: number | null;
  audienceSourceId: number | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

// Action-side wrapper around `bookingFormSchema` — folds in cross-field rules
// (endDate ≥ startDate) and the wire → DB normalization (string → number,
// lowercased email) the schema doesn't model.
import { bookingFormSchema } from '@/app/(app)/calendar/booking-schema';

export function parseCampaignInput(formData: FormData): CampaignInput | { error: string } {
  const parsed = bookingFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    for (const list of Object.values(fieldErrors)) {
      if (list && list.length) return { error: list[0] };
    }
    return { error: 'Invalid campaign input.' };
  }
  const v = parsed.data;
  if (v.endDate < v.startDate) {
    return { error: 'End date must be on or after start date.' };
  }
  const email = (v.email ?? '').toLowerCase();
  const toNum = (s: string | undefined): number | null =>
    s && s.length > 0 ? Number(s) : null;
  return {
    startDate: v.startDate,
    endDate: v.endDate,
    dealerId: Number(v.dealerId),
    coachId: toNum(v.coachId),
    styleId: toNum(v.styleId),
    audienceSourceId: toNum(v.audienceSourceId),
    contact: (v.contact || '') || null,
    phone: (v.phone || '') || null,
    email: email || null,
    notes: (v.notes || '') || null,
  };
}
