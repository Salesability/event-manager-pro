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
