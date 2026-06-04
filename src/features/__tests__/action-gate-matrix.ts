// Executable twin of `docs/wiki/auth.md` § "Per-action gate matrix" + § "Capability matrix".
// One row per gated Server Action / protected Route Handler. The harness in
// `action-gate-matrix.test.ts` drives each row against four roles
// (unauth / admin / coach / orphan) and asserts the documented outcome.
//
// Drift detection: a separate test in the harness greps `src/features/**/actions.ts`
// and `src/app/**/route.ts` for gated entries and fails if any aren't represented
// here. New action lands → CI fails until a matrix row exists.
//
// Maintenance: when `auth.md`'s gate matrix moves, this file moves in lockstep.
// See `docs/chunks/0032-action-matrix-test/plan.md`.

import * as peopleActions from '@/features/people/actions';
import * as scheduleActions from '@/features/schedule/actions';
import * as emailActions from '@/features/email/actions';
import * as quotesActions from '@/features/quotes/actions';
import * as reportsActions from '@/features/reports/actions';
import * as servicesActions from '@/features/services/actions';
import { GET as productionExportGET } from '@/app/(app)/production/export/route';
import { GET as reportsExportGET } from '@/app/(app)/reports/export/route';

// All `team_member_roles` values + `unauth` (no user) and `orphan` (signed
// in, no membership row). Each gated entry must specify an outcome for every
// key — that's the load-bearing guarantee against partial admit-set drift
// (e.g. a gate switched from admin-only to admin+staff would still admit
// admin and reject coach, so a 4-role matrix would silently pass while
// `staff` is now wrongly admitted).
export type RoleKey =
  | 'unauth'
  | 'admin'
  | 'staff'
  | 'coach'
  | 'viewer'
  | 'dealer'
  | 'orphan';

// Every action redirects on deny; the destination tells you which gate
// rejected. assertCan (and the `capabilityClient` middleware that wraps it)
// redirects to /login when there's no user and to / when the capability
// denies.
export type Outcome = 'allow' | 'redirect:/login' | 'redirect:/';

export type ActionMatrixRow = {
  /** Human-readable identifier for test output. Use the export's name. */
  label: string;
  /** Async fn under test. Server Action signature: `(FormData) => unknown`.
   *  Route Handler signature: `(NextRequest) => unknown`. The harness
   *  builds the right input via `buildInput`. */
  invoke: () => Promise<unknown>;
  /** Documented expected outcome per role. Reflects intent — drift here
   *  means either the action's gate is wrong OR the matrix is stale. */
  expectedByRole: Record<RoleKey, Outcome>;
  /** Free-form note explaining the intent (matches the wiki's per-row
   *  prose). Helpful when reading test failures. */
  note: string;
};

