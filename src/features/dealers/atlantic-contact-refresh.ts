import type { MappedContact } from './atlantic-import';

// Pure reconciliation for chunk 0091 (Atlantic dealer contact refresh — un-parks
// 0086-c). Given the BD tracker's authoritative GM + GSM/SM contacts for a rooftop
// and the dealer's CURRENT contacts, classify each into a disposition. No DB or
// QBO imports — unit-tested in CI and consumed by both the read-only preview
// (`scripts/atlantic-contact-refresh-preview.ts`) and the write runner
// (`scripts/atlantic-contact-refresh.ts`). Decisions pinned in
// `docs/chunks/0091-*/decision.md` (D2 GM+SM, D3 reconcile/conflict, D6 keep, D7 A).

export type ExistingContact = {
  linkId: number;
  contactId: number;
  role: string;
  title: string | null;
  /** "First Last" (already joined). */
  name: string;
  /** active primary email, or null. */
  email: string | null;
};

export type RefreshDisposition =
  | 'add'
  | 'update'
  | 'update-email'
  | 'no-change'
  | 'conflict'
  | 'existing-unlisted';

export type ReconciledContact = {
  /** 'GM' | 'SM' for a worksheet slot; null for an existing-unlisted prod contact. */
  slot: 'GM' | 'SM' | null;
  title: string;
  bdName: string;
  bdEmail: string;
  /** the prod contact this row targets (update / conflict / existing-unlisted), or null (add). */
  match: ExistingContact | null;
  disposition: RefreshDisposition;
  detail: string;
};

const lower = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();
const normName = (s: string | null | undefined) =>
  (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const emailLocal = (e: string | null | undefined) => lower(e).split('@')[0];

export function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

// Likely the same person despite a spelling/abbreviation variant: shared email
// local-part, OR a close full-name edit distance, OR same last token + first
// initial ("Mark Wilkins" ~ "M Wilkins", "Matthew" ~ "Matt").
export function fuzzySamePerson(
  n1: string | null | undefined,
  e1: string | null | undefined,
  n2: string | null | undefined,
  e2: string | null | undefined,
): boolean {
  const l1 = emailLocal(e1), l2 = emailLocal(e2);
  if (l1 && l1 === l2) return true;
  const a = normName(n1), b = normName(n2);
  if (!a || !b) return false;
  if (levenshtein(a, b) <= 2) return true;
  const at = a.split(' '), bt = b.split(' ');
  return at.length > 0 && bt.length > 0 &&
    at[at.length - 1] === bt[bt.length - 1] && at[0][0] === bt[0][0];
}

const slotOf = (title: string): 'GM' | 'SM' => (title === 'General Manager' ? 'GM' : 'SM');

// Reconcile the BD GM/SM contacts against a dealer's existing contacts. Returns
// one row per BD slot (with data) plus one row per existing contact the worksheet
// doesn't list (`existing-unlisted`). Two-pass: exact (email→name) then fuzzy, so
// a spelling variant becomes `update` (in-place), not a duplicate `add`.
export function reconcileDealerContacts(
  bdContacts: MappedContact[],
  existing: ExistingContact[],
): ReconciledContact[] {
  const out: ReconciledContact[] = [];
  const claimed = new Set<number>();
  const pendingAdds: { title: string; name: string; email: string }[] = [];

  // Pass 1 — exact match (email, then name) against unclaimed prod contacts.
  for (const bc of bdContacts) {
    const bcName = `${bc.firstName} ${bc.lastName}`.trim();
    const bcEmail = bc.email ?? '';
    const byEmail = bcEmail
      ? existing.find((c) => !claimed.has(c.linkId) && c.email && lower(c.email) === lower(bcEmail))
      : undefined;
    const byName = bcName
      ? existing.find((c) => !claimed.has(c.linkId) && c.name && normName(c.name) === normName(bcName))
      : undefined;
    const match = byEmail ?? byName;
    if (!match) { pendingAdds.push({ title: bc.title, name: bcName, email: bcEmail }); continue; }
    claimed.add(match.linkId);
    const nameSame = !!match.name && !!bcName && normName(match.name) === normName(bcName);
    const emailSame = !!match.email && !!bcEmail && lower(match.email) === lower(bcEmail);
    let disposition: RefreshDisposition, detail: string;
    if (nameSame && (emailSame || !bcEmail)) {
      disposition = 'no-change'; detail = `existing "${match.name}" already matches`;
    } else if (nameSame) {
      disposition = 'update-email'; detail = `same person; email "${match.email || '∅'}" → "${bcEmail}"`;
    } else {
      disposition = 'conflict';
      detail = `prod "${match.name}" <${match.email}> shares BD email but name differs from "${bcName}"`;
    }
    out.push({ slot: slotOf(bc.title), title: bc.title, bdName: bcName, bdEmail: bcEmail, match, disposition, detail });
  }

  // Pass 2 — fuzzy: an unmatched BD contact likely the same person as an existing
  // (spelling variant) becomes `update` (in-place), not a duplicate `add`.
  for (const a of pendingAdds) {
    const fuzzy = existing.find(
      (c) => !claimed.has(c.linkId) && (c.name || c.email) && fuzzySamePerson(a.name, a.email, c.name, c.email),
    );
    if (fuzzy) {
      claimed.add(fuzzy.linkId);
      out.push({
        slot: slotOf(a.title), title: a.title, bdName: a.name, bdEmail: a.email, match: fuzzy,
        disposition: 'update',
        detail: `likely same as existing "${fuzzy.name}" <${fuzzy.email || '∅'}> — update name/email in place (verify same person)`,
      });
    } else {
      out.push({
        slot: slotOf(a.title), title: a.title, bdName: a.name, bdEmail: a.email, match: null,
        disposition: 'add', detail: `create ${a.title} link from BD`,
      });
    }
  }

  // Existing prod contacts the worksheet doesn't list — surfaced, default keep (D6).
  for (const c of existing) {
    if (claimed.has(c.linkId) || (!c.name && !c.email)) continue;
    out.push({
      slot: null, title: c.title ?? '(untitled)', bdName: c.name, bdEmail: c.email ?? '', match: c,
      disposition: 'existing-unlisted', detail: `existing ${c.role} contact not in the worksheet — default keep`,
    });
  }

  return out;
}
