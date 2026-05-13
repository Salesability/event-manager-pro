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

export type ContactInputs = {
  contactFirst: string;
  contactLast: string;
  contactEmail: string;
  contactPhone: string;
};

export function validateContactInputs(input: ContactInputs): string | null {
  const hasAnyContactField =
    input.contactFirst || input.contactLast || input.contactEmail || input.contactPhone;
  if (hasAnyContactField) {
    if (!input.contactFirst || !input.contactLast) {
      return 'Contact first and last name are both required when adding a contact.';
    }
  }
  if (input.contactEmail && !EMAIL_RE.test(input.contactEmail)) {
    return 'Contact email looks invalid.';
  }
  return null;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function parseDate(formData: FormData, name: string): string | null {
  const v = field(formData, name);
  return ISO_DATE_RE.test(v) ? v : null;
}

export function parseOptionalId(formData: FormData, name: string): number | null {
  const raw = formData.get(name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function parseOptionalInt(formData: FormData, name: string): number | null {
  const raw = formData.get(name);
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

export type CampaignInput = {
  startDate: string;
  endDate: string;
  dealerId: number;
  coachId: number | null;
  styleId: number | null;
  audienceSourceId: number | null;
  qtyRecords: number | null;
  smsEmail: number | null;
  letters: number | null;
  bdc: number | null;
  contact: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
};

// 0045 Phase 6 — schema-as-contract: per-field validation lives in
// `src/app/(app)/calendar/booking-schema.ts` (shared with the booking-form
// B-shape client). Cross-field rules (endDate ≥ startDate) and the wire → DB
// normalization (string → number, lowercased email) stay here.
//
// Eager import of the booking-schema is intentional even though that module
// lives under `src/app/(app)/calendar/...` — the validator imports the schema,
// not any client component code, so there's no client-server boundary issue.
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
    qtyRecords: toNum(v.qtyRecords),
    smsEmail: toNum(v.smsEmail),
    letters: toNum(v.letters),
    bdc: toNum(v.bdc),
    contact: (v.contact || '') || null,
    phone: (v.phone || '') || null,
    email: email || null,
    notes: (v.notes || '') || null,
  };
}