// Minimal sample inputs. The auth gate runs before any FormData parsing or
// DB call; missing/blank fields yield a post-gate validation error for
// admins (which the harness treats as "allow" — no redirect). The matrix is
// only asserting the gate, not subsequent action logic.
function fd(entries: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

function fakeRequest(url = 'http://localhost/x'): unknown {
  // Route Handlers expect a `NextRequest`. Production code reads
  // `request.nextUrl.searchParams.get('tab')` — we satisfy just that surface.
  return {
    nextUrl: new URL(url),
  };
}

const ADMIN_ONLY: Record<RoleKey, Outcome> = {
  unauth: 'redirect:/login',
  admin: 'allow',
  staff: 'redirect:/',
  coach: 'redirect:/',
  viewer: 'redirect:/',
  dealer: 'redirect:/',
  orphan: 'redirect:/',
};

const ADMIN_OR_COACH: Record<RoleKey, Outcome> = {
  unauth: 'redirect:/login',
  admin: 'allow',
  staff: 'redirect:/',
  coach: 'allow',
  viewer: 'redirect:/',
  dealer: 'redirect:/',
  orphan: 'redirect:/',
};

export const ACTION_MATRIX: ActionMatrixRow[] = [
  // ---- People (4) — admin-only ------------------------------------------
  {
    label: 'createPerson',
    invoke: () => peopleActions.createPerson(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'person:create — admin-only (admin runs people admin)',
  },
  {
    label: 'updatePerson',
    invoke: () => peopleActions.updatePerson(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'person:edit — admin-only',
  },
  {
    label: 'archivePerson',
    invoke: () => peopleActions.archivePerson(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'person:archive — admin-only',
  },
  {
    label: 'adoptOrphanAuthUser',
    invoke: () => peopleActions.adoptOrphanAuthUser(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'person:adopt-orphan — admin-only',
  },

  // ---- Dealer CRUD (3) — admin-only -------------------------------------
  {
    label: 'createDealer',
    invoke: () => scheduleActions.createDealer(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'dealer:create — admin-only since 2026-05-08',
  },
  {
    label: 'updateDealer',
    invoke: () => scheduleActions.updateDealer(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'dealer:edit — admin-only since 2026-05-08',
  },
  {
    label: 'archiveDealer',
    invoke: () => scheduleActions.archiveDealer(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'dealer:archive — admin-only',
  },
  {
    label: 'convertProspectToActive',
    invoke: () => scheduleActions.convertProspectToActive(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'dealer:edit — admin-only since 2026-05-08; prospect → active flip',
  },

  // ---- Campaign CRUD (3) — admin-only -----------------------------------
  {
    label: 'createCampaign',
    invoke: () => scheduleActions.createCampaign(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'campaign:create — admin-only (booking is back-office)',
  },
  {
    label: 'updateCampaign',
    invoke: () => scheduleActions.updateCampaign(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'campaign:edit — admin-only',
  },
  {
    label: 'cancelCampaign',
    invoke: () => scheduleActions.cancelCampaign(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'campaign:cancel — admin-only',
  },

  // ---- Lookup admin (6) — admin-only ------------------------------------
  {
    label: 'createCampaignStyle',
    invoke: () => scheduleActions.createCampaignStyle(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'lookup:edit — admin-only',
  },
  {
    label: 'updateCampaignStyle',
    invoke: () => scheduleActions.updateCampaignStyle(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'lookup:edit — admin-only',
  },
  {
    label: 'archiveCampaignStyle',
    invoke: () => scheduleActions.archiveCampaignStyle(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'lookup:edit — admin-only',
  },
  {
    label: 'createAudienceSource',
    invoke: () => scheduleActions.createAudienceSource(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'lookup:edit — admin-only',
  },
  {
    label: 'updateAudienceSource',
    invoke: () => scheduleActions.updateAudienceSource(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'lookup:edit — admin-only',
  },
  {
    label: 'archiveAudienceSource',
    invoke: () => scheduleActions.archiveAudienceSource(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'lookup:edit — admin-only',
  },

  // ---- Service catalog (3) — admin-only (lookup:edit) -------------------
  {
    label: 'createServiceItem',
    invoke: () => servicesActions.createServiceItem(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'lookup:edit — admin-only (quote-composer catalog admin)',
  },
  {
    label: 'updateServiceItem',
    invoke: () => servicesActions.updateServiceItem(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'lookup:edit — admin-only',
  },
  {
    label: 'archiveServiceItem',
    invoke: () => servicesActions.archiveServiceItem(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'lookup:edit — admin-only',
  },

  // ---- Email send (4) — admin-only --------------------------------------
  {
    label: 'sendTestEmail',
    invoke: () => emailActions.sendTestEmail(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'email:send — admin-only (0064 deliverability tool; free-compose)',
  },
  {
    label: 'sendClientCampaignConfirmation',
    invoke: () => emailActions.sendClientCampaignConfirmation(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'email:send — admin-only (admin → external comms)',
  },
  {
    label: 'sendCoachCampaignConfirmation',
    invoke: () => emailActions.sendCoachCampaignConfirmation(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'email:send — admin-only',
  },
  {
    label: 'sendCoachShareLinkEmail',
    invoke: () => emailActions.sendCoachShareLinkEmail(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'email:send — admin-only',
  },

  // ---- Availability blocks (3) — admin OR coach -------------------------
  // Coach is admitted at the role layer; row-ownership (own coach_unavailable
  // rows) is enforced inside the action via `ensureAvailabilityOwnership`.
  // The matrix only asserts the role-level admit set; row-level ownership
  // is covered by `availability-authz.test.ts`.
  {
    label: 'createAvailabilityBlock',
    invoke: () => scheduleActions.createAvailabilityBlock(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'availability:edit (admin || coach) + row-level ownership inside',
  },
  {
    label: 'updateAvailabilityBlock',
    invoke: () => scheduleActions.updateAvailabilityBlock(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'availability:edit (admin || coach) + row-level ownership inside',
  },
  {
    label: 'archiveAvailabilityBlock',
    invoke: () => scheduleActions.archiveAvailabilityBlock(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'availability:edit (admin || coach) + row-level ownership inside',
  },

  // ---- Quote actions (3) — admin OR coach ------------------------------
  // `quote:edit` admits admin || coach (multi-tenant-by-coach: coaches own
  // their own quotes; admins can edit any). Composer surface is admin+coach.
  {
    label: 'createQuote',
    invoke: () => quotesActions.createQuote(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'quote:edit — admin || coach (composer surface)',
  },
  {
    label: 'sendQuote',
    invoke: () => quotesActions.sendQuote(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'quote:edit — admin || coach',
  },
  {
    label: 'previewQuotePdf',
    invoke: () => quotesActions.previewQuotePdf(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'quote:edit — admin || coach (composer-side PDF preview; no side effects)',
  },
  {
    label: 'declineQuote',
    invoke: () => quotesActions.declineQuote(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'quote:edit — admin || coach (staff-side decline; public-side flows through route handler)',
  },
  {
    label: 'setQuoteInputs',
    invoke: () => quotesActions.setQuoteInputs(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'quote:edit — admin || coach (composer setter)',
  },
  {
    label: 'setQuoteTax',
    invoke: () => quotesActions.setQuoteTax(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'quote:edit — admin || coach (composer setter)',
  },
  {
    label: 'setQuoteDealer',
    invoke: () => quotesActions.setQuoteDealer(fd()),
    expectedByRole: ADMIN_OR_COACH,
    note: 'quote:edit — admin || coach (composer setter)',
  },

  // ---- Route Handlers (2) -----------------------------------------------
  {
    label: 'GET /production/export',
    invoke: () => productionExportGET(fakeRequest() as never),
    expectedByRole: ADMIN_ONLY,
    note: 'production:export — admin-only Route Handler',
  },
  {
    label: 'GET /reports/export',
    invoke: () => reportsExportGET(fakeRequest('http://localhost/x?tab=dealer') as never),
    expectedByRole: ADMIN_OR_COACH,
    note: 'reports:view — admin || coach (coach can pull aggregates for the field)',
  },
  {
    label: 'setBillingAdjustment',
    invoke: () => reportsActions.setBillingAdjustment(fd()),
    expectedByRole: ADMIN_ONLY,
    note: 'reports:edit-billing — admin only (coaches can view reports but not adjust billing figures)',
  },
];
