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

// Postgres `integer` is signed 32-bit. Volume fields can't be negative.
const MAX_PG_INT = 2_147_483_647;
function isValidVolume(n: number | null): boolean {
  return n == null || (n >= 0 && n <= MAX_PG_INT);
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

export function parseCampaignInput(formData: FormData): CampaignInput | { error: string } {
  const startDate = parseDate(formData, 'startDate');
  const endDate = parseDate(formData, 'endDate');
  if (!startDate || !endDate) return { error: 'Start and end date are required (YYYY-MM-DD).' };
  if (endDate < startDate) return { error: 'End date must be on or after start date.' };

  const dealerId = parseOptionalId(formData, 'dealerId');
  if (dealerId == null) return { error: 'Dealer is required.' };

  const email = field(formData, 'email').toLowerCase();
  if (email && !EMAIL_RE.test(email)) {
    return { error: 'Contact email looks invalid.' };
  }

  const qtyRecords = parseOptionalInt(formData, 'qtyRecords');
  const smsEmail = parseOptionalInt(formData, 'smsEmail');
  const letters = parseOptionalInt(formData, 'letters');
  const bdc = parseOptionalInt(formData, 'bdc');
  if (
    !isValidVolume(qtyRecords) ||
    !isValidVolume(smsEmail) ||
    !isValidVolume(letters) ||
    !isValidVolume(bdc)
  ) {
    return { error: 'Volume fields must be non-negative whole numbers.' };
  }

  return {
    startDate,
    endDate,
    dealerId,
    coachId: parseOptionalId(formData, 'coachId'),
    styleId: parseOptionalId(formData, 'styleId'),
    audienceSourceId: parseOptionalId(formData, 'audienceSourceId'),
    qtyRecords,
    smsEmail,
    letters,
    bdc,
    contact: field(formData, 'contact') || null,
    phone: field(formData, 'phone') || null,
    email: email || null,
    notes: field(formData, 'notes') || null,
  };
}
